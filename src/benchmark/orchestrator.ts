// ---------------------------------------------------------------------------
// API publique : point d'entrée unique consommé par main.ts.
// ---------------------------------------------------------------------------

export { runSearchBenchmark, runSearchContinuousBenchmark } from "./runner";
export type { RunResult, ContinuousProgress, RunStateObserver } from "./runner";
export { ARRAY_SIZE, MAX_VALUE, TARGET_INDEX, WORKER_STATE } from "./constants";
export type { StabilityStats } from "./stats";
export { computeStabilityStats } from "./stats";
export type { ChartPoint } from "./chart";
export { renderChart } from "./chart";
export type { FormattedRow } from "./format";
export { formatRunResultRow, formatStabilityRow } from "./format";
export { renderTable } from "./htmlTable";
export { renderWorkerStates } from "./workerStates";
