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
