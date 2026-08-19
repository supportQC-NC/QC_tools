# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Internal multi-tenant B2B tool for a hardware-store group ("Quincaillerie") in New Caledonia. It reads a legacy DBF/ERP dataset per company and exposes search, inventory, ordering, reception, and reporting/analytics screens. The codebase, comments, and UI are in **French** — follow that convention when writing code and comments.

## Commands

Run from the repo root:

- `npm run dev` — run backend (nodemon) + frontend (CRA) together via concurrently
- `npm run server` — backend only, `nodemon backend/server.js` (port 5000)
- `npm run client` — frontend only, `npm start --prefix frontend` (port 3000, proxies `/api` → 5000)
- `npm start` — production backend, `node backend/server.js`
- `npm run data:import` — seed Mongo with users/permissions/entreprises from `backend/data/*.js`
- `npm run data:destroy` — wipe seeded data
- `cd frontend && npm run build` — production React build (served by Express when `NODE_ENV=production`)
- `cd frontend && npm test` — CRA/Jest tests (react-scripts). There are no backend tests.

Env is loaded by `backend/loadEnv.js`, which **must stay the first import in `server.js`** (some services read env at module-load time). Copy `exemple.env` to `.env`.

## Two data sources (this is the core architecture)

The app is **not** a normal Mongo CRUD app. It has two distinct backends:

1. **MongoDB (Mongoose)** — the app's own state: users, permissions, entreprises, inventory sessions/zones, bipages, report subscriptions, app releases. Models in `backend/models/`.
2. **Legacy DBF files** — the ERP's read-only source of truth: articles, clients, suppliers, orders, proformas, invoices. Read with the `dbffile` package. This data is **never written back**.

Everything DBF-backed is **scoped per company** by the `:nomDossierDBF` route param. An `Entreprise` document maps `nomDossierDBF` + `trigramme` → filesystem paths (`cheminBase`, `cheminExportInventaire`, `cheminRapportReception`, etc.). Reading raw DBF on every request is too slow (~90k+ articles), so several **cache services** (`articleService.js`/`*CacheService.js`) load a company's DBF into an in-memory `Map` with prebuilt indexes (by NART, GENCOD, GROUPE…) and a ~5-minute TTL. When touching DBF reads, prefer the cache service over opening `DBFFile` directly.

### Dev/prod path switching

Company paths are stored as Windows UNC (`\\server\Bases\...`) for local dev on Windows. In production (Ubuntu), env vars override/translate them without any DB migration:
- `DBF_BASE_PATH` overrides `Entreprise.cheminBase` (getter on the model).
- `RCOMMON_STOCK_ROOT` translates export/collect paths, keeping the last path segment (e.g. `collect_sec`) per company.
- `STOCK_SHARE_PATH` for `.dat`/fiche-contrôle shares.
See the header comments in `backend/models/EntrepriseModel.js` for the exact rules.

## Permissions & auth

Auth is a **JWT stored in an httpOnly cookie named `token`** (not a Bearer header); the frontend uses `credentials: "include"`. CORS is configured with `credentials: true`.

Access control is **two-dimensional** — a user needs both the right *module* and the right *company*:

- `protect` — requires a valid token (`backend/middleware/authMiddleware.js`).
- `admin` — requires `role === "admin"`.
- `checkModuleAccess(moduleKey, action)` — per-module `read`/`write`/`delete`. Admins bypass module checks; regular users need `permission.modules[key][action]` or `allModules` (`backend/middleware/checkEntrepriseAccess.js`).
- `checkEntrepriseAccess` — company scoping via `:entrepriseId` or `:nomDossierDBF`. **Applies to admins too** — an admin has all modules but only the companies explicitly granted.
- `superAdmin` / `getAccessibleEntreprises` / `checkAnalyseAccess` — a **super-admin** is an admin with `allEntreprises` (or a legacy admin with no `Permission` doc). Super-admin is required for user/company management and gates analysis screens (`backend/middleware/accessControl.js`).

The list of permission modules lives in **`backend/config/adminModules.js`** and is **mirrored in `frontend/src/config/adminModules.js`** (which also maps route paths → module keys for `<ModuleRoute>`). When adding a module, update **both** files and `backend/models/PermissionModel.js`.

## Espace commercial (profil, pas module)

