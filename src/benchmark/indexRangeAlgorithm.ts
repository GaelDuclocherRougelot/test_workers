import type { SortRangeRequest, SortRangeDone, MergeRunsRequest, MergeRunsDone } from "./types";
import IndexSortWorker from "../workers/indexSortWorker.worker?worker";
import { ARRAY_SIZE } from "./constants";
import { dispatch, generateSource } from "./workerDispatch";
import type { Algorithm, RunResult, SweepOutcome } from "./algorithm";

// ---------------------------------------------------------------------------
// Algorithme B : tri réparti par plage d'INDEX.
// Chaque worker ne lit que sa propre tranche du tableau source, la trie
// localement (TypedArray.sort, numérique) dans sa tranche disjointe d'un
// buffer de travail partagé — aucune lecture ni écriture redondante entre
// workers. Le merge bottom-up par paires (voir workers/mergeRuns.ts) est lui
// aussi délégué à un worker du pool (voir indexSortWorker.worker.ts) : le
// main thread ne fait qu'attendre le résultat, il n'exécute jamais le merge
// lui-même. Coût O(ARRAY_SIZE · log N), payé dans le worker.
// ---------------------------------------------------------------------------

export interface IndexRangeSession {
  sourceSAB: SharedArrayBuffer;
  pool: Worker[];
  // Réutilisés à travers tous les runs/itérations (même raison que pour
  // ValueRangeSession : éviter de réallouer ~20 Mo à chaque run).
  workBuffer: SharedArrayBuffer;
  scratchSAB: SharedArrayBuffer;
}

function computeIndexRanges(n: number): Array<{ rangeStart: number; rangeEndExclusive: number }> {
  const chunk = Math.ceil(ARRAY_SIZE / n);
  return Array.from({ length: n }, (_, i) => ({
    rangeStart: i * chunk,
    rangeEndExclusive: Math.min((i + 1) * chunk, ARRAY_SIZE),
  }));
}

async function createIndexRangeSession(
  maxWorkers: number,
  onProgress?: (message: string) => void,
): Promise<IndexRangeSession> {
  const sourceSAB = await generateSource(onProgress);

  // Coût de `new Worker()` : essentiellement la portion synchrone (le script
  // du worker est ensuite parsé/exécuté sur son propre thread, hors de cette
  // mesure) — utile pour repérer si l'instanciation d'un gros pool devient
  // significative à mesure que maxWorkers grandit.
  const tPoolStart = performance.now();
  const pool = Array.from({ length: maxWorkers }, () => new IndexSortWorker());
  console.log(`Instanciation du pool (${maxWorkers} workers) : ${(performance.now() - tPoolStart).toFixed(1)} ms`);

  const workBuffer = new SharedArrayBuffer(ARRAY_SIZE * Uint32Array.BYTES_PER_ELEMENT);
  const scratchSAB = new SharedArrayBuffer(ARRAY_SIZE * Uint32Array.BYTES_PER_ELEMENT);
  return { sourceSAB, pool, workBuffer, scratchSAB };
}

function disposeIndexRangeSession(session: IndexRangeSession): void {
  session.pool.forEach((worker) => worker.terminate());
}

async function runIndexRangeSweep(
  session: IndexRangeSession,
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

    const ranges = computeIndexRanges(n);

    const t0 = performance.now();

    await Promise.all(
      ranges.map((range, i) =>
        dispatch<SortRangeRequest, SortRangeDone>(session.pool[i], {
          type: "sortRange",
          sourceBuffer: session.sourceSAB,
          workBuffer: session.workBuffer,
          rangeStart: range.rangeStart,
          rangeEndExclusive: range.rangeEndExclusive,
          workerId: i,
        }),
      ),
    );
    const computeMs = performance.now() - t0;

    // Merge délégué à un worker du pool (réutilise pool[0], libre puisque
    // le Promise.all ci-dessus est déjà résolu) : le main thread se
    // contente d'attendre une promesse, il n'exécute jamais le merge
    // lui-même.
    const tFusionStart = performance.now();
    const boundaries = [...ranges.map((range) => range.rangeStart), ARRAY_SIZE];
    await dispatch<MergeRunsRequest, MergeRunsDone>(session.pool[0], {
      type: "mergeRuns",
      workBuffer: session.workBuffer,
      scratchBuffer: session.scratchSAB,
      boundaries,
    });
    const fusionMs = performance.now() - tFusionStart;

    const ms = performance.now() - t0;
    if (n === 1) baselineMs = ms;
    const speedup = baselineMs / ms;

    results.push({ workers: n, ms, computeMs, fusionMs, speedup });
  }

  return { results, aborted: false };
}

export const indexRangeAlgorithm: Algorithm<IndexRangeSession> = {
  label: "tri local par plage d'index + fusion bottom-up",
  createSession: createIndexRangeSession,
  disposeSession: disposeIndexRangeSession,
  runSweep: runIndexRangeSweep,
};
