import { runOneShot, runContinuous } from "./runner";
import type { ContinuousProgress } from "./runner";
import { valueRangeAlgorithm } from "./valueRangeAlgorithm";
import { indexRangeAlgorithm } from "./indexRangeAlgorithm";
import type { RunResult } from "./algorithm";

export type { RunResult, ContinuousProgress };
export type { ValueRangeSession } from "./valueRangeAlgorithm";
export type { IndexRangeSession } from "./indexRangeAlgorithm";
export { ARRAY_SIZE, MAX_VALUE } from "./constants";

// ---------------------------------------------------------------------------
// API publique : point d'entrée unique consommé par main.ts. Le découpage
// par algorithme vit dans valueRangeAlgorithm.ts, indexRangeAlgorithm.ts
// et runner.ts.
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