Un utilisateur peut être marqué **commercial** (`Permission.commercial = { actif, codes: [{ entreprise, code }] }`). Le rattachement est le couple **société + code vendeur (REPRES)** — un même commercial a un code différent par société (QC=12, KQ=08…). Ce profil n'est **pas** un module de permission : il ouvre `/commercial/*` (front) et `/api/commercial/*` (back), gardés par `requireCommercial` + `checkCommercialEntreprise` (`backend/middleware/commercialAccess.js`), qui pose `req.codesCommercial` — seul filtre utilisé par `services/commercialService.js`. Un commercial ne voit donc jamais les données d'un autre code. Activer le profil accorde `modules.stock.read` (recherche d'articles), **uniquement à l'activation** : ensuite l'admin reste libre de le retirer et d'accorder n'importe quel module/société.

**Un code REPRES n'est pas forcément un commercial** (caisse, vendeur magasin, compte technique). Le dictionnaire fait foi : `entreprise.vendeurs[].type === "commercial"` (onglet Vendeurs de la fiche société). Ce filtre s'applique à l'UI, à l'enregistrement (`sanitizeCommercial`) **et à chaque requête** (`getEntreprisesCommercial`) — repasser un code en « vendeur » ferme l'accès immédiatement. La création/édition d'utilisateur se fait en page plein écran (`/admin/users/nouveau`, `/admin/users/:id`), plus en modale.

Le service ne duplique rien : il lit les caches existants (`clientCacheService`, `factureCacheService`, `proformaCacheService`), reprend l'analyse CA de `commerciauxService` et les alertes de `resaEntreesService`. Seule écriture du module : `SuiviCommercialModel` (relances de proformas, alertes acquittées) — l'ERP reste en lecture seule.

**Deux sources distinctes, ne pas les confondre** (constaté sur les données QC, arbitré avec le client le 14/08/2026) :
- **Réservations & commandes spéciales** = `facture.dbf` **TYPFACT="R"**, `ETAT` 1 = Réservation Stock, 2 = Commande Spéciale (`entreprise.mappingEtatsReservation`). Même source que « Entrées sur réservation » et que les alertes.
- **Proformas** = `proforma.dbf`. Ses états réels chez QC sont 1 (685 doc./12 mois pour un seul commercial), 2 = « Commande à preparer », 3/4 = devis. **`ETAT=0` n'existe pas** — l'ancienne convention « 0 = commande spéciale » (commentaire de l'écran Données ▸ Réservations) est fausse.

⚠️ Le `mappingEtatsProforma` de QC libelle l'ETAT=1 « Reservation », **alors que ce n'en est pas une**. Dans l'espace commercial on affiche donc le libellé de catégorie (`CATEGORIES`, ex. « Proforma en attente ») et non le libellé ERP, gardé en `etatLabelErp` pour l'infobulle. Sans ça, 685 lignes « Reservation » côtoyaient les 33 vraies réservations et l'écran devenait illisible.

L'ERP **ne purge jamais** ces tables : tous les compteurs « en cours » / « à relancer » sont bornés par une **fenêtre glissante de 12 mois** (`FENETRE_MOIS_DEFAUT`, `fenetreMois=0` pour tout l'historique). Sans elle, on remonte à 2019 (4 686 « réservations en cours » au lieu de 33).

⚠️ **Perf — le dashboard est découpé en trois requêtes** parce que les caches DBF n'ont pas du tout le même coût à froid sur QC (clients ~3 s, proformas ~35 s, factures ~140 s pour 1,7 M factures + 6,2 M lignes, et ce cache s'invalide à chaque facturation) :
1. `GET /dashboard` — portefeuille + documents (caches clients/proformas + index réservations) ;
2. `GET /dashboard/ca` — CA, top 3 clients, clients à recontacter (cache factures) ;
3. `GET /:dossier/alertes` — croisement réservations × entrées (`resaEntreesService`, scan streaming).

Le front affiche (1) immédiatement et remplit (2) et (3) en différé. **Ne pas refusionner ces endpoints.**

