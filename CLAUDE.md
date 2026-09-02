# CLAUDE.md

Guide de travail pour Claude Code (claude.ai/code) sur ce dépôt.

État vérifié au 31/08/2026 (commit `a64ee21`). L'audit complet qui a servi de base
à ce fichier est dans **`docs/AUDIT_APPLICATION.md`** — il détaille les dérives et
le code mort seulement résumés ici.

## Vue d'ensemble

Outil interne B2B multi-sociétés pour un groupe de quincailleries de
Nouvelle-Calédonie. Il lit le jeu de données DBF/ERP propre à chaque société et
expose recherche, inventaire, commandes, réception, préparation, réappro,
étiquettes, emailing, analyses et reporting.

Le code, les commentaires et l'UI sont en **français** — s'y tenir. Les
commentaires existants portent souvent le *pourquoi* (arbitrage client, mesure de
perf, piège) : les lire avant de modifier, les mettre à jour en même temps que le
code.

Ordre de grandeur : ~89 000 lignes de backend (75 routeurs, 77 contrôleurs, 82
services, 61 modèles), ~69 000 lignes de front (95 écrans, 63 slices RTK Query).
**Aucun test n'existe dans le dépôt** — ni back ni front. Toute modification doit
donc être vérifiée par lecture et, quand c'est possible, par exécution.

## Commandes

Depuis la racine du dépôt :

- `npm run dev` — backend (nodemon) + frontend (CRA) via concurrently
- `npm run server` — backend seul, `nodemon backend/server.js`
- `npm run client` — frontend seul (port 3000, proxy `/api` → 5000)
- `npm start` — backend en production, `node backend/server.js`
- `npm run print-agent` — agent d'impression local des fiches de contrôle (voir
  « Tâches de fond »)
- `npm run data:import` / `data:destroy` — seed/purge users, permissions, entreprises
- `npm run data:import:envoi-cde` / `data:destroy:envoi-cde` — seed du module Envoi Cde
- `npm run masterconfig:import` / `masterconfig:destroy` — seed des configs master report
- `npm run apikey:list|create|revoke|activate` — clés de l'API partenaire (**CLI
  uniquement**, il n'y a pas d'écran d'admin)
- `npm run pachat:historiser` — historisation des prix d'achat
- `npm run migrate:groupes-prioritaires` — migration ponctuelle
- `cd frontend && npm run build` — build de production (servi par Express si
  `NODE_ENV=production`)

⚠️ **Port** : `server.js` fait `process.env.PORT || 8000`, mais le proxy CRA
(`frontend/package.json` et `frontend/src/setupProxy.js`) vise **5000**. Toujours
définir `PORT=5000` dans `.env` en développement.

⚠️ `npm test` (CRA) existe mais **ne trouve aucun test** — ne pas s'en servir comme
preuve qu'une modification est bonne.

⚠️ Sur ce poste, vider `NODE_OPTIONS` (et `CI`) avant `npm run build`, sinon
`dns-fix.js` échoue.

`backend/loadEnv.js` **doit rester le premier import de `server.js`** : certains
services lisent `process.env` au chargement du module.

## Deux sources de données (le cœur de l'architecture)

Ce n'est **pas** une application CRUD Mongo classique. Il y a deux backends :

1. **MongoDB (Mongoose)** — l'état propre à l'application : utilisateurs,
   permissions, entreprises, sessions/zones d'inventaire, bipages, listes de
   réappro, campagnes email, tâches, messages, abonnements aux rapports, releases
   de l'app mobile. Modèles dans `backend/models/`.
2. **Fichiers DBF hérités** — la source de vérité de l'ERP : articles, clients,
   fournisseurs, commandes, proformas, factures, entrées, balances. Lus avec
   `dbffile`. **Jamais réécrits.** Aucune écriture DBF n'existe dans le code, et
   il ne doit pas en être ajouté.

Tout ce qui vient du DBF est **scopé par société** via le paramètre de route
`:nomDossierDBF`. Un document `Entreprise` associe `nomDossierDBF` + `trigramme`
aux chemins du système de fichiers (`cheminBase`, `cheminExportInventaire`,
`cheminRapportReception`, `cheminPhotos`, `cheminLogoEtiquettes`…).

### Règles DBF non négociables

- **`DBFFile.open` doit toujours recevoir `{ readMode: "loose" }`** — sinon crash
  « Duplicate field name » sur les `.dbf` hérités à champs dupliqués. Les 19
  services concernés respectent la règle ; ne pas l'oublier dans un nouveau.
- Les fichiers DBF sont en **jeu de caractères DOS** et l'application les restitue
  tels quels (`N°` → `Nø`, `À` → `Aÿ`). C'est un comportement **global** : ne pas
  le corriger dans un seul service, ça désaligne les champs entre eux.
- Les tables de l'ERP **ne sont jamais purgées** : tout compteur « en cours » doit
  être borné par une fenêtre glissante explicite, sinon on remonte à 2019.

### Caches DBF

Relire le DBF à chaque requête est trop lent (90 000+ articles, 1,7 M factures et
6,2 M lignes chez QC). Plusieurs services de cache chargent le DBF d'une société
dans une `Map` en mémoire avec des index prêts à l'emploi (par NART, GENCOD,
GROUPE, GISM1, FOURN…) et un TTL. **Préférer toujours le service de cache à
l'ouverture directe d'un `DBFFile`.**

