# Audit de l'application — 31/08/2026

Audit de code complet du dépôt `outil_en_ligne_qc` (branche `main`, dernier commit
`a64ee21`). Objectif : établir l'état réel de l'application et servir de base à la
mise à jour de `CLAUDE.md`.

Méthode : lecture statique du dépôt (structure, montage des routes, chaînes de
middleware, registres de permission, configuration front, historique git).
**Aucun test d'exécution n'a été fait** — l'application n'a pas été démarrée et
aucune base DBF/Mongo n'a été interrogée. Les constats sont vérifiés par lecture
croisée de plusieurs fichiers ; ceux qui demandent une confirmation en exécution
sont signalés comme tels.

---

## 1. Chiffres

| | |
|---|---|
| Backend | 88 700 lignes JS — 75 routeurs, 77 contrôleurs, 82 services, 61 modèles, 8 middlewares |
| Frontend | 69 400 lignes JS/JSX + 54 400 lignes CSS — 95 écrans (70 admin, 15 user, 10 commercial), 63 slices RTK Query, 74 `tagTypes` |
| API | 76 montages `app.use("/api/…")` dans `server.js` |
| Permissions | 49 modules côté backend, 53 côté frontend (voir §3.1) |
| Tests | **0** (aucun fichier `.test.js` / `.spec.js`, ni back ni front) |
| Historique | 185 commits, tous sur `main`, 06→08/2026 |

Application substantielle, mono-branche, sans filet de test : toute régression
n'est détectable qu'à l'usage. C'est le contexte de tous les constats ci-dessous.

---

## 2. Architecture — ce qui tient

Les partis pris structurants sont sains et **appliqués avec constance** :

- **Deux sources de données assumées.** Mongo pour l'état applicatif, DBF pour
  l'ERP en lecture seule. Aucune écriture DBF nulle part dans le code.
- **Double dimension de contrôle d'accès** (module × société) tenue de bout en
  bout : `checkEntrepriseAccess` s'applique aux admins aussi, seul le super-admin
  (`allEntreprises`) échappe au périmètre société.
- **Surface non authentifiée réduite au strict nécessaire.** Balayage des 75
  routeurs (chaînes inline et tableaux de gardes `read`/`write`/`del`) : les
  seules routes sans `protect` sont `POST /api/users/login`,
  `/forgot-password`, `/reset-password/:token`, `/logout` (nécessaires),
  `GET /api/app-release/current` (page d'installation mobile, public assumé et
  commenté), et `/api/public/v1/*` qui utilise délibérément la chaîne
  `apiKeyAuth → limiterDebit → requireScope → chargerEntrepriseApi`. Tout le
  reste passe par `protect`.
- **Masquage DBF champ par champ par construction.** `installerMasqueDbf` enveloppe
  `res.json` globalement sur `/api` : un contrôleur ne *peut pas* oublier le
  filtrage. Coût nul si l'utilisateur n'a aucune restriction. La limite est
  documentée dans le fichier lui-même (exports Excel/PDF à filtrer à la source via
  `filtrerColonnes`).
- **`DBFFile.open` : 100 % des 19 services appelants passent `readMode: "loose"`.**
  Aucune exception — la règle est tenue.
- **Découpage routes → contrôleurs → services** respecté ; contrôleurs sous
  `asyncHandler`, erreurs centralisées.
- **Commentaires en français, denses et utiles.** Beaucoup portent le *pourquoi*
  (arbitrages client, mesures de perf, pièges) et pas seulement le *quoi*. C'est le
  principal actif documentaire du dépôt.

---

## 3. Constats

### 3.1 — Dérive des registres de permission (3 sources à maintenir)

Le même catalogue de modules existe en trois exemplaires et les trois divergent :

| Source | Modules |
|---|---|
| `backend/config/adminModules.js` | 49 |
| `frontend/src/config/adminModules.js` | 53 |
| `backend/models/PermissionModel.js` | 49 |

**Présents au front, absents du backend (4)** — donc jamais accordables par
`checkModuleAccess`, et invisibles dans l'écran d'attribution des droits :
`executables_admin`, `facture_analyse_admin`, `journal_caisse_admin`,
`top_articles_admin`.

