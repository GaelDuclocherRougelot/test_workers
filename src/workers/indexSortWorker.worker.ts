import type { SortRangeRequest, SortRangeDone } from "../benchmark/types";

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SortRangeRequest>) => void) | null;
  postMessage: (message: SortRangeDone) => void;
};

ctx.onmessage = ({ data }) => {
  const { sourceBuffer, workBuffer, rangeStart, rangeEndExclusive, workerId } = data;
  const length = rangeEndExclusive - rangeStart;
  const byteOffset = rangeStart * Uint32Array.BYTES_PER_ELEMENT;

  // Chaque worker ne lit que sa propre tranche du tableau source (contre
  // l'intégralité du tableau dans la variante par plage de valeurs), et
  // n'écrit que dans sa tranche disjointe du buffer de travail : pas besoin
  // d'Atomics ici, aucune autre worker ne touche cette zone.
  const src = new Uint32Array(sourceBuffer, byteOffset, length);
  const dst = new Uint32Array(workBuffer, byteOffset, length);
  dst.set(src);
  dst.sort(); // tri numérique ascendant par défaut sur un TypedArray

  ctx.postMessage({ type: "sortRangeDone", workerId });
};
