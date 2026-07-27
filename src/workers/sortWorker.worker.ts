import type { CountRequest, CountDone } from "../benchmark/types";

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<CountRequest>) => void) | null;
  postMessage: (message: CountDone) => void;
};

ctx.onmessage = ({ data }) => {
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