**Écran Réservations / Commandes spéciales du commercial** — même découpage, pour la même raison :
- `GET /:dossier/reservations` — la liste (entêtes TYPFACT="R", index facture, rapide) ;
- `GET /:dossier/reservations/disponibilites` — le statut « entré en stock » par document, croisement `detail.dbf` × `entrees.dbf` (`resaEntreesService.getReservationsIndexes` + `getEntreesParArticle`, **142 s à froid en local**) ;
- `GET /:dossier/reservations/:numfact/lignes` — le détail article par article, à l'ouverture d'une ligne.

Le statut d'une ligne est « arrivé » quand l'article a une entrée **postérieure ou égale à la date de la réservation** ; les réservations plus anciennes que la profondeur du scan des entrées (`FENETRE_DISPO_MOIS` = 24 mois, fenêtre arrondie au 1er du mois pour que la clé de cache soit stable) sont marquées `inconnu` plutôt qu'« en attente ». « Client prévenu » est un suivi **personnel** (`SuiviCommercial` type `resa_prevenu`, référence = NUMFACT) : une nouvelle arrivée postérieure au marquage remet le document « à prévenir ».

L'index des réservations de `resaEntreesService` est lui aussi caché **par TTL seul** (mêmes raisons) et préchauffé par `startCommercialIndexWarmer()`.

