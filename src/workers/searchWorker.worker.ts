import type { SearchRequest, SearchDone } from "../benchmark/types";
import { CHECK_INTERVAL, WORKER_STATE } from "../benchmark/constants";

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage: (message: SearchDone) => void;
};

ctx.onmessage = ({ data }) => {
  const { sourceBuffer, targetValue, rangeStart, rangeEndExclusive, stateBuffer, foundIndexBuffer, workerId } = data;
  const source = new Uint32Array(sourceBuffer);
  const state = new Int32Array(stateBuffer);
  const foundIndex = new Int32Array(foundIndexBuffer);

  Atomics.store(state, workerId, WORKER_STATE.SEARCHING);

  let outcome: SearchDone["outcome"] = "not-found";
  let scanned = 0;

  for (let i = rangeStart; i < rangeEndExclusive; i++) {
    scanned++;

    if (source[i] === targetValue) {
      // Un seul worker peut "gagner" l'échange (-1 -> son index) : c'est lui
      // le premier à avoir réellement trouvé la target. Les autres, s'ils
      // tombaient sur la même valeur (peu probable ici puisqu'elle est
      // réservée/unique), se contentent de constater qu'ils sont arrivés
      // seconds.
      const won = Atomics.compareExchange(foundIndex, 0, -1, i) === -1;
      outcome = won ? "found" : "stopped-early";
      Atomics.store(state, workerId, won ? WORKER_STATE.FOUND : WORKER_STATE.STOPPED);
      break;
    }

    // Vérification périodique (pas à chaque élément, pour ne pas payer le
    // coût d'une lecture atomique sur toute la boucle) : un autre worker a-t-il
    // déjà trouvé la target ? Si oui, arrêt anticipé — c'est le cœur de la
    // coordination.
    if (scanned % CHECK_INTERVAL === 0 && Atomics.load(foundIndex, 0) !== -1) {
      outcome = "stopped-early";
      Atomics.store(state, workerId, WORKER_STATE.STOPPED);
      break;
    }
  }

  if (outcome === "not-found") {
    Atomics.store(state, workerId, WORKER_STATE.IDLE);
  }

  ctx.postMessage({ type: "searchDone", workerId, outcome, elementsScanned: scanned });
};
