import type { CountRequest, CountDone, FuseCountsRequest, FuseCountsDone } from "./types";
import SortWorker from "../workers/sortWorker.worker?worker";
import { ARRAY_SIZE, VALUE_COUNT } from "./constants";
import { dispatch, generateSource } from "./workerDispatch";
import type { Algorithm, RunResult, SweepOutcome } from "./algorithm";

// ---------------------------------------------------------------------------
// Algorithme A : tri par comptage réparti par plage de VALEURS.
// Chaque worker relit tout le tableau source mais ne compte que sa plage de
// valeurs (via Atomics.add sur un buffer de comptage partagé). La fusion
// finale (expansion des comptages) est elle aussi déléguée à un worker du
// pool (voir sortWorker.worker.ts) : le main thread ne fait qu'attendre le
// résultat, il n'exécute jamais la boucle de fusion lui-même.
// ---------------------------------------------------------------------------

export interface ValueRangeSession {
  sourceSAB: SharedArrayBuffer;
  pool: Worker[]; // Réutilisés à travers tous les runs/itérations d'une session
  countsSAB: SharedArrayBuffer;
  sortedSAB: SharedArrayBuffer;
}

function computeValueRanges(n: number): Array<{ rangeStart: number; rangeEndExclusive: number }> {
  const chunk = Math.ceil(VALUE_COUNT / n);
  return Array.from({ length: n }, (_, i) => ({
    rangeStart: i * chunk,
    rangeEndExclusive: Math.min((i + 1) * chunk, VALUE_COUNT),
  }));
}

async function createValueRangeSession(
  maxWorkers: number,
  onProgress?: (message: string) => void,
): Promise<ValueRangeSession> {
  const sourceSAB = await generateSource(onProgress);

  // Coût de `new Worker()` : essentiellement la portion synchrone (le script
  // du worker est ensuite parsé/exécuté sur son propre thread, hors de cette
  // mesure) — utile pour repérer si l'instanciation d'un gros pool devient
  // significative à mesure que maxWorkers grandit.
  const tPoolStart = performance.now();
  const pool = Array.from({ length: maxWorkers }, () => new SortWorker());
  console.log(`Instanciation du pool (${maxWorkers} workers) : ${(performance.now() - tPoolStart).toFixed(1)} ms`);

  const countsSAB = new SharedArrayBuffer(VALUE_COUNT * Uint32Array.BYTES_PER_ELEMENT);
  const sortedSAB = new SharedArrayBuffer(ARRAY_SIZE * Uint32Array.BYTES_PER_ELEMENT);
  return { sourceSAB, pool, countsSAB, sortedSAB };
}

function disposeValueRangeSession(session: ValueRangeSession): void {
  session.pool.forEach((worker) => worker.terminate());
}

async function runValueRangeSweep(
  session: ValueRangeSession,
  maxWorkers: number,
  isStopped: () => boolean,
  onProgress?: (message: string) => void,
): Promise<SweepOutcome> {
  const results: RunResult[] = [];
  let baselineMs = 0;

  for (let n = 1; n <= maxWorkers; n++) {
    if (isStopped()) {
      return { results, aborted: true };
    }

    onProgress?.(`Run ${n}/${maxWorkers} (${n} worker${n > 1 ? "s" : ""})...`);

    const ranges = computeValueRanges(n);
    const counts = new Uint32Array(session.countsSAB);
    counts.fill(0); // buffer réutilisé : remise à zéro avant chaque run

    const t0 = performance.now();

    await Promise.all(
      ranges.map((range, i) =>
        dispatch<CountRequest, CountDone>(session.pool[i], {
          type: "count",
          sourceBuffer: session.sourceSAB,
          sourceLength: ARRAY_SIZE,
          countsBuffer: session.countsSAB,
          rangeStart: range.rangeStart,
          rangeEndExclusive: range.rangeEndExclusive,
          workerId: i,
        }),
      ),
    );
    const computeMs = performance.now() - t0;

    // Fusion des comptages en tableau trié, déléguée à un worker du pool
    // (réutilise pool[0], libre puisque le Promise.all ci-dessus est déjà
    // résolu) : le main thread se contente d'attendre une promesse, il
    // n'exécute jamais la boucle de fusion lui-même.
    const tFusionStart = performance.now();
    const { cursor } = await dispatch<FuseCountsRequest, FuseCountsDone>(session.pool[0], {
      type: "fuseCounts",
      countsBuffer: session.countsSAB,
      valueCount: VALUE_COUNT,
      sortedBuffer: session.sortedSAB,
    });
    const fusionMs = performance.now() - tFusionStart;

    const ms = performance.now() - t0;
    if (n === 1) baselineMs = ms;
    const speedup = baselineMs / ms;

    results.push({ workers: n, ms, computeMs, fusionMs, speedup });

    if (cursor !== ARRAY_SIZE) {
      console.warn(`Vérification échouée (plage de valeurs) pour n=${n}: ${cursor} valeurs comptées au lieu de ${ARRAY_SIZE}`);
    }
  }

  return { results, aborted: false };
}

export const valueRangeAlgorithm: Algorithm<ValueRangeSession> = {
  label: "tri par comptage (plage de valeurs)",
  createSession: createValueRangeSession,
  disposeSession: disposeValueRangeSession,
  runSweep: runValueRangeSweep,
};