Trois familles coexistent, sans couche commune :

- **classe à état** (`articleService.js`, `clientCacheService.js`,
  `factureCacheService.js`, `proformaCacheService.js`, `commandeService.js`,
  `fournissCacheService.js`…) : `this.cacheTTL` + `loadingLocks` pour éviter les
  chargements concurrents ;
- **module + `Map`** (`artplusService.js`, `balancesService.js`,
  `rapportTgcService.js`, `verifService.js`, `resaEntreesService.js`…) ;
- **index colonnaires en TypedArrays** pour les gros volumes
  (`frequentationService.js`, `commercialService.js`).

Les TTL vont de 30 s à 15 min selon le service. Certains invalident aussi sur
mtime/taille du fichier, d'autres **volontairement pas** (voir l'espace commercial
plus bas). Vérifier la politique du service avant de la changer.

## Bascule dev/prod et variables d'environnement

Les chemins des sociétés sont stockés en UNC Windows (`\\serveur\Bases\…`) pour le
développement local. En production (Ubuntu), des variables d'environnement les
remplacent ou les traduisent **sans aucune migration en base** :

- `DBF_BASE_PATH` remplace `Entreprise.cheminBase` (getter du modèle) ;
- `RCOMMON_STOCK_ROOT` traduit les chemins d'export/collecte en conservant le
  **dernier segment**, propre à chaque société (`collect_sec`, `collect_sec_aw`,
  `collecteur`…) ;
- `STOCK_SHARE_PATH` pour les partages `.dat` / fiches de contrôle.

Les règles exactes sont dans l'en-tête de `backend/models/EntrepriseModel.js`.

⚠️ **`exemple.env` est incomplet** : il documente 15 variables alors que le backend
en lit 33. Liste réelle, par usage :

| Domaine | Variables |
|---|---|
| Base | `NODE_ENV`, `PORT`, `MONGO_URI` (alias `MONGODB_URI`), `JWT_SECRET` |
| Front / CORS | `FRONTEND_URL` (pilote CORS), `FRONTEND_BUILD_PATH` (build servi par Express en prod) |
| Chemins DBF & partages | `DBF_BASE_PATH`, `RCOMMON_STOCK_ROOT`, `RCOMMON_COLLECT_PATH`, `STOCK_SHARE_PATH`, `PHOTOS_BASE_PATH`, `REAPRO_MAG_DIR`, `ANALYSE_CA_DICTIONNAIRE_PATH` |
| Impression fiches | `RUN_FICHE_WATCHER`, `PRINTER_NAME`, `FICHE_AUTOPRINT`, `FICHE_WATCH_INTERVAL_MS`, `DAT_FILENAME_PREFIX`, `DAT_FILENAME_REGEX` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `MAIL_TRACK_SECRET` |
| Envoi Cde Fournisseur | `ENVOI_CDE_TEST_EMAILS` (le mode test se pilote **par société dans l'UI**, plus par `ENVOI_CDE_TEST_MODE`) |
| IA | `OPENAI_API_KEY`, `OPENAI_MODEL`, `TAVILY_API_KEY`, `OPENAI_VEILLE_MODEL`, `OPENAI_VEILLE_MODEL_PRO` |

Côté frontend (CRA, préfixe `REACT_APP_` obligatoire) : `REACT_APP_MAPBOX_TOKEN`
(carte des collecteurs) et `REACT_APP_API_TARGET` (cible du proxy de dev).

`CLIENT_URL` apparaît dans `exemple.env` mais **n'est lu nulle part** — c'est
`FRONTEND_URL` qui compte.

## Authentification, rôles et permissions

L'authentification est un **JWT dans un cookie httpOnly nommé `token`** (pas un
en-tête Bearer) ; le front utilise `credentials: "include"` et CORS est configuré
avec `credentials: true`. L'app mobile, qui ne peut pas lire un cookie httpOnly,
passe le token dans le handshake socket (`POST /api/users/socket-token`).

### Rôles (`UserModel.role`)

- `admin` — tous les modules, **mais scopé à ses sociétés** ;
- `responsable` — droits explicites comme un `user`, plus la gestion d'une ou
  plusieurs équipes (`TeamModel`) et de leurs membres, avec des permissions
  **atténuées** (⊆ les siennes) ;
- `user` — droits explicites uniquement.

Le **super-admin** est un `admin` avec `allEntreprises` (ou un admin hérité sans
document `Permission`). Il est requis pour la gestion des utilisateurs et des
sociétés.

### Contrôle d'accès à deux dimensions

Un utilisateur a besoin **du bon module ET de la bonne société** :

- `protect` — jeton valide (`backend/middleware/authMiddleware.js`). Pose aussi
  `req.masqueDbf` (voir plus bas).
- `admin` — `role === "admin"`.
- `checkModuleAccess(cle, action)` — `read` / `write` / `delete` par module. Les
  admins court-circuitent ce contrôle. Accepte un **tableau** de modules : l'accès
  passe si l'utilisateur a l'action sur au moins un.
- `checkEntrepriseAccess` — scoping société par `:entrepriseId` ou
  `:nomDossierDBF`. **S'applique aussi aux admins.**
- `superAdmin`, `getAccessibleEntreprises`, `checkAnalyseAccess`,
  `getManageableUserScope`, `assertGrantWithinScope`, `canAssignRole`,
  `checkTeamAccess` — `backend/middleware/accessControl.js`.

