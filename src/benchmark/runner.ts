import { ARRAY_SIZE } from "./constants";
import type { Algorithm, RunResult } from "./algorithm";

// ---------------------------------------------------------------------------
// one-shot et mode continu, indépendants de l'algorithme.
// ---------------------------------------------------------------------------

export async function runOneShot<TSession>(
  algorithm: Algorithm<TSession>,
  maxWorkers: number,
  onProgress?: (message: string) => void,
): Promise<RunResult[]> {
  const session = await algorithm.createSession(maxWorkers, onProgress);

  console.group(
    `Benchmark ${algorithm.label} — ${ARRAY_SIZE.toLocaleString("fr-FR")} entiers, runs de 1 à ${maxWorkers} workers`,
  );

  const { results } = await algorithm.runSweep(session, maxWorkers, () => false, onProgress);

  for (const r of results) {
    console.log(`workers=${r.workers} | ${r.ms.toFixed(1)} ms | speedup x${r.speedup.toFixed(2)} (vs 1 worker)`);
  }
  console.table(
    results.map((r) => ({
      workers: r.workers,
      "temps (ms)": r.ms.toFixed(1),
      speedup: `x${r.speedup.toFixed(2)}`,
    })),
  );
  console.groupEnd();

  algorithm.disposeSession(session);

  return results;
}

export interface ContinuousProgress {
  iteration: number;
  elapsedMs: number;
  durationMs: number;
}

interface StabilityRow {
  workers: number;
  itérations: number;
  "moy (ms)": string;
  "min (ms)": string;
  "max (ms)": string;
  "écart-type (ms)": string;
  "moy speedup": string;
}

function summarizeStability(samples: Map<number, RunResult[]>): StabilityRow[] {
  return [...samples.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([workers, runs]) => {
      const msValues = runs.map((r) => r.ms);
      const avg = msValues.reduce((a, b) => a + b, 0) / msValues.length;
      const min = Math.min(...msValues);
      const max = Math.max(...msValues);
      const variance = msValues.reduce((acc, v) => acc + (v - avg) ** 2, 0) / msValues.length;
      const stddev = Math.sqrt(variance);
      const avgSpeedup = runs.reduce((a, r) => a + r.speedup, 0) / runs.length;
      return {
        workers,
        itérations: runs.length,
        "moy (ms)": avg.toFixed(1),
        "min (ms)": min.toFixed(1),
        "max (ms)": max.toFixed(1),
        "écart-type (ms)": stddev.toFixed(1),
        "moy speedup": `x${avgSpeedup.toFixed(2)}`,
      };
    });
}

export async function runContinuous<TSession>(
  algorithm: Algorithm<TSession>,
  maxWorkers: number,
  durationMs: number,
  isStopped: () => boolean,
  onProgress?: (progress: ContinuousProgress) => void,
): Promise<Map<number, RunResult[]>> {
  const session = await algorithm.createSession(maxWorkers, (message) => {
    console.log(message);
    onProgress?.({ iteration: 0, elapsedMs: 0, durationMs });
  });

  const samples = new Map<number, RunResult[]>();
  const startTime = performance.now();
  let iteration = 0;

  console.group(
    `Benchmark continu ${algorithm.label} — ${ARRAY_SIZE.toLocaleString("fr-FR")} entiers, jusqu'à ${(durationMs / 60_000).toFixed(0)} min ou arrêt manuel`,
  );

  while (!isStopped() && performance.now() - startTime < durationMs) {
    iteration++;
    const elapsedMs = performance.now() - startTime;
    onProgress?.({ iteration, elapsedMs, durationMs });

    const { results, aborted } = await algorithm.runSweep(session, maxWorkers, isStopped);
    if (aborted) break;

    console.groupCollapsed(`Itération ${iteration} — t=${(elapsedMs / 1000).toFixed(0)}s`);
    for (const r of results) {
      console.log(`workers=${r.workers} | ${r.ms.toFixed(1)} ms | speedup x${r.speedup.toFixed(2)}`);
    }
    console.groupEnd();

    for (const r of results) {
      const list = samples.get(r.workers) ?? [];
      list.push(r);
      samples.set(r.workers, list);
    }
  }

  const totalElapsedS = (performance.now() - startTime) / 1000;
  console.log(
    `Terminé — ${iteration} itération(s), ${totalElapsedS.toFixed(0)}s écoulées (stoppé manuellement: ${isStopped()}).`,
  );
  console.table(summarizeStability(samples));
  console.groupEnd();

  algorithm.disposeSession(session);

  return samples;
}
