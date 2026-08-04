import type { RunResult } from "./result";

export interface StabilityStats {
  workers: number;
  iterations: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  stddevMs: number;
  speedup: number;
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Agrège les échantillons d'un mode continu (plusieurs itérations par nombre
// de workers) en une ligne de stats par nombre de workers. Utilisé à la fois
// pour le tableau de stabilité (runner.ts) et pour le graphique (chart.ts) —
// une seule implémentation pour éviter que les deux divergent.
export function computeStabilityStats(samples: Map<number, RunResult[]>): StabilityStats[] {
  return [...samples.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([workers, runs]) => {
      const msValues = runs.map((r) => r.ms);
      const totalMs = average(msValues);
      const minMs = Math.min(...msValues);
      const maxMs = Math.max(...msValues);
      const variance = msValues.reduce((acc, v) => acc + (v - totalMs) ** 2, 0) / msValues.length;
      const stddevMs = Math.sqrt(variance);
      const speedup = average(runs.map((r) => r.speedup));
      return { workers, iterations: runs.length, totalMs, minMs, maxMs, stddevMs, speedup };
    });
}