**Déclarés dans un registre mais absents du schéma Mongo (2)** :
`analyse_reappro_admin`, `reception_suivi_admin`.

Conséquence concrète : un module absent de `PermissionModel` ne peut pas être
persisté ; le champ est ignoré à l'enregistrement. Les écrans correspondants
(`/admin/executables`, `/admin/facture-analyse`, `/admin/journal-caisse`,
`/admin/top-articles`, `/admin/analyse-reappro`, `/admin/suivi-receptions`) ne sont
donc atteignables **que par un admin** (qui court-circuite le contrôle module), pas
par un utilisateur à qui on voudrait accorder le droit.

À confirmer en exécution : le comportement exact de Mongoose sur ces clés absentes
du schéma (rejet silencieux attendu).

### 3.2 — `/api/inventaires` : le routeur a été écrasé (régression du 09/07/2026)

`backend/routes/InventaireRoutes.js` **ne contient plus les routes d'inventaire**.
Son en-tête dit `// backend/routes/inventaireZoneRoutes.js` et son contenu est une
copie (variante gatée par module au lieu de `admin`) de `inventaireZoneRoutes.js`.

Le commit `7c5bf4f` « amelioration permission » (09/07/2026) a remplacé les 32
lignes d'origine — qui montaient `createInventaire`, `scanArticle`, `addLigne`,
`exportInventaire`, `getHistorique`… — par ce clone.

Effets, tous vérifiés par lecture :

1. **`backend/controllers/inventaireController.js` (1 052 lignes) est orphelin** :
   plus aucun fichier du dépôt ne l'importe. C'est le seul contrôleur dans ce cas.
2. **`/api/inventaires` et `/api/inventaires-zones` servent aujourd'hui les mêmes
   routes**, avec deux politiques d'accès différentes (module `inventaire` d'un
   côté, `admin` de l'autre). Le premier montage est donc une porte plus permissive
   sur les mêmes actions que le second.
3. Les 10 endpoints appelés par `frontend/src/slices/inventaireApiSlice.js`
   n'existent plus côté serveur. `GET /api/inventaires/historique` tombe même sur
   `GET /:entrepriseId/historique` avec `entrepriseId = "historique"` → 404
   « Entreprise non trouvée » plutôt qu'une 404 franche.

**Portée réelle : limitée.** Les trois écrans concernés (`UserInventaire`,
`AdminInventairesScreen`, plus un import inutilisé dans `UserControleCommande`) ne
figurent **pas** dans le catalogue de menu (`menuConfig.js`) : ils ne sont plus
accessibles que par URL directe. L'inventaire opérationnel est passé aux zones +
app mobile collecteur.

C'est donc moins une panne qu'une **ambiguïté dangereuse** : un fichier nommé
`InventaireRoutes.js` qui sert autre chose, et un double montage silencieux.

### 3.3 — Deux routeurs montés sur `/api/filiales`

```js
app.use("/api/filiales", filialeRoutes);   // fillialeRoutes.js  — comparatif par ARTICLE
app.use("/api/filiales", filialesRoutes);  // filialesRoutes.js  — analyse réseau DQ/QC/LD
```

Ça fonctionne aujourd'hui **par chance** : les formes d'URL des deux routeurs ne se
recouvrent pas (le premier a `/cache-stats`, `/:dossier/article/:nart`,
`/:dossier/articles` ; le second `/`, `/:reseau`, `/:reseau/progress`,
`/:reseau/refresh`). Toute route ajoutée à l'un peut capturer celles de l'autre —
et Express résout dans l'ordre de montage, sans avertissement.

S'ajoute la confusion des noms : `fillialeRoutes.js` / `fillialeController.js`
(deux « l ») pour l'article, `filialesRoutes.js` / `filialesController.js` pour le
réseau. Idem côté front : `fillialeApiSlice.js` et `filialesApiSlice.js`.

### 3.4 — Code mort identifié

