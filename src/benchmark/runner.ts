import SearchWorker from "../workers/searchWorker.worker?worker";
import type { SearchRequest, SearchDone } from "./types";
import { ARRAY_SIZE, TARGET_INDEX, WORKER_STATE } from "./constants";
import { dispatch, generateSource } from "./workerDispatch";
import type { RunResult } from "./result";
import { computeStabilityStats } from "./stats";
import { formatRunResultRow, formatStabilityRow } from "./format";

export type { RunResult };

interface SweepOutcome {
  results: RunResult[];
  aborted: boolean;
}

interface SearchSession {
  sourceSAB: SharedArrayBuffer;
  targetValue: number;
  pool: Worker[]; // Réutilisés à travers tous les runs/itérations d'une session
  stateSAB: SharedArrayBuffer; // Int32Array[maxWorkers], état par worker (voir WORKER_STATE)
  foundIndexSAB: SharedArrayBuffer; // Int32Array[1], -1 tant que non trouvée
}

// Callback optionnel pour observer les états des workers après chaque run —
// lit directement le Int32Array partagé (Atomics.load), sans passer par un
// message : c'est ce qui permet à l'UI de refléter IDLE/SEARCHING/FOUND/
// STOPPED sans coût de communication.
export type RunStateObserver = (state: Int32Array, n: number) => void;

function computeIndexRanges(n: number): Array<{ rangeStart: number; rangeEndExclusive: number }> {
  const chunk = Math.ceil(ARRAY_SIZE / n);
  return Array.from({ length: n }, (_, i) => ({
    rangeStart: i * chunk,
    rangeEndExclusive: Math.min((i + 1) * chunk, ARRAY_SIZE),
  }));
}

async function createSession(maxWorkers: number, onProgress?: (message: string) => void): Promise<SearchSession> {
  const { sourceSAB, targetValue } = await generateSource(onProgress);

  // Coût de `new Worker()` : essentiellement la portion synchrone (le script
  // du worker est ensuite parsé/exécuté sur son propre thread, hors de cette
  // mesure) — utile pour repérer si l'instanciation d'un gros pool devient
  // significative à mesure que maxWorkers grandit.
  const tPoolStart = performance.now();
  const pool = Array.from({ length: maxWorkers }, () => new SearchWorker());
  console.log(`Instanciation du pool (${maxWorkers} workers) : ${(performance.now() - tPoolStart).toFixed(1)} ms`);

  const stateSAB = new SharedArrayBuffer(maxWorkers * Int32Array.BYTES_PER_ELEMENT);
  const foundIndexSAB = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);

  return { sourceSAB, targetValue, pool, stateSAB, foundIndexSAB };
}

function disposeSession(session: SearchSession): void {
  session.pool.forEach((worker) => worker.terminate());
}

async function runSweep(
  session: SearchSession,
  maxWorkers: number,
  isStopped: () => boolean,
  onProgress?: (message: string) => void,
  onRunComplete?: RunStateObserver,
): Promise<SweepOutcome> {
  const results: RunResult[] = [];
  let baselineMs = 0;
  const state = new Int32Array(session.stateSAB);
  const foundIndex = new Int32Array(session.foundIndexSAB);

  for (let n = 1; n <= maxWorkers; n++) {
    if (isStopped()) {
      return { results, aborted: true };
    }

    onProgress?.(`Run ${n}/${maxWorkers} (${n} worker${n > 1 ? "s" : ""})...`);

    for (let i = 0; i < n; i++) Atomics.store(state, i, WORKER_STATE.IDLE);
    Atomics.store(foundIndex, 0, -1);

    const ranges = computeIndexRanges(n);
    const t0 = performance.now();

    const responses = await Promise.all(
      ranges.map((range, i) =>
        dispatch<SearchRequest, SearchDone>(session.pool[i], {
          type: "search",
          sourceBuffer: session.sourceSAB,
          targetValue: session.targetValue,
          rangeStart: range.rangeStart,
          rangeEndExclusive: range.rangeEndExclusive,
          stateBuffer: session.stateSAB,
          foundIndexBuffer: session.foundIndexSAB,
          workerId: i,
        }),
      ),
    );

    const ms = performance.now() - t0;
    if (n === 1) baselineMs = ms;
    const speedup = baselineMs / ms;

    const winner = responses.find((r) => r.outcome === "found");
    const foundAt = Atomics.load(foundIndex, 0);

    results.push({ workers: n, ms, speedup, foundBy: winner?.workerId ?? -1 });
    onRunComplete?.(state, n);

    if (foundAt !== TARGET_INDEX) {
      console.warn(`Vérification échouée pour n=${n} : target trouvée à l'index ${foundAt} au lieu de ${TARGET_INDEX}`);
    }
  }

  return { results, aborted: false };
}

