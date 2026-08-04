export const ARRAY_SIZE = 5_000_000;
export const MAX_VALUE = 5_000_000; // valeurs dans [0, MAX_VALUE]

// Index fixe (pas aléatoire) pour que le temps de recherche soit comparable
// d'un nombre de workers à l'autre au sein d'un même run : on cherche
// toujours "la même aiguille dans la même botte de foin". Volontairement
// proche de la fin du tableau : pire cas pour une recherche à 1 worker
// (il doit scanner ~95% du tableau), donc bon cas pour démontrer le gain de
// la parallélisation.
export const TARGET_INDEX = Math.floor(ARRAY_SIZE * 0.95);

// Nombre d'éléments scannés entre deux vérifications du flag "found" partagé
// (Atomics.load) : trop bas, le coût des lectures atomiques répétées pèse
// sur le scan lui-même ; trop haut, la réaction à la découverte d'un autre
// worker est tardive.
export const CHECK_INTERVAL = 2048;

// États des workers, stockés dans un Int32Array partagé (un slot par
// worker) et mis à jour via Atomics.store — observables depuis le main
// thread par simple lecture mémoire, sans passer par postMessage.
export const WORKER_STATE = {
  IDLE: 0,
  SEARCHING: 1,
  FOUND: 2,
  STOPPED: 3,
} as const;
