export interface RunResult {
  workers: number;
  ms: number;
  speedup: number;
  foundBy: number; // id du worker ayant trouvé la target (-1 si non trouvée)
}