export async function runSearchBenchmark(
  maxWorkers: number,
  onProgress?: (message: string) => void,
  onRunComplete?: RunStateObserver,
): Promise<RunResult[]> {
  const session = await createSession(maxWorkers, onProgress);

  console.group(
    `Benchmark recherche parallèle — ${ARRAY_SIZE.toLocaleString("fr-FR")} entiers, target fixe à l'index ${TARGET_INDEX.toLocaleString("fr-FR")}, runs de 1 à ${maxWorkers} workers`,
  );

  const { results } = await runSweep(session, maxWorkers, () => false, onProgress, onRunComplete);

  for (const r of results) {
    console.log(
      `workers=${r.workers} | ${r.ms.toFixed(1)} ms | speedup x${r.speedup.toFixed(2)} | trouvé par worker ${r.foundBy}`,
    );
  }
  // Table indexée par nombre de workers (au lieu de l'index d'array 0..N-1
  // par défaut de console.table, qui doublonnait avec "workers" et prêtait à
  // confusion).
  console.table(Object.fromEntries(results.map((r) => [r.workers, formatRunResultRow(r)])));
  console.groupEnd();

  disposeSession(session);

  return results;
}

export interface ContinuousProgress {
  iteration: number;
  elapsedMs: number;
  durationMs: number;
}

export async function runSearchContinuousBenchmark(
  maxWorkers: number,
  durationMs: number,
  isStopped: () => boolean,
  onProgress?: (progress: ContinuousProgress) => void,
  onRunComplete?: RunStateObserver,
): Promise<Map<number, RunResult[]>> {
  const session = await createSession(maxWorkers, (message) => {
    console.log(message);
    onProgress?.({ iteration: 0, elapsedMs: 0, durationMs });
  });

  const samples = new Map<number, RunResult[]>();
  const startTime = performance.now();
  let iteration = 0;

  console.group(
    `Benchmark continu recherche parallèle — ${ARRAY_SIZE.toLocaleString("fr-FR")} entiers, target fixe à l'index ${TARGET_INDEX.toLocaleString("fr-FR")}, jusqu'à ${(durationMs / 60_000).toFixed(0)} min ou arrêt manuel`,
  );

  while (!isStopped() && performance.now() - startTime < durationMs) {
    iteration++;
    const elapsedMs = performance.now() - startTime;
    onProgress?.({ iteration, elapsedMs, durationMs });

    const { results, aborted } = await runSweep(session, maxWorkers, isStopped, undefined, onRunComplete);
    if (aborted) break;

    console.groupCollapsed(`Itération ${iteration} — t=${(elapsedMs / 1000).toFixed(0)}s`);
    for (const r of results) {
      console.log(`workers=${r.workers} | ${r.ms.toFixed(1)} ms | speedup x${r.speedup.toFixed(2)}`);
    }
    console.groupEnd();

    for (const r of results) {
      const list = samples.get(r.workers) ?? [];
      list.push(r);
      samples.set(r.workers, list);
    }
  }

  const totalElapsedS = (performance.now() - startTime) / 1000;
  console.log(
    `Terminé — ${iteration} itération(s), ${totalElapsedS.toFixed(0)}s écoulées (stoppé manuellement: ${isStopped()}).`,
  );
  console.table(Object.fromEntries(computeStabilityStats(samples).map((s) => [s.workers, formatStabilityRow(s)])));
  console.groupEnd();

  disposeSession(session);

  return samples;
}
