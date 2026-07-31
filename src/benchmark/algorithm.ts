export interface RunResult {
  workers: number;
  ms: number; // total = computeMs + fusionMs (+ overhead marginal du main thread)
  computeMs: number; // temps du Promise.all sur les workers de calcul (comptage/tri)
  fusionMs: number; // temps du dispatch de fusion/merge vers pool[0]
  speedup: number;
}

export interface SweepOutcome {
  results: RunResult[];
  aborted: boolean;
}

// Les deux algorithmes exposent la même forme (session + sweep + dispose) ;
// seule cette forme commune est factorisée dans runOneShot/runContinuous
// (voir runner.ts), chaque algorithme reste responsable de son propre
// découpage et de sa propre fusion.
export interface Algorithm<TSession> {
  label: string;
  createSession: (maxWorkers: number, onProgress?: (message: string) => void) => Promise<TSession>;
  disposeSession: (session: TSession) => void;
  runSweep: (
    session: TSession,
    maxWorkers: number,
    isStopped: () => boolean,
    onProgress?: (message: string) => void,
  ) => Promise<SweepOutcome>;
}
