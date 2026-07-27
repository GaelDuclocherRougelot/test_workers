import type { SortRangeRequest, SortRangeDone } from "./types";
import IndexSortWorker from "../workers/indexSortWorker.worker?worker";
import { ARRAY_SIZE } from "./constants";
import { dispatch, generateSource } from "./workerDispatch";
import type { Algorithm, RunResult, SweepOutcome } from "./algorithm";

// ---------------------------------------------------------------------------
// Algorithme B : tri réparti par plage d'INDEX.
// Chaque worker ne lit que sa propre tranche du tableau source, la trie
// localement (TypedArray.sort, numérique) dans sa tranche disjointe d'un
// buffer de travail partagé — aucune lecture ni écriture redondante entre
// workers. La fusion finale sur le main thread est un merge bottom-up par
// paires (deux buffers ping-pong, boucles à deux pointeurs sans allocation),
// coût O(ARRAY_SIZE · log N).
// ---------------------------------------------------------------------------

export interface IndexRangeSession {
  sourceSAB: SharedArrayBuffer;
  pool: Worker[];
  // Réutilisés à travers tous les runs/itérations (même raison que pour
  // ValueRangeSession : éviter de réallouer ~20 Mo à chaque run).
  workBuffer: SharedArrayBuffer;
  mergeScratch: Uint32Array;
}

function computeIndexRanges(n: number): Array<{ rangeStart: number; rangeEndExclusive: number }> {
  const chunk = Math.ceil(ARRAY_SIZE / n);
  return Array.from({ length: n }, (_, i) => ({
    rangeStart: i * chunk,
    rangeEndExclusive: Math.min((i + 1) * chunk, ARRAY_SIZE),
  }));
}

// Fusionne deux runs triés adjacents src[start,mid) et src[mid,end) dans
// dst[start,end). Boucle à deux pointeurs, sans allocation : c'est la partie
// qui tourne des millions de fois, donc la moindre allocation par élément
// (closures, destructuring) s'y paie cash.
function mergeAdjacentRuns(
  src: Uint32Array<ArrayBufferLike>,
  start: number,
  mid: number,
  end: number,
  dst: Uint32Array<ArrayBufferLike>,
): void {
  let i = start;
  let j = mid;
  let k = start;
  while (i < mid && j < end) {
    dst[k++] = src[i] <= src[j] ? src[i++] : src[j++];
  }
  while (i < mid) dst[k++] = src[i++];
  while (j < end) dst[k++] = src[j++];
}

// Merge bottom-up des runs triés délimités par `boundaries` (ex: [0, 300000,
// 600000, ..., ARRAY_SIZE]) — les runs sont déjà dans le bon ordre relatif
// puisqu'ils correspondent à des plages d'index contiguës. On double la
// taille des runs à chaque passe en ping-pongant entre deux buffers pleine
// taille réutilisés d'une passe à l'autre (pas d'allocation par run).
function mergeIndexRangeRuns(
  workBuffer: SharedArrayBuffer,
  boundaries: number[],
  scratch: Uint32Array<ArrayBufferLike>,
): Uint32Array<ArrayBufferLike> {
  let src: Uint32Array<ArrayBufferLike> = new Uint32Array(workBuffer);
  let dst: Uint32Array<ArrayBufferLike> = scratch;
  let runBoundaries = boundaries;

  while (runBoundaries.length > 2) {
    const nextBoundaries: number[] = [runBoundaries[0]];

    for (let i = 0; i < runBoundaries.length - 1; i += 2) {
      const start = runBoundaries[i];
      const mid = runBoundaries[i + 1];

      if (i + 2 < runBoundaries.length) {
        const end = runBoundaries[i + 2];
        mergeAdjacentRuns(src, start, mid, end, dst);
        nextBoundaries.push(end);
      } else {
        // Run impair sans partenaire : recopié tel quel pour la passe suivante.
        dst.set(src.subarray(start, mid), start);
        nextBoundaries.push(mid);
      }
    }

    runBoundaries = nextBoundaries;
    const swap = src;
    src = dst;
    dst = swap;
  }

  return src;
}

async function createIndexRangeSession(
  maxWorkers: number,
  onProgress?: (message: string) => void,
): Promise<IndexRangeSession> {
  const sourceSAB = await generateSource(onProgress);
  const pool = Array.from({ length: maxWorkers }, () => new IndexSortWorker());
  const workBuffer = new SharedArrayBuffer(ARRAY_SIZE * Uint32Array.BYTES_PER_ELEMENT);
  const mergeScratch = new Uint32Array(ARRAY_SIZE);
  return { sourceSAB, pool, workBuffer, mergeScratch };
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

    const boundaries = [...ranges.map((range) => range.rangeStart), ARRAY_SIZE];
    const sorted = mergeIndexRangeRuns(session.workBuffer, boundaries, session.mergeScratch);

    const ms = performance.now() - t0;
    if (n === 1) baselineMs = ms;
    const speedup = baselineMs / ms;

    results.push({ workers: n, ms, speedup });

    if (sorted.length !== ARRAY_SIZE) {
      console.warn(`Vérification échouée (plage d'index) pour n=${n}: longueur ${sorted.length} au lieu de ${ARRAY_SIZE}`);
    }
  }

  return { results, aborted: false };
}

export const indexRangeAlgorithm: Algorithm<IndexRangeSession> = {
  label: "tri local par plage d'index + fusion bottom-up",
  createSession: createIndexRangeSession,
  disposeSession: disposeIndexRangeSession,
  runSweep: runIndexRangeSweep,
};
