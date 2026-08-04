export interface GenerateRequest {
  type: "generate";
  buffer: SharedArrayBuffer;
  length: number;
  maxValue: number;
}

export interface GenerateDone {
  type: "generated";
}

export interface SearchRequest {
  type: "search";
  sourceBuffer: SharedArrayBuffer;
  targetValue: number;
  rangeStart: number;
  rangeEndExclusive: number;
  stateBuffer: SharedArrayBuffer;
  foundIndexBuffer: SharedArrayBuffer;
  workerId: number;
}

export interface SearchDone {
  type: "searchDone";
  workerId: number;
  outcome: "found" | "not-found" | "stopped-early";
  elementsScanned: number;
}
