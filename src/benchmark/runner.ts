import { ARRAY_SIZE } from "./constants";
import type { Algorithm, RunResult } from "./algorithm";
import { computeStabilityStats } from "./stats";
import { formatRunResultRow, formatStabilityRow } from "./format";

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
  // Table indexée par nombre de workers (au lieu de l'index d'array 0..N-1
  // par défaut de console.table, qui doublonnait avec "workers" et prêtait à
  // confusion).
  console.table(Object.fromEntries(results.map((r) => [r.workers, formatRunResultRow(r)])));
  console.groupEnd();

  algorithm.disposeSession(session);

  return results;
}

export interface ContinuousProgress {
  iteration: number;
  elapsedMs: number;
  durationMs: number;
}

// Indexée par nombre de workers (au lieu de l'index d'array 0..N-1 par
// défaut de console.table), pour ne pas doublonner avec une colonne
// "workers" séparée.
function summarizeStability(samples: Map<number, RunResult[]>): Record<number, ReturnType<typeof formatStabilityRow>> {
  return Object.fromEntries(computeStabilityStats(samples).map((s) => [s.workers, formatStabilityRow(s)]));
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
