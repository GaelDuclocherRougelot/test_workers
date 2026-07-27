import type {
  GenerateRequest,
  GenerateDone,
  CountRequest,
  CountDone,
  SortRangeRequest,
  SortRangeDone,
} from "./types";
import GeneratorWorker from "../workers/generator.worker?worker";
import SortWorker from "../workers/sortWorker.worker?worker";
import IndexSortWorker from "../workers/indexSortWorker.worker?worker";

export const ARRAY_SIZE = 5_000_000;
export const MAX_VALUE = 5_000_000; // valeurs dans [0, MAX_VALUE]
const VALUE_COUNT = MAX_VALUE + 1;

export interface RunResult {
  workers: number;
  ms: number;
  speedup: number;
}

interface SweepOutcome {
  results: RunResult[];
  aborted: boolean;
}

// Les deux algorithmes exposent la même forme (session + sweep + dispose) ;
// seule cette forme commune est factorisée dans runOneShot/runContinuous
// ci-dessous, chaque algorithme reste responsable de son propre découpage et
// de sa propre fusion.
interface Algorithm<TSession> {
  label: string;
  createSession: (maxWorkers: number, onProgress?: (message: string) => void) => Promise<TSession>;
  disposeSession: (session: TSession) => void;
  runSweep: (
    session: TSession,
    maxWorkers: number,
    isStopped: () => boolean,
    onProgress?: (message: string) => void,
  ) => Promise<SweepOutcome>;
}

function dispatch<TReq, TRes>(worker: Worker, request: TReq): Promise<TRes> {
  return new Promise((resolve) => {
    worker.addEventListener(
      "message",
      (event: MessageEvent<TRes>) => resolve(event.data),
      { once: true },
    );
    worker.postMessage(request);
  });
}

async function generateSource(onProgress?: (message: string) => void): Promise<SharedArrayBuffer> {
  onProgress?.("Génération du tableau source (5 000 000 entiers)...");

  const sourceSAB = new SharedArrayBuffer(ARRAY_SIZE * Uint32Array.BYTES_PER_ELEMENT);
  const generatorWorker = new GeneratorWorker();
  await dispatch<GenerateRequest, GenerateDone>(generatorWorker, {
    type: "generate",
    buffer: sourceSAB,
    length: ARRAY_SIZE,
    maxValue: MAX_VALUE,
  });
  generatorWorker.terminate();

  return sourceSAB;
}

// ---------------------------------------------------------------------------
// Algorithme A : tri par comptage réparti par plage de VALEURS.
// Chaque worker relit tout le tableau source mais ne compte que sa plage de
// valeurs (via Atomics.add sur un buffer de comptage partagé). La fusion
// finale (expansion des comptages) se fait sur le main thread, coût
// indépendant de N.
// ---------------------------------------------------------------------------