**L'espace commercial n'utilise ni `factureCacheService` ni `commerciauxService`** (tous deux chargent `detail.dbf`, 6,2 M lignes, dont il n'a aucun besoin : CA et marge se calculent sur `MONTANT`/`FACTREV` des entêtes). Il a ses propres index, dans `commercialService.js` :

- `getIndexFactures` — **une seule** passe streaming sur `facture.dbf` vers un index **colonnaire en TypedArrays** (modèle `frequentationService`), qui sert d'un coup : réservations TYPFACT="R", liste des factures, CA/marge N vs N-1, et date de dernier achat par client.
- `getIndexProformas` — entêtes de `proforma.dbf` seuls (80 k lignes, ~1,5 s) ; `proformaCacheService` n'est plus appelé que pour le détail d'un document.

Les deux sont invalidés **par TTL seul (10 min), volontairement pas sur le mtime** : `facture.dbf` change à chaque facture émise, une invalidation sur fichier ferait repayer le scan à presque chaque requête.

`startCommercialIndexWarmer()` (appelé dans `server.js`) reconstruit ces index toutes les 8 min en tâche de fond, pour les seules sociétés ayant un commercial actif — sinon c'est un utilisateur qui paie le scan (**188 s mesurées en production**, 35 s en local : le partage réseau du VPS est 5× plus lent).

Mesures après refonte (local, index chaud) : dashboard **1,6 s**, factures **56 ms**, CA **31 ms** — contre 137 s pour le seul dashboard à l'origine.

## API partenaire (`/api/public/v1`)

Accès externe **en lecture seule** aux articles, produits et clients d'une société, pour un intégrateur (site marchand SITEC). Documentation destinée au prestataire : `docs/API_PARTENAIRE.md` — **à mettre à jour en même temps que le code**, c'est le contrat.

Ce routeur n'utilise ni `protect` ni `checkEntrepriseAccess` (ils supposent un utilisateur interne avec cookie JWT) mais `apiKeyAuth` → `limiterDebit` → `requireScope` → `chargerEntrepriseApi` (`middleware/apiKeyAuth.js`). Les clés sont gérées **en CLI seulement** (`npm run apikey:list|create|revoke`), jamais par une page d'admin. Deux dimensions comme en interne : `scopes` (`articles:read`, `clients:read`) × `entreprises`.

**`artplus.dbf` — compléments article** (`services/artplusService.js`) : table clé/valeur `{NART, INTITULE, CONTENU}`, **facultative** et **sans schéma imposé** — les intitulés diffèrent par société (qc : 18 dont `02_nom_produit`, `06_groupe`…; sitec : 5 dont `01_DESIGN`). Le service ne code aucune liste en dur : il détecte un **rôle** par convention de nommage (`ROLES`) et expose le dictionnaire réel via `GET /:societe/attributs`.

Elle sert surtout à **regrouper les références en produits à variantes** (une serrure en 5 couleurs = 1 produit, 5 NART) : clé = l'identifiant produit quand la société en tient un (`01_n_produit` chez qc — unicité *vérifiée* au chargement, pas supposée), sinon un slug du nom (tronqué à 80 caractères + empreinte, sans quoi des produits distincts fusionnent). Chargement : qc 637 k lignes en ~2,8 s, sitec ~0,3 s ; cache TTL 10 min + invalidation mtime/taille.

**Contrat d'affichage voulu par le client (site marchand)** : `GET /articles` est **replié par produit** — une ligne par produit, `_variantesNarts` donne les codes des déclinaisons (`?grouper=0` pour la liste brute) ; `GET /articles/:nart` et `/articles/gencod/:gencod` renvoient la référence **avec ses déclinaisons** dans `_variantes` (absent s'il n'y en a pas). `/articles/export` reste **toujours brut** : c'est un export de synchronisation, pas une liste de catalogue. Coût du repli : ~120 ms à chaud sur les 100 k articles de qc, contre 9 ms sans.

⚠️ Les fichiers DBF sont en jeu de caractères **DOS** et l'API les restitue tels quels (`N°` → `Nø`, `À` → `Aÿ`). C'est un comportement **global** de l'app, pas propre à artplus — ne pas le corriger dans un seul service, ça désaligne les champs entre eux.

## Listes de réappro (`demande_reappro`)

Une **liste de réappro** = un lot d'articles à aller chercher au dock, poussé par quelqu'un et préparé par un opérateur sur le collecteur. Le modèle est `DemandeReapproModel.js` (ex « demande magasin ») — il n'y a **pas** de collection dédiée, on a étendu l'existant. Tout vit sous `/api/demande-reappro` + écran web `/demandes-reappro` + écran mobile *Réappro ▸ Listes de réappro*.

C'est un module **distinct de `prep_commande`** (préparation de commande client) : ne pas mélanger les deux, ils n'ont ni le même workflow ni les mêmes droits. La permission est **`demande_reappro`** ; `analyse_reappro_admin` et `reapro` restent acceptés en secours sur les routes (l'écran Analyse Réappro et les versions déjà déployées de l'app mobile s'en servaient).

- `source` = `manuel` | `proforma` | `rapport` (+ `sourceRef` = NUMFACT). Index unique **partiel** sur `(entreprise, source, sourceRef)` limité à `source: "proforma"` : une proforma ne peut donner qu'une liste.
- Cycle : `en_attente` (« À faire ») → `en_cours` → `realisee` (« Terminé », même avec des écarts). L'ouverture pose un **verrou** (`operateur.user`) : la liste disparaît de l'écran des autres opérateurs jusqu'à ce qu'elle soit terminée ou **rendue** (`POST /mobile/:id/liberer`, réservé au porteur du verrou ou à un admin).
- Chaque ligne validée part immédiatement au serveur (`POST /mobile/:id/lignes`) : `quantitePrise`, `statutLigne`, `traiteAt`. Le **temps de réappro effectif** est le temps ACTIF : on cumule les intervalles entre lignes et on ignore les silences de plus de 5 min (`PAUSE_MS`). Sans l'horodatage par ligne il serait incalculable a posteriori — ne pas le retirer.
- `POST /mobile/:id/scan` résout un code **dans la liste** (NART, gencode ou REFER), puis via le catalogue. Un article du catalogue **absent de la liste est refusé (409)** — la liste est figée ; un code totalement inconnu renvoie 404 et l'app propose une saisie NART/REFER.
- Fin de liste → `PATCH /mobile/:id/realiser` : fichier de transfert `.dat` dans `collect_sec` (`demandeReapproTransfertService.js`, format `NART(13)|QTE(8)|000`, identique à la prépa). Aucune écriture DBF. ⚠️ **Le contenu de ce fichier est figé** (Stock XL le relit tel quel) : ne jamais y toucher. Seul son **nom** est paramétrable par liste — `nommageTransfert` = `gisement` (défaut historique) | `proforma` (le NUMFACT, défaut des listes importées) | `libre` (`nomTransfertLibre`), avec repli sur le gisement dès que le mode choisi ne donne rien. Le nom reste `tsf_reappro_mag_<societe>_<libellé>_<horodatage>.dat`.
- Les listes de plus de **15 jours** ne sont plus affichées (`FENETRE_JOURS_DEFAUT` dans le contrôleur, `?jours=0` pour tout l'historique). Constante de code : **aucune variable d'environnement** pour ce module.

**Statistiques préparateurs** : `GET /:dossier/stats?debut&fin` (onglet « Statistiques » de l'écran, export Excel côté client). Par opérateur : nombre de réappros, de lignes, prises/introuvables, unités, **temps effectif** (somme des intervalles entre lignes, pauses > 5 min exclues) et **temps brut** (ouverture → validation), plus la moyenne par ligne. Les listes préparées avant l'horodatage par ligne sont comptées dans `listesSansTemps` au lieu d'être faussées à 0.

**Source proforma** (`reapproProformaImportService.js` + `reapproProformaScheduler.js`, démarré par `server.js`) : toute proforma dont l'**observation `proforma.TEXTE`** commence par « reappro » (casse/accents indifférents) devient une liste. Mesuré sur QC : 1 147 documents depuis 2019, dont **1 117 en ETAT 1** et seulement 29 en ETAT 2 — se limiter à l'ETAT 2 (celui de la prépa de commande) raterait 97 % des réappros, donc on prend **tous les états sauf les devis (3 et 4)**. `REPRES` donne le demandeur via `entreprise.vendeurs` (repli « Vendeur 35 » quand l'onglet Vendeurs n'est pas renseigné). L'ERP ne purgeant jamais ces tables, seules les proformas des **15 derniers jours** sont importées, sinon le premier passage crée 1 147 listes. Clé d'unicité : société + NUMFACT. Une liste encore « à faire » est resynchronisée si la proforma bouge, et supprimée si la proforma n'est plus éligible ; **une liste ouverte par un opérateur n'est jamais touchée**. Bouton « Importer les proformas » sur l'écran web pour forcer un tour (`POST /:dossier/import-proformas`).
- La quantité demandée **n'est pas bornée au stock** (la disponibilité n'est pas contrôlée au dock) ; le stock reste affiché à titre indicatif.

## Request flow / conventions

Backend follows routes → controllers → services:
- `backend/routes/*Routes.js` wire middleware chains (nearly always `protect` first, then `checkEntrepriseAccess` / `checkModuleAccess`).
- `backend/controllers/*Controller.js` are thin, wrapped in `asyncHandler` (`backend/middleware/asyncHandler.js`); errors flow to `notFound`/`errorHandler` in `errorMiddleware.js`.
- `backend/services/*` hold the real logic: DBF caching, Excel/PDF generation (`exceljs`, `pdfkit`), report delivery, path building (`utils/*Paths.js`).
- New routers must be both imported and `app.use()`-mounted in `backend/server.js` (all API under `/api/...`).

Frontend is **React 19 (CRA) + Redux Toolkit + RTK Query**:
- One store (`frontend/src/store.js`); all HTTP goes through `apiSlice.js` (RTK Query, `injectEndpoints` per feature slice in `frontend/src/slices/*ApiSlice.js`). Add new cache tags to the `tagTypes` array in `apiSlice.js`.
- Non-API state slices: `authSlice`, `entrepriseGlobalSlice` (currently selected company), `inventaireSelectionSlice`.
- Routing is defined in `frontend/src/index.js`. Route guards: `<PrivateRoute>` (logged in) and `<ModuleRoute module="...">` (permission-gated). Screens live in `screens/user/` and `screens/admin/`.
- `BASE_URL` in `frontend/src/constants.js` is `""` — the app assumes same-origin (dev proxy, or Express serving the build in prod).

## Background jobs

- **Inventory watcher** (`services/inventaireWatchService.js`): started by `startInventaireWatcher()` in `server.js`. Polls the company `.dat` export share, parses fiche-contrôle files, generates a PDF, and silently prints it via `pdf-to-printer` (SumatraPDF). Note this depends on a Windows print setup.
- **Report scheduler** (`services/reportScheduler.js`): a `node-cron` job (timezone `Pacific/Noumea`) that emails Excel report subscriptions with an optimistic `nextRunAt` lock to prevent double-sends. It exposes `startReportScheduler()` but is **not** currently called from `server.js` — wire it there if scheduled emails are expected.

## Notes

- Backend is **ESM** (`"type": "module"`); use `import`/`export`, and note `__dirname` is derived via `path.resolve()`.
- `.dbf` files are git-ignored; the `backend/data/*.dbf` fixtures are local sample data.
- Email uses `nodemailer` via `backend/utils/sendEmail.js` (SMTP config in `.env`).
