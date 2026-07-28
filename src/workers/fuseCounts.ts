// Étale un tableau de comptages en tableau trié : pour chaque valeur, écrit
// `count` occurrences à la suite dans `sorted`. Coût linéaire, indépendant
// du nombre de workers ayant produit les comptages. Retourne le nombre total
// d'éléments écrits, pour vérification côté appelant.
export function fuseCounts(counts: Uint32Array<ArrayBufferLike>, valueCount: number, sorted: Uint32Array<ArrayBufferLike>): number {
  let cursor = 0;
  for (let value = 0; value < valueCount; value++) {
    const count = counts[value];
    if (count > 0) {
      sorted.fill(value, cursor, cursor + count);
      cursor += count;
    }
  }
  return cursor;
}
