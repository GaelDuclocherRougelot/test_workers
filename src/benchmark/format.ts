import type { RunResult } from "./algorithm";
import type { StabilityStats } from "./stats";

// Formatage partagé entre les tables console.table (runner.ts) et la table
// HTML affichée sur la page (main.ts), pour ne pas dupliquer les .toFixed()
// à deux endroits.
export interface FormattedRow {
  [column: string]: string | number;
}

export function formatRunResultRow(r: RunResult): FormattedRow {
  return {
    workers: r.workers,
    "calcul (ms)": r.computeMs.toFixed(1),
    "fusion (ms)": r.fusionMs.toFixed(1),
    "total (ms)": r.ms.toFixed(1),
    speedup: `x${r.speedup.toFixed(2)}`,
  };
}

export function formatStabilityRow(s: StabilityStats): FormattedRow {
  return {
    workers: s.workers,
    itérations: s.iterations,
    "moy calcul (ms)": s.computeMs.toFixed(1),
    "moy fusion (ms)": s.fusionMs.toFixed(1),
    "moy total (ms)": s.totalMs.toFixed(1),
    "min (ms)": s.minMs.toFixed(1),
    "max (ms)": s.maxMs.toFixed(1),
    "écart-type (ms)": s.stddevMs.toFixed(1),
    "moy speedup": `x${s.speedup.toFixed(2)}`,
  };
}
