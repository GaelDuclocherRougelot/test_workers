import { WORKER_STATE } from "./constants";

const STATE_COLOR: Record<number, string> = {
  [WORKER_STATE.IDLE]: "#bbb",
  [WORKER_STATE.SEARCHING]: "#4f8fea",
  [WORKER_STATE.FOUND]: "#2fa84f",
  [WORKER_STATE.STOPPED]: "#f2a541",
};

const STATE_LABEL: Record<number, string> = {
  [WORKER_STATE.IDLE]: "idle",
  [WORKER_STATE.SEARCHING]: "searching",
  [WORKER_STATE.FOUND]: "found",
  [WORKER_STATE.STOPPED]: "stopped",
};

// Snapshot visuel des états (lus directement dans le Int32Array partagé, pas
// via message) : un carré par worker actif, coloré selon son état courant.
export function renderWorkerStates(container: HTMLElement, state: Int32Array, n: number): void {
  container.replaceChildren();

  for (let i = 0; i < n; i++) {
    const value = Atomics.load(state, i);
    const badge = document.createElement("span");
    badge.title = `worker ${i} : ${STATE_LABEL[value] ?? value}`;
    badge.textContent = String(i);
    badge.style.cssText = [
      "display: inline-flex",
      "align-items: center",
      "justify-content: center",
      "width: 22px",
      "height: 22px",
      "margin: 2px",
      "border-radius: 4px",
      "font-size: 11px",
      "color: #fff",
      `background: ${STATE_COLOR[value] ?? "#000"}`,
    ].join(";");
    container.appendChild(badge);
  }
}