`assertGrantWithinScope` est la garde anti-escalade : un acteur ne peut jamais
accorder plus que ce qu'il possède, module par module et société par société. Son
miroir **non-sécuritaire** côté client est dans `frontend/src/config/adminModules.js`
(il évite des tentatives vaines, il ne protège rien).

**Décision client** : un responsable gère **tous** les utilisateurs de ses
sociétés (modification et rattachement d'équipe), pas seulement les membres de son
équipe.

### Le registre des modules vit à trois endroits

`backend/config/adminModules.js` (source de vérité), son miroir
`frontend/src/config/adminModules.js` (qui porte en plus `PATH_MODULE_MAP`, la
correspondance chemin d'écran → clé pour `<ModuleRoute>`), et le schéma
`backend/models/PermissionModel.js`.

**En ajoutant un module, mettre à jour les trois.** Ils ont déjà dérivé :
`executables_admin`, `facture_analyse_admin`, `journal_caisse_admin`,
`top_articles_admin` n'existent qu'au front ; `analyse_reappro_admin` et
`reception_suivi_admin` manquent au schéma Mongo. Conséquence : ces écrans ne sont
atteignables que par un admin, le droit n'étant pas persistable. Détail en
§3.1 de l'audit.

### Droits « champ par champ » sur le DBF

`Permission.champsDbf` restreint, **par table de l'ERP**, les champs qu'un
utilisateur peut voir : `{ table: { mode: "tous" | "liste", champs: [...] } }`.
Tables déclarées dans `backend/config/dbfTables.js` ; les noms de champs ne sont
pas figés, ils sont lus dans le DBF réel de la société
(`services/dbfChampsService.js`).

Le masquage est acquis **par construction** : `installerMasqueDbf` est monté
globalement sur `/api` **avant les routeurs** et enveloppe `res.json` ; `protect`
pose `req.masqueDbf`. Un contrôleur ne peut donc pas oublier le filtrage, et le
coût est nul pour un utilisateur sans restriction.

Deux conséquences à connaître :
- le filtrage se fait **par nom de champ**, sur toutes les réponses : un champ
  masqué sur une table l'est partout où ce nom apparaît. C'est volontairement plus
  strict que fin ;
- **seul le JSON passe par là.** Les exports Excel/PDF doivent filtrer à la source
  avec `filtrerColonnes(req, colonnes)` / `champMasque(req, champ)`.

## Espace commercial (profil, pas module)

Un utilisateur peut être marqué **commercial** (`Permission.commercial = { actif,
codes: [{ entreprise, code }] }`). Le rattachement est le couple **société + code
vendeur (REPRES)** — un même commercial a un code différent par société (QC=12,
KQ=08…). Ce profil n'est **pas** un module de permission : il ouvre `/commercial/*`
(front) et `/api/commercial/*` (back), gardés par `requireCommercial` +
`checkCommercialEntreprise` (`backend/middleware/commercialAccess.js`), qui pose
`req.codesCommercial` — seul filtre utilisé par `services/commercialService.js`.
Un commercial ne voit donc jamais les données d'un autre code. Activer le profil
accorde `modules.stock.read` (recherche d'articles), **uniquement à l'activation** :
ensuite l'admin reste libre de le retirer et d'accorder n'importe quel
module/société.

**Un code REPRES n'est pas forcément un commercial** (caisse, vendeur magasin,
compte technique). Le dictionnaire fait foi : `entreprise.vendeurs[].type ===
"commercial"` (onglet Vendeurs de la fiche société). Ce filtre s'applique à l'UI, à
l'enregistrement (`sanitizeCommercial`) **et à chaque requête**
(`getEntreprisesCommercial`) — repasser un code en « vendeur » ferme l'accès
immédiatement. La création/édition d'utilisateur se fait en page plein écran
(`/admin/users/nouveau`, `/admin/users/:id`), plus en modale.

Le service ne duplique rien : il lit les caches existants (`clientCacheService`,
`factureCacheService`, `proformaCacheService`), reprend l'analyse CA de
`commerciauxService` et les alertes de `resaEntreesService`. Seule écriture du
module : `SuiviCommercialModel` (relances de proformas, alertes acquittées) —
l'ERP reste en lecture seule.

**Deux sources distinctes, ne pas les confondre** (constaté sur les données QC,
arbitré avec le client le 14/08/2026) :
- **Réservations & commandes spéciales** = `facture.dbf` **TYPFACT="R"**, `ETAT`
  1 = Réservation Stock, 2 = Commande Spéciale (`entreprise.mappingEtatsReservation`).
  Même source que « Entrées sur réservation » et que les alertes.
- **Proformas** = `proforma.dbf`. Ses états réels chez QC sont 1 (685 doc./12 mois
  pour un seul commercial), 2 = « Commande à preparer », 3/4 = devis. **`ETAT=0`
  n'existe pas** — l'ancienne convention « 0 = commande spéciale » (commentaire de
  l'écran Données ▸ Réservations) est fausse.

⚠️ Le `mappingEtatsProforma` de QC libelle l'ETAT=1 « Reservation », **alors que ce
n'en est pas une**. Dans l'espace commercial on affiche donc le libellé de
catégorie (`CATEGORIES`, ex. « Proforma en attente ») et non le libellé ERP, gardé
en `etatLabelErp` pour l'infobulle. Sans ça, 685 lignes « Reservation » côtoyaient
les 33 vraies réservations et l'écran devenait illisible.

L'ERP **ne purge jamais** ces tables : tous les compteurs « en cours » / « à
relancer » sont bornés par une **fenêtre glissante de 12 mois**
(`FENETRE_MOIS_DEFAUT`, `fenetreMois=0` pour tout l'historique). Sans elle, on
remonte à 2019 (4 686 « réservations en cours » au lieu de 33).

⚠️ **Perf — le dashboard est découpé en trois requêtes** parce que les caches DBF
n'ont pas du tout le même coût à froid sur QC (clients ~3 s, proformas ~35 s,
factures ~140 s pour 1,7 M factures + 6,2 M lignes, et ce cache s'invalide à chaque
facturation) :
1. `GET /dashboard` — portefeuille + documents (caches clients/proformas + index
   réservations) ;
2. `GET /dashboard/ca` — CA, top 3 clients, clients à recontacter (cache factures) ;
3. `GET /:dossier/alertes` — croisement réservations × entrées (`resaEntreesService`,
   scan streaming).

Le front affiche (1) immédiatement et remplit (2) et (3) en différé. **Ne pas
refusionner ces endpoints.**

**Écran Réservations / Commandes spéciales du commercial** — même découpage, pour
la même raison :
- `GET /:dossier/reservations` — la liste (entêtes TYPFACT="R", index facture, rapide) ;
- `GET /:dossier/reservations/disponibilites` — le statut « entré en stock » par
  document, croisement `detail.dbf` × `entrees.dbf`
  (`resaEntreesService.getReservationsIndexes` + `getEntreesParArticle`, **142 s à
  froid en local**) ;
- `GET /:dossier/reservations/:numfact/lignes` — le détail article par article, à
  l'ouverture d'une ligne.

Le statut d'une ligne est « arrivé » quand l'article a une entrée **postérieure ou
égale à la date de la réservation** ; les réservations plus anciennes que la
profondeur du scan des entrées (`FENETRE_DISPO_MOIS` = 24 mois, fenêtre arrondie au
1er du mois pour que la clé de cache soit stable) sont marquées `inconnu` plutôt
qu'« en attente ». « Client prévenu » est un suivi **personnel**
(`SuiviCommercial` type `resa_prevenu`, référence = NUMFACT) : une nouvelle arrivée
postérieure au marquage remet le document « à prévenir ».

L'index des réservations de `resaEntreesService` est lui aussi caché **par TTL
seul** (mêmes raisons) et préchauffé par `startCommercialIndexWarmer()`.

**L'espace commercial n'utilise ni `factureCacheService` ni `commerciauxService`**
(tous deux chargent `detail.dbf`, 6,2 M lignes, dont il n'a aucun besoin : CA et
marge se calculent sur `MONTANT`/`FACTREV` des entêtes). Il a ses propres index,
dans `commercialService.js` :

- `getIndexFactures` — **une seule** passe streaming sur `facture.dbf` vers un
  index **colonnaire en TypedArrays** (modèle `frequentationService`), qui sert
  d'un coup : réservations TYPFACT="R", liste des factures, CA/marge N vs N-1, et
  date de dernier achat par client.
- `getIndexProformas` — entêtes de `proforma.dbf` seuls (80 k lignes, ~1,5 s) ;
  `proformaCacheService` n'est plus appelé que pour le détail d'un document.

Les deux sont invalidés **par TTL seul (10 min), volontairement pas sur le mtime** :
`facture.dbf` change à chaque facture émise, une invalidation sur fichier ferait
repayer le scan à presque chaque requête.

`startCommercialIndexWarmer()` (appelé dans `server.js`) reconstruit ces index
toutes les 8 min en tâche de fond, pour les seules sociétés ayant un commercial
actif — sinon c'est un utilisateur qui paie le scan (**188 s mesurées en
production**, 35 s en local : le partage réseau du VPS est 5× plus lent).

Mesures après refonte (local, index chaud) : dashboard **1,6 s**, factures **56 ms**,
CA **31 ms** — contre 137 s pour le seul dashboard à l'origine.

## API partenaire (`/api/public/v1`)

Accès externe **en lecture seule** aux articles, produits et clients d'une société,
pour un intégrateur (site marchand SITEC). Documentation destinée au prestataire :
`docs/API_PARTENAIRE.md` — **à mettre à jour en même temps que le code**, c'est le
contrat.

Ce routeur n'utilise ni `protect` ni `checkEntrepriseAccess` (ils supposent un
utilisateur interne avec cookie JWT) mais `apiKeyAuth` → `limiterDebit` →
`requireScope` → `chargerEntrepriseApi` (`middleware/apiKeyAuth.js`). CORS y est
ouvert (`origin: "*"`) mais **sans cookies** : l'authentification passe uniquement
par l'en-tête `X-API-Key`, il n'y a donc pas de requête authentifiée « à l'insu »
d'un navigateur tiers. Les clés sont gérées **en CLI seulement**
(`npm run apikey:list|create|revoke`), jamais par une page d'admin. Deux dimensions
comme en interne : `scopes` (`articles:read`, `clients:read`) × `entreprises`.

**Aucune route d'écriture ne doit être ajoutée ici** sans décision explicite.

**`artplus.dbf` — compléments article** (`services/artplusService.js`) : table
clé/valeur `{NART, INTITULE, CONTENU}`, **facultative** et **sans schéma imposé** —
les intitulés diffèrent par société (qc : 18 dont `02_nom_produit`, `06_groupe`… ;
sitec : 5 dont `01_DESIGN`). Le service ne code aucune liste en dur : il détecte un
**rôle** par convention de nommage (`ROLES`) et expose le dictionnaire réel via
`GET /:societe/attributs`.

Elle sert surtout à **regrouper les références en produits à variantes** (une
serrure en 5 couleurs = 1 produit, 5 NART) : clé = l'identifiant produit quand la
société en tient un (`01_n_produit` chez qc — unicité *vérifiée* au chargement, pas
supposée), sinon un slug du nom (tronqué à 80 caractères + empreinte, sans quoi des
produits distincts fusionnent). Chargement : qc 637 k lignes en ~2,8 s, sitec
~0,3 s ; cache TTL 10 min + invalidation mtime/taille.

**Contrat d'affichage voulu par le client (site marchand)** : `GET /articles` est
**replié par produit** — une ligne par produit, `_variantesNarts` donne les codes
des déclinaisons (`?grouper=0` pour la liste brute) ; `GET /articles/:nart` et
`/articles/gencod/:gencod` renvoient la référence **avec ses déclinaisons** dans
`_variantes` (absent s'il n'y en a pas). `/articles/export` reste **toujours
brut** : c'est un export de synchronisation, pas une liste de catalogue. Coût du
repli : ~120 ms à chaud sur les 100 k articles de qc, contre 9 ms sans.

⚠️ L'API restitue l'encodage DOS tel quel (voir « Règles DBF non négociables »).

## Listes de réappro (`demande_reappro`)

Une **liste de réappro** = un lot d'articles à aller chercher au dock, poussé par
quelqu'un et préparé par un opérateur sur le collecteur. Le modèle est
`DemandeReapproModel.js` (ex « demande magasin ») — il n'y a **pas** de collection
dédiée, on a étendu l'existant. Tout vit sous `/api/demande-reappro` + écran web
`/demandes-reappro` + écran mobile *Réappro ▸ Listes de réappro*.

C'est un module **distinct de `prep_commande`** (préparation de commande client) :
ne pas mélanger les deux, ils n'ont ni le même workflow ni les mêmes droits. La
permission est **`demande_reappro`** ; `analyse_reappro_admin` et `reapro` restent
acceptés en secours sur les routes (l'écran Analyse Réappro et les versions déjà
déployées de l'app mobile s'en servaient).

- `source` = `manuel` | `proforma` | `rapport` (+ `sourceRef` = NUMFACT). Index
  unique **partiel** sur `(entreprise, source, sourceRef)` limité à
  `source: "proforma"` : une proforma ne peut donner qu'une liste.
- Cycle : `en_attente` (« À faire ») → `en_cours` → `realisee` (« Terminé », même
  avec des écarts). L'ouverture pose un **verrou** (`operateur.user`) : la liste
  disparaît de l'écran des autres opérateurs jusqu'à ce qu'elle soit terminée ou
  **rendue** (`POST /mobile/:id/liberer`, réservé au porteur du verrou ou à un admin).
- Chaque ligne validée part immédiatement au serveur (`POST /mobile/:id/lignes`) :
  `quantitePrise`, `statutLigne`, `traiteAt`. Le **temps de réappro effectif** est
  le temps ACTIF : on cumule les intervalles entre lignes et on ignore les silences
  de plus de 5 min (`PAUSE_MS`). Sans l'horodatage par ligne il serait incalculable
  a posteriori — ne pas le retirer.
- `POST /mobile/:id/scan` résout un code **dans la liste** (NART, gencode ou
  REFER), puis via le catalogue. Un article du catalogue **absent de la liste est
  refusé (409)** — la liste est figée ; un code totalement inconnu renvoie 404 et
  l'app propose une saisie NART/REFER.
- Fin de liste → `PATCH /mobile/:id/realiser` : fichier de transfert `.dat` dans
  `collect_sec` (`demandeReapproTransfertService.js`, format `NART(13)|QTE(8)|000`,
  identique à la prépa). Aucune écriture DBF. ⚠️ **Le contenu de ce fichier est
  figé** (Stock XL le relit tel quel) : ne jamais y toucher. Seul son **nom** est
  paramétrable par liste — `nommageTransfert` = `gisement` (défaut historique) |
  `proforma` (le NUMFACT, défaut des listes importées) | `libre`
  (`nomTransfertLibre`), avec repli sur le gisement dès que le mode choisi ne donne
  rien. Le nom reste `tsf_reappro_mag_<societe>_<libellé>_<horodatage>.dat`.
- Les listes de plus de **15 jours** ne sont plus affichées
  (`FENETRE_JOURS_DEFAUT` dans le contrôleur, `?jours=0` pour tout l'historique).
  Constante de code : **aucune variable d'environnement** pour ce module.

**Statistiques préparateurs** : `GET /:dossier/stats?debut&fin` (onglet
« Statistiques » de l'écran, export Excel côté client). Par opérateur : nombre de
réappros, de lignes, prises/introuvables, unités, **temps effectif** (somme des
intervalles entre lignes, pauses > 5 min exclues) et **temps brut** (ouverture →
validation), plus la moyenne par ligne. Les listes préparées avant l'horodatage par
ligne sont comptées dans `listesSansTemps` au lieu d'être faussées à 0.

**Source proforma** (`reapproProformaImportService.js` +
`reapproProformaScheduler.js`, démarré par `server.js`) : toute proforma dont
l'**observation `proforma.TEXTE`** commence par « reappro » (casse/accents
indifférents) devient une liste. Mesuré sur QC : 1 147 documents depuis 2019, dont
**1 117 en ETAT 1** et seulement 29 en ETAT 2 — se limiter à l'ETAT 2 (celui de la
prépa de commande) raterait 97 % des réappros, donc on prend **tous les états sauf
les devis (3 et 4)**. `REPRES` donne le demandeur via `entreprise.vendeurs` (repli
« Vendeur 35 » quand l'onglet Vendeurs n'est pas renseigné). L'ERP ne purgeant
jamais ces tables, seules les proformas des **15 derniers jours** sont importées,
sinon le premier passage crée 1 147 listes. Clé d'unicité : société + NUMFACT. Une
liste encore « à faire » est resynchronisée si la proforma bouge, et supprimée si
la proforma n'est plus éligible ; **une liste ouverte par un opérateur n'est jamais
touchée**. Bouton « Importer les proformas » sur l'écran web pour forcer un tour
(`POST /:dossier/import-proformas`).
- La quantité demandée **n'est pas bornée au stock** (la disponibilité n'est pas
  contrôlée au dock) ; le stock reste affiché à titre indicatif.

