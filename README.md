# test_workers

Benchmark de Web Workers : trouver le "sweet spot" du nombre de workers pour
paralléliser un calcul lourd, en mesurant le temps (ms) et le speedup par
rapport à un run à 1 seul worker.

## Le calcul

Tri par comptage (counting sort) de 5 000 000 d'entiers aléatoires (valeurs
entre 0 et 5 000 000). Ce tri se parallélise naturellement en découpant
l'espace des **valeurs** (et non les index) entre N workers : chaque worker
scanne tout le tableau source mais ne compte que les occurrences de sa
sous-plage de valeurs. Le volume de travail total (5M comptages) est donc
constant quel que soit N, ce qui rend la comparaison entre différents nombres
de workers équitable.

Le tableau source aléatoire est lui-même généré dans un worker dédié : le
thread principal n'est jamais bloqué, y compris pendant la préparation des
données de test.

## Partage des données : SharedArrayBuffer

Le tableau source (20 Mo) et le tableau de comptage sont des
`SharedArrayBuffer`, partagés par référence avec tous les workers sans aucune
copie, quel que soit le nombre de workers. Les alternatives ont été écartées :
- `postMessage` classique copierait le tableau à chaque worker (coût qui
  croît avec N et fausserait la mesure de speedup) ;
- un `ArrayBuffer` transférable détruit l'ownership au transfert, incompatible
  avec plusieurs workers lisant le même tableau simultanément.

Les écritures concurrentes dans le tableau de comptage utilisent
`Atomics.add` (garantie de visibilité mémoire inter-agents pour un
`SharedArrayBuffer`).

`SharedArrayBuffer` exige un contexte cross-origin isolé
(`self.crossOriginIsolated === true`), fourni ici via les headers
`Cross-Origin-Opener-Policy: same-origin` et
`Cross-Origin-Embedder-Policy: require-corp` configurés dans
`vite.config.ts` (dev server et `vite preview`). **Ces headers ne sont pas
automatiquement présents sur un déploiement statique** (Netlify, Vercel,
Nginx...) : il faudra les reconfigurer côté hébergeur pour toute mise en
production.

## Flow

```mermaid
flowchart TD
    A["index.html — clic sur un bouton"] --> B["main.ts"]
    B --> C["orchestrator.ts"]

    C --> D1["① createSession — une seule fois par session"]
    D1 --> D2["Alloue les SharedArrayBuffer (source, counts/work, scratch)"]
    D1 --> D3["generator.worker remplit sourceSAB (5M entiers aléatoires)"]
    D1 --> D4["Spawn le pool de N workers, réutilisé pour tous les runs"]

    D2 --> E["② runSweep(n = 1 → maxWorkers)"]
    D3 --> E
    D4 --> E
    E -.->|"mode continu: boucle jusqu'à 10 min ou Stop"| E

    E --> F{Algorithme choisi}

    F -->|Plage de valeurs| G1["Découpe [0, MAX_VALUE] en n tranches de VALEURS"]
    G1 --> G2["n × sortWorker.worker :<br/>relit tout le tableau source,<br/>Atomics.add(counts[v]) si v dans sa plage"]
    G2 --> G3["Fusion main thread : counts → tableau trié<br/>coût CONSTANT, indépendant de n"]

    F -->|Plage d'index| H1["Découpe [0, ARRAY_SIZE] en n tranches d'INDEX"]
    H1 --> H2["n × indexSortWorker.worker :<br/>lit sa tranche, copie + sort local dans workBuffer"]
    H2 --> H3["Fusion main thread : merge bottom-up pairwise<br/>coût O(log n), croît avec n"]

    G3 --> I["③ ms = performance.now() après − avant<br/>speedup = ms(n=1) / ms(n)<br/>console.log + console.table"]
    H3 --> I

    I --> J["④ disposeSession — terminate() tous les workers"]
```

Points clés :
- Le pool de workers et les buffers sont créés **une seule fois par session**
  (pas à chaque run) : sinon le coût de spawn/allocation croîtrait avec le
  nombre de runs et fausserait la mesure (et finissait par faire planter la
  page sur les sessions longues).
- La différence entre les deux algorithmes se joue uniquement dans le
  découpage et la fusion : "plage de valeurs" paie des lectures redondantes
  mais a une fusion à coût fixe (scale loin) ; "plage d'index" paie une
  fusion qui grossit avec N (plafonne plus tôt).
- Rien ne touche le main thread pendant le calcul lourd : génération, comptage
  et tri se font tous dans des workers ; le main thread ne fait que
  `performance.now()`, `Promise.all` et la fusion finale (rapide).

## Lancer le benchmark

```bash
npm install
npm run dev
```

Ouvrir l'URL locale affichée, choisir un nombre max de workers, cliquer sur
"Lancer le benchmark". Les résultats détaillés (temps par run, speedup) et un
tableau récapitulatif s'affichent dans la console du navigateur.
