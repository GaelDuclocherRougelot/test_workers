// Fusionne deux runs triés adjacents src[start,mid) et src[mid,end) dans
// dst[start,end). Boucle à deux pointeurs, sans allocation : c'est la partie
// qui tourne des millions de fois, donc la moindre allocation par élément
// (closures, destructuring) s'y paie cash.
function mergeAdjacentRuns(
  src: Uint32Array<ArrayBufferLike>,
  start: number,
  mid: number,
  end: number,
  dst: Uint32Array<ArrayBufferLike>,
): void {
  let i = start;
  let j = mid;
  let k = start;
  while (i < mid && j < end) {
    dst[k++] = src[i] <= src[j] ? src[i++] : src[j++];
  }
  while (i < mid) dst[k++] = src[i++];
  while (j < end) dst[k++] = src[j++];
}

// Merge bottom-up des runs triés délimités par `boundaries` (ex: [0, 300000,
// 600000, ..., ARRAY_SIZE]) — les runs sont déjà dans le bon ordre relatif
// puisqu'ils correspondent à des plages d'index contiguës. On double la
// taille des runs à chaque passe en ping-pongant entre deux buffers pleine
// taille réutilisés d'une passe à l'autre (pas d'allocation par run).
export function mergeIndexRangeRuns(
  workBuffer: SharedArrayBuffer,
  boundaries: number[],
  scratch: Uint32Array<ArrayBufferLike>,
): Uint32Array<ArrayBufferLike> {
  let src: Uint32Array<ArrayBufferLike> = new Uint32Array(workBuffer);
  let dst: Uint32Array<ArrayBufferLike> = scratch;
  let runBoundaries = boundaries;

  while (runBoundaries.length > 2) {
    const nextBoundaries: number[] = [runBoundaries[0]];

    for (let i = 0; i < runBoundaries.length - 1; i += 2) {
      const start = runBoundaries[i];
      const mid = runBoundaries[i + 1];

      if (i + 2 < runBoundaries.length) {
        const end = runBoundaries[i + 2];
        mergeAdjacentRuns(src, start, mid, end, dst);
        nextBoundaries.push(end);
      } else {
        // Run impair sans partenaire : recopié tel quel pour la passe suivante.
        dst.set(src.subarray(start, mid), start);
        nextBoundaries.push(mid);
      }
    }

    runBoundaries = nextBoundaries;
    const swap = src;
    src = dst;
    dst = swap;
  }

  return src;
}
