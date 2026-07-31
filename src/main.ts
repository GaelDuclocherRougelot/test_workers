import {
  runBenchmark,
  runContinuousBenchmark,
  runIndexRangeBenchmark,
  runIndexRangeContinuousBenchmark,
  computeStabilityStats,
  renderChart,
  renderTable,
  formatRunResultRow,
  formatStabilityRow,
} from "./benchmark/orchestrator";

const CONTINUOUS_DURATION_MS = 10 * 60 * 1000;

const algorithmSelect = document.querySelector<HTMLSelectElement>("#algorithm")!;
const maxWorkersInput = document.querySelector<HTMLInputElement>("#max-workers")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop-button")!;
const statusEl = document.querySelector<HTMLPreElement>("#status")!;
const chartCanvas = document.querySelector<HTMLCanvasElement>("#chart")!;
const resultsTableEl = document.querySelector<HTMLDivElement>("#results-table")!;

const defaultMaxWorkers = Math.min(32, (navigator.hardwareConcurrency || 4) * 2);
maxWorkersInput.value = String(defaultMaxWorkers);

console.log("crossOriginIsolated:", self.crossOriginIsolated);

let stopRequested = false;

function readMaxWorkers(): number {
  return Math.max(1, Number(maxWorkersInput.value) || defaultMaxWorkers);
}

function isIndexRangeSelected(): boolean {
  return algorithmSelect.value === "index-range";
}

function setControlsEnabled(enabled: boolean): void {
  runButton.disabled = !enabled;
  startButton.disabled = !enabled;
  maxWorkersInput.disabled = !enabled;
  algorithmSelect.disabled = !enabled;
  stopButton.disabled = enabled;
}

if (typeof SharedArrayBuffer === "undefined" || !self.crossOriginIsolated) {
  setControlsEnabled(false);
  stopButton.disabled = true;
  statusEl.textContent =
    "SharedArrayBuffer indisponible : ce contexte n'est pas cross-origin isolé " +
    "(vérifiez les headers Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy).";
} else {
  runButton.addEventListener("click", async () => {
    setControlsEnabled(false);
    const run = isIndexRangeSelected() ? runIndexRangeBenchmark : runBenchmark;

    try {
      const results = await run(readMaxWorkers(), (message) => {
        statusEl.textContent = message;
      });
      renderChart(
        chartCanvas,
        results.map((r) => ({
          workers: r.workers,
          computeMs: r.computeMs,
          fusionMs: r.fusionMs,
          totalMs: r.ms,
          speedup: r.speedup,
        })),
        `One-shot — ${isIndexRangeSelected() ? "plage d'index" : "plage de valeurs"}`,
      );
      renderTable(resultsTableEl, results.map(formatRunResultRow));
      statusEl.textContent = "Terminé — résultats dans la console.";
    } finally {
      setControlsEnabled(true);
    }
  });

  startButton.addEventListener("click", async () => {
    setControlsEnabled(false);
    stopRequested = false;
    const runContinuous = isIndexRangeSelected() ? runIndexRangeContinuousBenchmark : runContinuousBenchmark;

    try {
      const samples = await runContinuous(
        readMaxWorkers(),
        CONTINUOUS_DURATION_MS,
        () => stopRequested,
        ({ iteration, elapsedMs, durationMs }) => {
          const remainingS = Math.max(0, Math.round((durationMs - elapsedMs) / 1000));
          statusEl.textContent =
            iteration === 0
              ? "Génération du tableau source..."
              : `Itération ${iteration} — ${remainingS}s restantes (Stop pour arrêter plus tôt)...`;
        },
      );
      renderChart(
        chartCanvas,
        computeStabilityStats(samples),
        `Continu — ${isIndexRangeSelected() ? "plage d'index" : "plage de valeurs"} (moyenne + min/max)`,
      );
      renderTable(resultsTableEl, computeStabilityStats(samples).map(formatStabilityRow));
      statusEl.textContent = stopRequested
        ? "Arrêté manuellement — statistiques de stabilité dans la console."
        : "Terminé (10 min) — statistiques de stabilité dans la console.";
    } finally {
      setControlsEnabled(true);
    }
  });

  stopButton.addEventListener("click", () => {
    stopRequested = true;
    statusEl.textContent = "Arrêt demandé, fin de l'itération en cours...";
  });
}