## Fiches papier : contrôle réception et préparation manuelle

Deux modules jumeaux, même forme (liste DBF → aperçu → PDF A4 paysage → suivi
léger des impressions en Mongo, **aucune écriture DBF**) mais deux règles
métier **opposées** :

| | `reception_manuelle` | `prep_commande_manuelle` |
|---|---|---|
| Source | `cmdref` / `cmdetail`, ETAT ≥ 4 | `proforma` / `prodet`, **ETAT = 2** |
| Entête | fournisseur, bateau, arrivée | **client** et **vendeur** (REPRES) |
| Quantités | **jamais imprimées** (comptage à l'aveugle) | **imprimées** (c'est l'instruction) |
| Case vide | Qté reçue / Écart / Observation | **CTRL** (qté réellement prise si écart) |
| Suivi | `FicheReceptionModel` | `FichePreparationModel` |

**Parcours de la fiche de préparation** : le PDF est découpé en deux sections
successives — **1 · DOCK** puis **2 · MAGASIN** — et l'on commence *toujours*
par le dock. Pour chaque article : `qteDock = min(qté demandée, S2)`, le reste
part au magasin (S1). Un article peut donc apparaître **deux fois**, avec la
quantité propre à chaque zone (repère `>` sur la ligne). La répartition et
l'ordonnancement (gisement, priorité de parcours) ne sont **pas redéveloppés** :
`preparationManuelleService` appelle `analyserProforma()` de
`services/preparationService.js`, celui de la préparation scannée.

⚠️ Le reliquat magasin n'est **pas** borné par S1 : si le stock total ne couvre
pas la demande, la ligne part quand même au magasin avec un repère `!` et le
stock de la zone affiché — l'agent voit la rupture probable avant de chercher.

## Carte des domaines fonctionnels

Repères pour situer un écran / un routeur. Les préfixes API sont sous `/api/`.

**Gestion (terrain)** — `stock` (recherche article), `inventaire` (zones,
progression, récap, suivi bipage, fiches de contrôle), `reapro`,
`demande_reappro`, `proforma`, `ctr_commande`, `reception` + `reception_manuelle`,
`prep_commande` + `prep_commande_manuelle`, `envoi_cde_fournisseur`,
`ctrl_info_produit`, `releve`, `etiquettes`, `changement_prix`,
`historique_pachat`, `edition_promo`.

**Communication** — `mailing` (campagnes clients par blocs, segments,
automatisations, stats d'ouverture/clic, désinscription), `communication_client`
(catalogue nouveautés), `assistant_ia` (chat OpenAI cadré sur les données société
via outils lecture seule, SSE), `veille` (rapports d'actualité hebdomadaires
générés par l'IA, personnels).

**Données (admin)** — `client`, `commandes`, `facture`, `bipage`, `concurrents`,
`inventaire_proforma_admin`, `fiches_controle_admin`, `reception_suivi_admin`,
`suivi_entrees`, `resa_entrees`, `export_gisements_admin` (+ dictionnaire des
rayons).

**Commerciaux** — `commerciaux_outils` (boîte à outils, 1er outil : Top Ventes).

**Analyse** — `commerciaux_admin`, `filiales_admin`, `reappro_local_admin`,
`debit_comptant_admin`, `gencod_doublons_admin`, `analyse_ca_admin` (13 onglets,
générateurs dans `services/analyseCa/`), `performance_dock_admin`,
`analyse_reappro_admin`, `collecteurs_admin`, `rapport_tgc` (déclaration fiscale
mensuelle), `balances_clients`, `frequentation_admin` (plages horaires de passage
en caisse).

**Administration** — `dashboard_admin`, `users_admin`, `entreprises_admin`,
`infobulles_admin` (organisation du menu), `smtp_admin`.

**Master report** — socle de configuration interne éditable (`config_rapports`,
hub `/admin/config-rapports`, modèles sous `backend/models/masterConfig/`, seeds
sous `backend/data/masterConfig/`). Les modules TGC, balances et communication
client en sont issus.

**Abonnements aux rapports** — `/api/report-subscriptions`, registre des rapports
envoyables dans `backend/config/reportRegistry.js`. ⚠️ Voir « Tâches de fond » :
le planificateur n'est pas branché.

## Menu et sidebar

Trois couches, à ne pas confondre :

1. **Catalogue** — `frontend/src/config/menuConfig.js` (977 lignes) : liste des
   onglets disponibles, libellés, icônes, infobulles par défaut, et les helpers
   `getMenuCatalog`, `getDefaultLayout`, `buildSidebar`. C'est du **code** ; un
   nouvel écran s'y déclare.
2. **Organisation globale** — `MenuLayoutModel` (singleton `scope: "default"`) :
   chapitres ordonnés, rangement des onglets, onglets masqués. Édité par l'admin en
   drag & drop sur `/admin/infobulles` (`@dnd-kit`). C'est la **source de vérité**
   de l'affichage ; repli sur `getDefaultLayout()`. Un nouveau module non rangé
   tombe en « Non classé ».
3. **Organisation personnelle** — `UserMenuLayoutModel` (un doc par utilisateur,
   flag `useCustom`) : chaque utilisateur peut réorganiser SA sidebar via
   `/mon-menu`, sans impacter les autres.

`<ModuleRoute module="…">` s'appuie sur `PATH_MODULE_MAP` de
`frontend/src/config/adminModules.js` ; `<PrivateRoute>`, `<TeamRoute>`,
`<CommercialRoute>`, `<AccueilRoute>` complètent le gardiennage.

Si un lien de sidebar « manque » alors qu'il est bien dans le DOM, suspecter
`max-height` / `overflow` avant les permissions.

## Temps réel (chat, tâches, équipes, notifications)

`server.js` crée un serveur HTTP + Socket.IO sur la **même origine** que le REST ;
`io` est exposé aux contrôleurs via `req.app.get("io")`.

`backend/socket/chatSocket.js` authentifie chaque socket par le cookie JWT (web)
**ou** un token dans le handshake (app mobile). Salons : `global`, `team:<id>`,
`task:<id>`, plus un salon **personnel** `user:<id>` jamais quitté, qui porte les
notifications ciblées (message non lu, nouvelle tâche) et alimente les badges de la
sidebar. La présence (en ligne / actif / absent / occupé) est tenue **en mémoire**,
seul `lastSeenAt` est persisté.

Non-lus : `User.chatSeenAt` / `User.tasksSeenAt` + `/api/notifications`. Les
discussions de l'espace équipe sont dans `ConversationModel`, les pièces jointes en
GridFS.

**Redémarrer le backend après toute modification du socket.**

## Tâches de fond

Démarrées dans `server.js` :

| Tâche | Rôle |
|---|---|
| `startInventaireWatcher()` | Surveille le partage `.dat`, génère le PDF de fiche de contrôle et l'imprime (SumatraPDF via `pdf-to-printer`). **Ne démarre pas si `RCOMMON_STOCK_ROOT` est défini** (= prod VPS) ; surcharge par `RUN_FICHE_WATCHER`. |
| `startMailingScheduler()` | Envoi des campagnes par lots (25/h). |
| `startAiSnapshotScheduler()` | Snapshots de ventes pour l'assistant IA. |
| `startMeteoScheduler()` | Contexte météo de l'écran Fréquentation. |
| `startCommercialIndexWarmer()` | Préchauffe les index facture/proforma toutes les 8 min (sociétés à commercial actif uniquement). |
| `startReapproProformaScheduler()` | Import horaire des proformas « reappro ». |
| `startVeilleScheduler()` | Génération hebdomadaire des rapports de veille. |

⚠️ **`startReportScheduler()` (`services/reportScheduler.js`) existe mais n'est
appelé nulle part.** Les abonnements aux rapports ne partent donc jamais tout
seuls, alors que l'écran laisse penser le contraire. Le brancher ou retirer
l'écran, mais ne pas laisser l'ambiguïté.

**Impression en production** : le backend est un VPS Ubuntu qui ne peut pas
imprimer. C'est `npm run print-agent` (`backend/printAgent.js`), lancé sur le poste
`192.168.0.250` qui a le Rcommun **et** l'imprimante, qui porte le watcher. Il se
connecte au **même** MongoDB Atlas. La réimpression demandée depuis le web passe
par `FicheControle.reprintRequested`.

## Clients mobiles

- **`test-app-qc/QcApp`** — application collecteur (Expo / React Native 0.81,
  socket.io-client, expo-sqlite). **Dépôt git séparé**, exclu de ce repo par
  `.gitignore`. C'est elle qui gère le scan/collecte d'inventaire par rayon, le
  bipage, les listes de réappro et la messagerie — pas l'application web.
- Endpoints qui lui sont dédiés : `/api/demande-reappro/mobile/*`,
  `/api/demande-bipage/mobile/*`, `/api/reception-suivi/mobile/*`,
  `/api/inventaires-collecte`, `/api/bipage-collecte`, `/api/collecteurs`,
  `/api/app-release` (`GET /current` est **public** : page d'installation).
- **L'app de scan réception est un client RN sur un autre backend** ; le Mongo est
  un Atlas cloud partagé. Le vérifier avant de conclure qu'un correctif ne marche
  pas.
- L'app vise `robot-nc.com`, dont la **base Mongo est différente** de celle du
  poste de dev (même `JWT_SECRET`). L'adresse du serveur est modifiable sur l'écran
  de connexion.

## Conventions de code

**Backend** — routes → contrôleurs → services :

- `backend/routes/*Routes.js` câblent les chaînes de middleware (presque toujours
  `protect` en premier, puis `checkEntrepriseAccess` / `checkModuleAccess`).
  Plusieurs routeurs définissent des tableaux de gardes réutilisables
  (`const read = [protect, checkEntrepriseAccess, checkModuleAccess(MODULE, "read")]`).
- `backend/controllers/*Controller.js` sont **minces**, enveloppés dans
  `asyncHandler` ; les erreurs remontent à `notFound` / `errorHandler`. Ce contrat
  n'est pas tenu sur les plus gros modules (réception : 3 226 lignes) — ne pas
  aggraver.
- `backend/services/*` portent la vraie logique : cache DBF, génération
  Excel/PDF (`exceljs`, `pdfkit`), envoi de rapports, construction de chemins
  (`utils/*Paths.js`).
- Un nouveau routeur doit être **importé ET monté** (`app.use()`) dans
  `backend/server.js`, sous `/api/...`.
- ESM (`"type": "module"`) : `import`/`export`, et `__dirname` dérivé de
  `path.resolve()`.

**Frontend** — React 19 (CRA) + Redux Toolkit + RTK Query :

- Un seul store (`frontend/src/store.js`) ; tout le HTTP passe par `apiSlice.js`
  (RTK Query, un `injectEndpoints` par slice de feature dans
  `frontend/src/slices/*ApiSlice.js`). Ajouter les nouveaux tags de cache au
  tableau `tagTypes` d'`apiSlice.js`.
- Slices d'état non-API : `authSlice`, `entrepriseGlobalSlice` (société
  sélectionnée — un sélecteur **global** dans le header remplace progressivement
  les sélecteurs par module), `inventaireSelectionSlice`.
- Le routage est dans `frontend/src/index.js`. Écrans dans `screens/user/`,
  `screens/admin/`, `screens/commercial/`.
- `BASE_URL` (`frontend/src/constants.js`) vaut `""` : l'app suppose la **même
  origine** (proxy en dev, Express servant le build en prod).
- Les variables `--admin-*`, `color-scheme: dark` et `option{}` sont définies
  **globalement** dans `index.css`. ⚠️ collision de la classe globale `.info-card`
  (fond blanc) → scoper.
- ⚠️ `frontend/src/setupProxy.js` est indispensable : le champ `proxy` de
  `package.json` ne relaie pas les requêtes de navigation (`Accept: text/html`), ce
  qui casse `window.open("/api/...")`. **Redémarrer le front après toute
  modification de ce fichier.**

## Pièges connus et dette identifiée

Détail complet et priorisation dans `docs/AUDIT_APPLICATION.md`.

- **Registres de permission désynchronisés** (3 sources, 6 clés divergentes) —
  §3.1. Vérifier les trois fichiers avant de conclure qu'un droit « ne marche pas ».
- **`backend/routes/InventaireRoutes.js` ne contient plus les routes
  d'inventaire** : depuis le commit `7c5bf4f` (09/07/2026) c'est un clone des
  routes de zones. `/api/inventaires` et `/api/inventaires-zones` servent donc les
  mêmes routes avec deux politiques d'accès différentes, et
  `backend/controllers/inventaireController.js` (1 052 lignes) est orphelin. Les
  écrans concernés ne sont plus dans le menu — §3.2.
- **Deux routeurs montés sur `/api/filiales`** (`fillialeRoutes.js` = comparatif
  par article ; `filialesRoutes.js` = analyse réseau DQ/QC/LD). Ça ne marche que
  parce que leurs formes d'URL ne se recouvrent pas — §3.3.
- **Code mort** : `AdminProformaScreen.jsx`, `AdminDoublonsGencodeScreen.jsx`,
  `frontend/src/utils/api.js` (utilise `NEXT_PUBLIC_*`, jamais exposé par CRA),
  `/api/dashboard/*` sans consommateur web — §3.4.
- **`exemple.env` ne suffit pas** à monter une instance — §3.5.
- **Aucun test.** Les fonctions pures à fort enjeu (calcul TGC, format `.dat`,
  `assertGrantWithinScope`, périmètre commercial) n'ont aucun filet.
- **Pas de limitation de débit sur `/api/users/login`** (`limiterDebit` n'existe
  que pour l'API partenaire).
- **États des documents** : les pastilles proforma/facture/commande/réservation
  viennent des `mappingEtats*` de la fiche société — **jamais de libellés en dur**.
  `mappingEtatsFacture` est vide partout.

## Notes

- Les `.dbf` sont ignorés par git ; ceux de `backend/data/` sont des échantillons
  locaux.
- Email via `nodemailer` (`backend/utils/sendEmail.js`). La configuration SMTP est
  surchargeable en base : **module > global > `.env`** (écran `/admin/smtp`,
  périmètres dans `backend/config/smtpScopes.js`, miroir front
  `frontend/src/config/smtpScopes.js`).
- ⚠️ Garde-fous d'envoi : les tests de mailing ne doivent atteindre que
  `communication@` / `support@quincaillerie.nc` et `krysto.contact@gmail.com`,
  **jamais la base clients**. Le module Envoi Cde Fournisseur est en **mode test
  par défaut** (piloté par société dans l'UI).
- Uploads : GridFS (avatars, documents de tâches, exécutables) et `uploads/` pour
  les fichiers temporaires ; `multer` est utilisé par 13 routeurs.
