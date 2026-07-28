import type { CountRequest, CountDone, FuseCountsRequest, FuseCountsDone } from "../benchmark/types";
import { fuseCounts } from "./fuseCounts";

type Request = CountRequest | FuseCountsRequest;
type Response = CountDone | FuseCountsDone;

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: Response) => void;
};

ctx.onmessage = ({ data }) => {
  if (data.type === "fuseCounts") {
    const counts = new Uint32Array(data.countsBuffer);
    const sorted = new Uint32Array(data.sortedBuffer);
    const cursor = fuseCounts(counts, data.valueCount, sorted);
    ctx.postMessage({ type: "fuseCountsDone", cursor });
    return;
  }

  const source = new Uint32Array(data.sourceBuffer, 0, data.sourceLength);
  const counts = new Uint32Array(data.countsBuffer);
  const { rangeStart, rangeEndExclusive } = data;

  for (let i = 0; i < data.sourceLength; i++) {
    const value = source[i];
    if (value >= rangeStart && value < rangeEndExclusive) {
      Atomics.add(counts, value, 1);
    }
  }

  ctx.postMessage({ type: "done", workerId: data.workerId });
};
