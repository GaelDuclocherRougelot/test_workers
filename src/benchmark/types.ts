export interface GenerateRequest {
  type: "generate";
  buffer: SharedArrayBuffer;
  length: number;
  maxValue: number;
}

export interface GenerateDone {
  type: "generated";
}

export interface CountRequest {
  type: "count";
  sourceBuffer: SharedArrayBuffer;
  sourceLength: number;
  countsBuffer: SharedArrayBuffer;
  rangeStart: number;
  rangeEndExclusive: number;
  workerId: number;
}

export interface CountDone {
  type: "done";
  workerId: number;
}

export interface SortRangeRequest {
  type: "sortRange";
  sourceBuffer: SharedArrayBuffer;
  workBuffer: SharedArrayBuffer;
  rangeStart: number;
  rangeEndExclusive: number;
  workerId: number;
}

export interface SortRangeDone {
  type: "sortRangeDone";
  workerId: number;
}

// Fusion (comptages -> tableau trié) déléguée à un worker du pool, pour ne
// jamais bloquer le main thread — voir sortWorker.worker.ts.
export interface FuseCountsRequest {
  type: "fuseCounts";
  countsBuffer: SharedArrayBuffer;
  valueCount: number;
  sortedBuffer: SharedArrayBuffer;
}

export interface FuseCountsDone {
  type: "fuseCountsDone";
  cursor: number;
}

// Merge bottom-up des runs triés délégué à un worker du pool, pour ne jamais
// bloquer le main thread — voir indexSortWorker.worker.ts.
export interface MergeRunsRequest {
  type: "mergeRuns";
  workBuffer: SharedArrayBuffer;
  scratchBuffer: SharedArrayBuffer;
  boundaries: number[];
}

export interface MergeRunsDone {
  type: "mergeRunsDone";
}
