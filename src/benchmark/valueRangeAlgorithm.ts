import type { CountRequest, CountDone } from "./types";
import SortWorker from "../workers/sortWorker.worker?worker";
import { ARRAY_SIZE, VALUE_COUNT } from "./constants";
import { dispatch, generateSource } from "./workerDispatch";
import type { Algorithm, RunResult, SweepOutcome } from "./algorithm";

// ---------------------------------------------------------------------------
// Algorithme A : tri par comptage réparti par plage de VALEURS.
// Chaque worker relit tout le tableau source mais ne compte que sa plage de
// valeurs (via Atomics.add sur un buffer de comptage partagé). La fusion
// finale (expansion des comptages) se fait sur le main thread, coût
// indépendant de N.
// ---------------------------------------------------------------------------

export interface ValueRangeSession {
  sourceSAB: SharedArrayBuffer;
  pool: Worker[]; // Réutilisés à travers tous les runs/itérations d'une session
  countsSAB: SharedArrayBuffer;
  sortedScratch: Uint32Array;
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
  const pool = Array.from({ length: maxWorkers }, () => new SortWorker());
  const countsSAB = new SharedArrayBuffer(VALUE_COUNT * Uint32Array.BYTES_PER_ELEMENT);
  const sortedScratch = new Uint32Array(ARRAY_SIZE);
  return { sourceSAB, pool, countsSAB, sortedScratch };
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

    // Fusion des comptages en tableau trié, sur le main thread : boucle
    // linéaire dont le coût est indépendant de N, donc ne biaise pas la
    // comparaison entre nombres de workers.
    const sorted = session.sortedScratch;
    let cursor = 0;
    for (let value = 0; value < VALUE_COUNT; value++) {
      const count = counts[value];
      if (count > 0) {
        sorted.fill(value, cursor, cursor + count);
        cursor += count;
      }
    }

    const ms = performance.now() - t0;
    if (n === 1) baselineMs = ms;
    const speedup = baselineMs / ms;

    results.push({ workers: n, ms, speedup });

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
