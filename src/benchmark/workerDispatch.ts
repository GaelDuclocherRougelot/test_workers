import type { GenerateRequest, GenerateDone } from "./types";
import GeneratorWorker from "../workers/generator.worker?worker";
import { ARRAY_SIZE, MAX_VALUE, TARGET_INDEX } from "./constants";

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

export interface GeneratedSource {
  sourceSAB: SharedArrayBuffer;
  targetValue: number;
}

// Génère le tableau source dans un worker dédié (jamais sur le main thread),
// puis plante la target à TARGET_INDEX avec une valeur (MAX_VALUE) réservée
// hors de la plage aléatoire [0, MAX_VALUE - 1] : elle est donc garantie
// unique dans le tableau, ce qui rend la position trouvée déterministe d'un
// run à l'autre.
export async function generateSource(onProgress?: (message: string) => void): Promise<GeneratedSource> {
  onProgress?.("Génération du tableau source (5 000 000 entiers)...");

  const t0 = performance.now();
  const sourceSAB = new SharedArrayBuffer(ARRAY_SIZE * Uint32Array.BYTES_PER_ELEMENT);
  const generatorWorker = new GeneratorWorker();
  await dispatch<GenerateRequest, GenerateDone>(generatorWorker, {
    type: "generate",
    buffer: sourceSAB,
    length: ARRAY_SIZE,
    maxValue: MAX_VALUE - 1,
  });
  generatorWorker.terminate();

  const targetValue = MAX_VALUE;
  new Uint32Array(sourceSAB)[TARGET_INDEX] = targetValue;

  console.log(`Génération du tableau source : ${(performance.now() - t0).toFixed(1)} ms (dans un worker)`);

  return { sourceSAB, targetValue };
}
