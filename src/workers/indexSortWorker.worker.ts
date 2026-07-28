import type { SortRangeRequest, SortRangeDone, MergeRunsRequest, MergeRunsDone } from "../benchmark/types";
import { mergeIndexRangeRuns } from "./mergeRuns";

type Request = SortRangeRequest | MergeRunsRequest;
type Response = SortRangeDone | MergeRunsDone;

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: Response) => void;
};

ctx.onmessage = ({ data }) => {
  if (data.type === "mergeRuns") {
    const scratch = new Uint32Array(data.scratchBuffer);
    mergeIndexRangeRuns(data.workBuffer, data.boundaries, scratch);
    ctx.postMessage({ type: "mergeRunsDone" });
    return;
  }

  const { sourceBuffer, workBuffer, rangeStart, rangeEndExclusive, workerId } = data;
  const length = rangeEndExclusive - rangeStart;
  const byteOffset = rangeStart * Uint32Array.BYTES_PER_ELEMENT;

  // Chaque worker ne lit que sa propre tranche du tableau source (contre
  // l'intégralité du tableau dans la variante par plage de valeurs), et
  // n'écrit que dans sa tranche disjointe du buffer de travail : pas besoin
  // d'Atomics ici, aucun autre worker ne touche cette zone.
  const src = new Uint32Array(sourceBuffer, byteOffset, length);
  const dst = new Uint32Array(workBuffer, byteOffset, length);
  dst.set(src);
  dst.sort(); // tri numérique ascendant par défaut sur un TypedArray

  ctx.postMessage({ type: "sortRangeDone", workerId });
};
