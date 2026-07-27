import type { GenerateRequest, GenerateDone } from "../benchmark/types";

// Cast rather than reference the "webworker" lib: mixing it with the project's
// "DOM" lib (needed for main.ts) makes TypeScript reject the two conflicting
// global declarations of `self`.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
  postMessage: (message: GenerateDone) => void;
};

ctx.onmessage = ({ data }) => {
  const view = new Uint32Array(data.buffer);
  for (let i = 0; i < data.length; i++) {
    view[i] = Math.floor(Math.random() * (data.maxValue + 1));
  }
  ctx.postMessage({ type: "generated" });
};