| Fichier | Lignes | Constat |
|---|---|---|
| `backend/controllers/inventaireController.js` | 1 052 | Orphelin depuis §3.2 |
| `frontend/src/screens/admin/AdminProformaScreen.jsx` | 830 | Non importé (déjà noté en mémoire projet) |
| `frontend/src/screens/admin/AdminDoublonsGencodeScreen.jsx` | 202 | Non importé (`AdminGencodDoublonsScreen` est l'écran vivant) |
| `frontend/src/utils/api.js` | 17 | Aucun consommateur — et cassé : utilise `process.env.NEXT_PUBLIC_BACKEND_URL`, convention Next.js qu'une app CRA n'expose jamais (seul `REACT_APP_*` l'est). Renverrait `undefined/api/…`. |
| `backend/controllers/dashboardController.js` + `dashboardRoutes.js` | 547 | `/api/dashboard/*` n'a **aucun appelant côté web** (conservé sciemment, cf. mémoire projet, mais sans consommateur) |

`backend/utils/preparationPaths.js` : la première moitié du fichier (87 lignes) est
commentée, la seconde est active et bien importée. Pas du code mort, mais un
fichier à nettoyer.

Commentaire périmé : `frontend/src/config/adminModules.js` renvoie à
`backend/config/dashboardCatalogue.js`, qui **n'existe pas**.

### 3.5 — `exemple.env` est très en retard sur le code

Le backend lit 33 variables d'environnement. `exemple.env` en documente 15.

**Absentes du modèle alors qu'elles pilotent la bascule dev/prod** :
`DBF_BASE_PATH`, `RCOMMON_STOCK_ROOT`, `RCOMMON_COLLECT_PATH`, `STOCK_SHARE_PATH`,
`PHOTOS_BASE_PATH`, `REAPRO_MAG_DIR`, `ANALYSE_CA_DICTIONNAIRE_PATH`,
`FRONTEND_BUILD_PATH`, `FRONTEND_URL`, `RUN_FICHE_WATCHER`, `PRINTER_NAME`,
`FICHE_AUTOPRINT`, `FICHE_WATCH_INTERVAL_MS`, `DAT_FILENAME_PREFIX`,
`DAT_FILENAME_REGEX`, `MAIL_TRACK_SECRET`, `MONGODB_URI` (alias de `MONGO_URI`).

Côté frontend, `REACT_APP_MAPBOX_TOKEN` (carte des collecteurs) et
`REACT_APP_API_TARGET` (proxy de dev) ne sont documentés nulle part.

Une installation neuve à partir d'`exemple.env` seul ne peut pas fonctionner en
production. C'est le point le plus coûteux de l'audit pour quelqu'un qui reprend le
projet.

Incohérence mineure : `CLIENT_URL` figure dans `exemple.env` mais n'est lu par
aucun fichier backend ; c'est `FRONTEND_URL` qui pilote CORS.

### 3.6 — Port par défaut trompeur

`server.js` : `const PORT = process.env.PORT || 8000;` — mais tout le reste de la
chaîne suppose **5000** : le `proxy` de `frontend/package.json`, le défaut de
`setupProxy.js`, et le `PORT=5000` du `.env` local. Sans `.env`, le backend démarre
sur un port que le front ne sait pas joindre.

### 3.7 — `reportScheduler` toujours non branché

`startReportScheduler()` existe (`services/reportScheduler.js`, cron
`Pacific/Noumea`, verrou optimiste `nextRunAt`) et n'est appelé **nulle part**.
Les 7 autres démarrages de tâches de fond sont bien câblés dans `server.js`. Les
abonnements aux rapports (`/api/report-subscriptions`, écran présent) ne partent
donc jamais automatiquement. Constat déjà présent dans `CLAUDE.md` — toujours vrai.

### 3.8 — Prolifération des implémentations de cache

**19 services** ouvrent `DBFFile` directement et **~30 caches TTL indépendants**
coexistent, avec des durées allant de 30 s à 15 min et trois familles de style :
classe avec `this.cacheTTL` + `loadingLocks` (`articleService`), module avec
`TTL_MS` et `Map`, index colonnaires en TypedArrays (`frequentationService`,
`commercialService`).

Ce n'est pas un défaut en soi — les arbitrages sont motivés et souvent mesurés
(cf. les notes de perf sur `commercialService`). Mais il n'y a **aucune couche
commune** : pas d'invalidation globale, pas de vue d'ensemble de l'occupation
mémoire, pas de politique unifiée mtime vs TTL seul. Sur un process unique qui
charge en RAM 1,7 M factures + 6,2 M lignes pour certaines sociétés, c'est le
risque structurel principal de l'application.

À mesurer (non fait ici) : l'empreinte mémoire réelle du process avec plusieurs
sociétés chaudes simultanément.

### 3.9 — Volumétrie de fichiers

Quelques fichiers dépassent nettement la taille où ils restent lisibles :

- `backend/controllers/receptionController.js` — 3 226 lignes
- `frontend/src/screens/admin/EnvoiCdeFournisseurScreen.jsx` — 3 203 lignes
- `backend/services/envoiCdeFournisseurService.js` — 2 461 lignes
- `backend/controllers/inventaireCollecteController.js` — 2 235 lignes
- `frontend/src/components/Admin/EntrepriseModal.jsx` — 1 890 lignes

Le contrat « contrôleurs minces » posé par les conventions n'est pas tenu sur les
plus gros modules.

Côté CSS : 54 400 lignes, essentiellement un fichier par écran, sans système
partagé — cohérent avec le chantier « composants réutilisables » déjà engagé.

### 3.10 — Absence totale de tests

Aucun fichier de test dans le dépôt. `cd frontend && npm test` existe (fourni par
CRA) mais ne trouve rien à exécuter — la mention de `CLAUDE.md` est à corriger.

Pour un backend qui produit des documents fiscaux (rapports TGC), des fichiers de
transfert lus par l'ERP (`.dat`) et des emails vers des fournisseurs, l'absence de
tests sur les fonctions pures (calcul de bases TGC, format `.dat`, règles de
périmètre commercial, `assertGrantWithinScope`) est le manque le plus structurant.
Ce sont aussi les cibles les plus faciles : entrées/sorties simples, pas d'I/O.

---

## 4. Ce qui n'a pas été audité

À ne pas confondre avec « sain » :

- **Exécution** : rien n'a été lancé, aucune requête émise, aucune perf mesurée.
- **Sécurité applicative en profondeur** : pas de revue d'injection, de traversée
  de chemin sur les entrées `:nomDossierDBF` (construites en `path.join` avec des
  valeurs venant de la base, mais aussi d'URL), ni de revue des uploads multer
  (13 routeurs concernés).
- **Absence de limitation de débit sur la connexion** : `limiterDebit` n'existe
  que pour l'API partenaire ; `/api/users/login` n'a pas de garde anti-force brute.
  Signalé, non instruit.
- **App mobile** (`test-app-qc/QcApp`, Expo/React Native) : dépôt git séparé,
  exclu du périmètre.
- **Dette CSS** : volumétrie relevée, contenu non analysé.
- **Dépendances** : pas d'`npm audit`, pas de revue des versions.

---

## 5. Suites proposées, par rapport valeur/effort

1. **Compléter `exemple.env`** avec les 18 variables manquantes et un commentaire
   dev/prod par variable. Effort : une heure. Débloque toute reprise du projet.
2. **Réduire les registres de permission de 3 à 1.** Générer le schéma
   `PermissionModel.modules` depuis `backend/config/adminModules.js`, et faire du
   registre front un import ou un fichier généré. Supprime définitivement la classe
   de bug §3.1.
3. **Trancher le cas `/api/inventaires`** : soit restaurer les routes d'origine
   (`git show 7c5bf4f^:backend/routes/InventaireRoutes.js`), soit supprimer le
   montage, le fichier, le contrôleur orphelin, le slice et les deux écrans.
   L'ambiguïté actuelle est le pire des deux.
4. **Nommer explicitement les deux routeurs `filiales`** et les monter sur deux
   préfixes distincts (`/api/filiales-article` et `/api/filiales-reseau`).
5. **Aligner le port par défaut sur 5000** dans `server.js`.
6. **Câbler ou retirer `reportScheduler`.** L'écran d'abonnement laisse croire à un
   envoi automatique qui n'a pas lieu.
7. **Poser les premiers tests** sur les fonctions pures à fort enjeu : calcul TGC,
   format `.dat`, `assertGrantWithinScope`, périmètre commercial.
8. **Purger le code mort** listé en §3.4 (~2 600 lignes).
