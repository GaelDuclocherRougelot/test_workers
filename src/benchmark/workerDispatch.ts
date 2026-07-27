import type { GenerateRequest, GenerateDone } from "./types";
import GeneratorWorker from "../workers/generator.worker?worker";
import { ARRAY_SIZE, MAX_VALUE } from "./constants";

export function dispatch<TReq, TRes>(worker: Worker, request: TReq): Promise<TRes> {
  return new Promise((resolve) => {
    worker.addEventListener(
      "message",
      (event: MessageEvent<TRes>) => resolve(event.data),
      { once: true },
    );
    worker.postMessage(request);
  });
}

export async function generateSource(onProgress?: (message: string) => void): Promise<SharedArrayBuffer> {
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
