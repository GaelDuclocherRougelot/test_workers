export interface ChartPoint {
  workers: number;
  totalMs: number;
  speedup: number;
  minMs?: number;
  maxMs?: number;
}

const COLOR_BAR = "#4f8fea";
const COLOR_SPEEDUP = "#e0435c";
const COLOR_RANGE = "rgba(0, 0, 0, 0.4)";
const COLOR_AXIS = "#666";
const COLOR_GRID = "#e5e5e5";

// Rendu canvas 2D volontairement sans lib externe (cohérent avec le reste du
// projet, vanilla TS) : une barre par nombre de workers (axe de gauche, ms),
// une ligne de speedup superposée (axe de droite, x0.0), et en mode continu
// une barre d'erreur min/max verticale par nombre de workers.
export function renderChart(canvas: HTMLCanvasElement, points: ChartPoint[], title: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || points.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const margin = { top: 28, right: 52, bottom: 34, left: 44 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const plotBottom = margin.top + plotHeight;

  const maxMs = Math.max(...points.map((p) => p.maxMs ?? p.totalMs)) * 1.15;
  const maxSpeedup = Math.max(...points.map((p) => p.speedup), 1) * 1.15;

  const msY = (ms: number) => plotBottom - (ms / maxMs) * plotHeight;
  const speedupY = (s: number) => plotBottom - (s / maxSpeedup) * plotHeight;

  const n = points.length;
  const bandWidth = plotWidth / n;
  const barWidth = Math.min(bandWidth * 0.5, 36);

  ctx.fillStyle = "#333";
  ctx.font = "12px sans-serif";
  ctx.fillText(title, margin.left, 16);

  // Grille + axe gauche (ms)
  ctx.font = "10px sans-serif";
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const ms = (maxMs * i) / ySteps;
    const y = msY(ms);
    ctx.strokeStyle = COLOR_GRID;
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.fillStyle = COLOR_AXIS;
    ctx.fillText(ms.toFixed(0), 2, y + 3);
  }

  // Axe droit (speedup)
  ctx.fillStyle = COLOR_SPEEDUP;
  for (let i = 0; i <= ySteps; i++) {
    const s = (maxSpeedup * i) / ySteps;
    const y = speedupY(s);
    ctx.fillText(`x${s.toFixed(1)}`, width - margin.right + 4, y + 3);
  }

  points.forEach((p, i) => {
    const xCenter = margin.left + bandWidth * (i + 0.5);
    const xBar = xCenter - barWidth / 2;

    const yTotal = msY(p.totalMs);
    ctx.fillStyle = COLOR_BAR;
    ctx.fillRect(xBar, yTotal, barWidth, plotBottom - yTotal);

    if (p.minMs !== undefined && p.maxMs !== undefined) {
      const yMin = msY(p.minMs);
      const yMax = msY(p.maxMs);
      ctx.strokeStyle = COLOR_RANGE;
      ctx.beginPath();
      ctx.moveTo(xCenter, yMin);
      ctx.lineTo(xCenter, yMax);
      ctx.moveTo(xCenter - 5, yMin);
      ctx.lineTo(xCenter + 5, yMin);
      ctx.moveTo(xCenter - 5, yMax);
      ctx.lineTo(xCenter + 5, yMax);
      ctx.stroke();
    }

    ctx.fillStyle = COLOR_AXIS;
    ctx.font = "10px sans-serif";
    const label = String(p.workers);
    ctx.fillText(label, xCenter - ctx.measureText(label).width / 2, plotBottom + 14);
  });

  // Ligne de speedup
  ctx.strokeStyle = COLOR_SPEEDUP;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = margin.left + bandWidth * (i + 0.5);
    const y = speedupY(p.speedup);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = COLOR_SPEEDUP;
  points.forEach((p, i) => {
    const x = margin.left + bandWidth * (i + 0.5);
    const y = speedupY(p.speedup);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Légende
  ctx.font = "10px sans-serif";
  let legendX = margin.left;
  const legendY = height - 4;
  const legendItem = (color: string, label: string, isLine = false) => {
    if (isLine) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY - 4);
      ctx.lineTo(legendX + 10, legendY - 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY - 8, 10, 8);
    }
    ctx.fillStyle = "#333";
    ctx.fillText(label, legendX + 13, legendY);
    legendX += ctx.measureText(label).width + 26;
  };
  legendItem(COLOR_BAR, "temps (ms)");
  legendItem(COLOR_SPEEDUP, "speedup", true);
}