export interface ValueRangeSession {
  sourceSAB: SharedArrayBuffer;
  pool: Worker[];
  // Réutilisés à travers tous les runs/itérations d'une session : allouer un
  // buffer de ~20 Mo à chaque run (potentiellement des centaines de fois sur
  // 10 minutes) génère un churn mémoire qui a fini par faire planter l'onglet
  // (les SharedArrayBuffer sont plus coûteux à réclamer par le GC que des
  // buffers classiques).
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

const valueRangeAlgorithm: Algorithm<ValueRangeSession> = {
  label: "tri par comptage (plage de valeurs)",
  createSession: createValueRangeSession,
  disposeSession: disposeValueRangeSession,
  runSweep: runValueRangeSweep,
};

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

const indexRangeAlgorithm: Algorithm<IndexRangeSession> = {
  label: "tri local par plage d'index + fusion bottom-up",
  createSession: createIndexRangeSession,
  disposeSession: disposeIndexRangeSession,
  runSweep: runIndexRangeSweep,
};

// ---------------------------------------------------------------------------
// Plomberie commune : one-shot et mode continu, indépendants de l'algorithme.
// ---------------------------------------------------------------------------

async function runOneShot<TSession>(
  algorithm: Algorithm<TSession>,
  maxWorkers: number,
  onProgress?: (message: string) => void,
): Promise<RunResult[]> {
  const session = await algorithm.createSession(maxWorkers, onProgress);

  console.group(
    `Benchmark ${algorithm.label} — ${ARRAY_SIZE.toLocaleString("fr-FR")} entiers, runs de 1 à ${maxWorkers} workers`,
  );

  const { results } = await algorithm.runSweep(session, maxWorkers, () => false, onProgress);

  for (const r of results) {
    console.log(`workers=${r.workers} | ${r.ms.toFixed(1)} ms | speedup x${r.speedup.toFixed(2)} (vs 1 worker)`);
  }
  console.table(
    results.map((r) => ({
      workers: r.workers,
      "temps (ms)": r.ms.toFixed(1),
      speedup: `x${r.speedup.toFixed(2)}`,
    })),
  );
  console.groupEnd();

  algorithm.disposeSession(session);

  return results;
}

export interface ContinuousProgress {
  iteration: number;
  elapsedMs: number;
  durationMs: number;
}

interface StabilityRow {
  workers: number;
  itérations: number;
  "moy (ms)": string;
  "min (ms)": string;
  "max (ms)": string;
  "écart-type (ms)": string;
  "moy speedup": string;
}

function summarizeStability(samples: Map<number, RunResult[]>): StabilityRow[] {
  return [...samples.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([workers, runs]) => {
      const msValues = runs.map((r) => r.ms);
      const avg = msValues.reduce((a, b) => a + b, 0) / msValues.length;
      const min = Math.min(...msValues);
      const max = Math.max(...msValues);
      const variance = msValues.reduce((acc, v) => acc + (v - avg) ** 2, 0) / msValues.length;
      const stddev = Math.sqrt(variance);
      const avgSpeedup = runs.reduce((a, r) => a + r.speedup, 0) / runs.length;
      return {
        workers,
        itérations: runs.length,
        "moy (ms)": avg.toFixed(1),
        "min (ms)": min.toFixed(1),
        "max (ms)": max.toFixed(1),
        "écart-type (ms)": stddev.toFixed(1),
        "moy speedup": `x${avgSpeedup.toFixed(2)}`,
      };
    });
}

async function runContinuous<TSession>(
  algorithm: Algorithm<TSession>,
  maxWorkers: number,
  durationMs: number,
  isStopped: () => boolean,
  onProgress?: (progress: ContinuousProgress) => void,
): Promise<Map<number, RunResult[]>> {
  const session = await algorithm.createSession(maxWorkers, (message) => {
    console.log(message);
    onProgress?.({ iteration: 0, elapsedMs: 0, durationMs });
  });

  const samples = new Map<number, RunResult[]>();
  const startTime = performance.now();
  let iteration = 0;

  console.group(
    `Benchmark continu ${algorithm.label} — ${ARRAY_SIZE.toLocaleString("fr-FR")} entiers, jusqu'à ${(durationMs / 60_000).toFixed(0)} min ou arrêt manuel`,
  );

  while (!isStopped() && performance.now() - startTime < durationMs) {
    iteration++;
    const elapsedMs = performance.now() - startTime;
    onProgress?.({ iteration, elapsedMs, durationMs });

    const { results, aborted } = await algorithm.runSweep(session, maxWorkers, isStopped);
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
  console.table(summarizeStability(samples));
  console.groupEnd();

  algorithm.disposeSession(session);

  return samples;
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export function runBenchmark(maxWorkers: number, onProgress?: (message: string) => void): Promise<RunResult[]> {
  return runOneShot(valueRangeAlgorithm, maxWorkers, onProgress);
}

export function runContinuousBenchmark(
  maxWorkers: number,
  durationMs: number,
  isStopped: () => boolean,
  onProgress?: (progress: ContinuousProgress) => void,
): Promise<Map<number, RunResult[]>> {
  return runContinuous(valueRangeAlgorithm, maxWorkers, durationMs, isStopped, onProgress);
}

export function runIndexRangeBenchmark(
  maxWorkers: number,
  onProgress?: (message: string) => void,
): Promise<RunResult[]> {
  return runOneShot(indexRangeAlgorithm, maxWorkers, onProgress);
}

export function runIndexRangeContinuousBenchmark(
  maxWorkers: number,
  durationMs: number,
  isStopped: () => boolean,
  onProgress?: (progress: ContinuousProgress) => void,
): Promise<Map<number, RunResult[]>> {
  return runContinuous(indexRangeAlgorithm, maxWorkers, durationMs, isStopped, onProgress);
}
