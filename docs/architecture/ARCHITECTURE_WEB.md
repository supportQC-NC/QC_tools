# Architecture — Application WEB

> Diagrammes de l'outil interne B2B multi-sociétés (groupe de quincailleries de
> Nouvelle-Calédonie). Établi le 12/11/2026 par lecture du dépôt.
> Document frère : **[ARCHITECTURE_MOBILE.md](./ARCHITECTURE_MOBILE.md)**.
>
> Les diagrammes sont en **Mermaid** : ils se rendent dans VS Code (extension
> *Markdown Preview Mermaid Support*), GitHub, Obsidian ou sur mermaid.live.

## Ordres de grandeur (mesurés sur le dépôt)

| Couche | Volume |
|---|---|
| Backend | ~106 600 lignes — **88 routeurs**, **90 contrôleurs**, **106 services**, **67 modèles** (+5 masterConfig) |
| Frontend | ~87 900 lignes — **120 écrans**, **81 slices** RTK Query / Redux, ~50 composants |
| App collecteur | ~16 800 lignes (dépôt git séparé, `test-app-qc/QcApp`) |
| Tests | **aucun** — ni back, ni front, ni mobile |

### Sommaire

1. [Vue d'ensemble de la plateforme](#1-vue-densemble-de-la-plateforme)
2. [Les deux sources de données](#2-les-deux-sources-de-données--le-cœur-de-larchitecture)
3. [Chaîne de traitement d'une requête API](#3-chaîne-de-traitement-dune-requête-api)
4. [Authentification, rôles et permissions](#4-authentification-rôles-et-permissions)
5. [Frontend — pile et gardiennage](#5-frontend--pile-et-gardiennage-des-routes)
6. [Carte des domaines fonctionnels](#6-carte-des-domaines-fonctionnels--88-routeurs)
7. [Modèle de données MongoDB](#7-modèle-de-données-mongodb)
8. [Tâches de fond et impression](#8-tâches-de-fond-et-chaîne-dimpression)
9. [Flux inventaire par zones](#9-flux-inventaire-par-zones--de-bout-en-bout)
10. [Espace commercial](#10-espace-commercial--découpage-imposé-par-la-perf)
11. [API partenaire](#11-api-partenaire--apipublicv1)
12. [Temps réel](#12-temps-réel--socketio)
13. [Dev / prod et variables d'environnement](#13-bascule-devprod-et-variables-denvironnement)
14. [Pièges connus et dette](#14-pièges-connus-et-dette-identifiée)

---

## 1. Vue d'ensemble de la plateforme

Qui parle à qui, et par quoi.

```mermaid
flowchart TB
    subgraph clients["Clients"]
        NAV["Navigateur<br/>React 19 CRA"]
        COL["Collecteur Android<br/>Expo / React Native"]
        SITEC["Integrateur SITEC<br/>site marchand"]
        MAILC["Client mail<br/>images de signature"]
    end

    subgraph serveur["Serveur Node.js — backend/server.js, ESM"]
        EXP["Express<br/>+ build CRA servi en prod"]
        IO["Socket.IO<br/>meme origine que le REST"]
        BG["Taches de fond<br/>7 schedulers"]
    end

    subgraph donnees["Sources de donnees"]
        MONGO[("MongoDB Atlas<br/>etat applicatif — 67 modeles")]
        DBF[("Fichiers DBF de l'ERP<br/>LECTURE SEULE — 15 tables")]
        FTPS[("FTPS robot-documents<br/>192.168.0.252 / 202.22.228.91:2121")]
        GRID[("GridFS<br/>avatars, pieces jointes, medias")]
    end

    subgraph externes["Services externes"]
        SMTP["SMTP — nodemailer"]
        AI["OpenAI + Tavily<br/>assistant IA, veille"]
        MAPBOX["Mapbox<br/>carte des collecteurs"]
    end

    subgraph poste["Poste 192.168.0.250 — Rcommun ET imprimante"]
        AGENT["npm run print-agent<br/>watcher .dat puis PDF puis SumatraPDF"]
        SHARE[("Partages Windows<br/>STOCK, collect_sec, photos")]
        PRINT["Imprimante"]
    end

    NAV -->|"REST /api — cookie httpOnly token"| EXP
    NAV -->|"websocket"| IO
    COL -->|"REST — cookie"| EXP
    COL -->|"websocket + token dans le handshake"| IO
    SITEC -->|"GET /api/public/v1 — X-API-Key"| EXP
    MAILC -->|"GET /api/mediatheque/public/slug — SANS auth"| EXP

    EXP --> MONGO
    EXP --> DBF
    EXP --> FTPS
    EXP --> GRID
    EXP --> SMTP
    EXP --> AI
    NAV --> MAPBOX
    BG --> MONGO
    BG --> DBF
    BG --> SMTP
    BG --> FTPS

    AGENT --> MONGO
    AGENT --> SHARE
    AGENT --> PRINT
    EXP -.->|"depot .dat, lecture PDF"| SHARE

    classDef ro fill:#ffe0e8,stroke:#cc6677,color:#000
    class DBF ro
```

**À retenir**

- L'ERP est **strictement en lecture** : aucune écriture DBF n'existe dans le code,
  et il ne doit pas en être ajouté.
- Le backend de production est un **VPS Ubuntu qui ne peut pas imprimer** ;
  l'impression des fiches de contrôle est portée par l'agent local sur
  `192.168.0.250`, branché au **même** Mongo Atlas.
- `BASE_URL = ""` côté front : **même origine** — proxy CRA en dev, Express
  servant le build en prod.

---

## 2. Les deux sources de données — le cœur de l'architecture

Ce n'est **pas** une application CRUD Mongo. Deux backends cohabitent, et tout ce
qui vient du DBF est scopé par société via le paramètre de route `:nomDossierDBF`.

```mermaid
flowchart LR
    subgraph app["Etat propre a l'application — MongoDB, 67 modeles"]
        U["REFERENTIEL — User, Permission, Team, Entreprise"]
        INV["TERRAIN — InventaireZoneSession, InventaireCollecte,<br/>LigneBipage, FicheControle, DemandeReappro,<br/>DemandeBipage, Reception, Preparation"]
        COM["SERVICES — MailCampaign, MailEvent, VeilleRapport,<br/>AiConversation, MenuLayout, SmtpConfig"]
    end

    subgraph erp["Source de verite ERP — 15 tables .dbf lues avec dbffile"]
        A["CATALOGUE — article.dbf + artplus.dbf"]
        C["TIERS — clients.dbf, tiers.dbf, fourniss.dbf"]
        CMD["DOCUMENTS — cmdref + cmdetail, proforma + prodet,<br/>facture + detail, entrees.dbf"]
        DIV["DIVERS — balances.dbf, verif.dbf, filiales.dbf"]
    end

    CACHES["Services de CACHE DBF<br/>3 familles, sans couche commune"]

    ENTREP[("Entreprise — le pivot<br/>nomDossierDBF + trigramme<br/>cheminBase, cheminExportInventaire<br/>cheminRapportReception, cheminPhotos")]

    ENTREP -->|"resout les chemins fichiers"| erp
    erp -->|"DBFFile.open readMode loose"| CACHES
    CACHES -->|"Map + index NART, GENCOD, GROUPE, GISM1, FOURN"| CTRL["Controleurs et services metier"]
    app --> CTRL

    style erp fill:#ffe0e8,stroke:#cc6677
```

### Les trois familles de cache DBF

Relire le DBF à chaque requête est trop lent — 90 000+ articles, **1,7 M factures
et 6,2 M lignes** chez QC.

```mermaid
flowchart TB
    POURQUOI["Preferer TOUJOURS le service de cache<br/>a l'ouverture directe d'un DBFFile"]

    K1["1 — CLASSE A ETAT<br/>this.cacheTTL + loadingLocks, pour eviter<br/>les chargements concurrents<br/>articleService, clientCacheService, factureCacheService,<br/>proformaCacheService, commandeService, fournissCacheService"]
    K2["2 — MODULE + Map<br/>artplusService, balancesService, rapportTgcService,<br/>verifService, resaEntreesService"]
    K3["3 — INDEX COLONNAIRES EN TypedArrays<br/>pour les gros volumes<br/>frequentationService, commercialService"]

    TTL["TTL de 30 s a 15 min selon le service.<br/>Certains invalident AUSSI sur mtime/taille,<br/>d'autres VOLONTAIREMENT PAS — voir l'espace commercial.<br/>Verifier la politique du service avant de la changer."]

    POURQUOI --> K1 --> K2 --> K3 --> TTL

    style POURQUOI fill:#d9f2d9,stroke:#339933
    style TTL fill:#fff2cc,stroke:#cc9933
```

### Règles DBF non négociables

```mermaid
flowchart TD
    R1["1. DBFFile.open TOUJOURS avec readMode loose<br/>sinon crash Duplicate field name sur les .dbf herites"]
    R2["2. Jeu de caracteres DOS restitue TEL QUEL<br/>comportement GLOBAL — ne pas corriger dans un seul service,<br/>ca desaligne les champs entre eux"]
    R3["3. GENCOD : zeros de tete JAMAIS retires<br/>C(13) — chez QC 2456 codes commencent par 0<br/>et 1341 existent sous DEUX ecritures du meme code<br/>toute recherche passe par utils/codeBarres.js"]
    R4["4. NART C(6) : meme maladie — 12345 et 012345<br/>passer par articleCacheService.lookupNart / variantesNart"]
    R5["5. Un GENCOD de 12 chiffres est un UPC-A :<br/>il porte DEJA sa cle. EAN-13 = 0 + le code,<br/>surtout pas une cle de plus"]
    R6["6. Le champ CODE(13) d'un .dat Stock XL porte le NART,<br/>JAMAIS le GENCOD"]
    R7["7. La colonne CODE de la FICHE DE CONTROLE porte<br/>le GENCOD DU CATALOGUE — un seul endroit decide :<br/>ficheControleService.construireLignes"]
    R8["8. Les tables ERP ne sont JAMAIS purgees<br/>tout compteur en cours est borne par une fenetre glissante"]
    R9["9. Quantites : AUCUN arrondi a l'unite<br/>N(x.3), articles au metre — .dat via utils/qteDat.js"]

    R1 --> R2 --> R3 --> R4 --> R5 --> R6 --> R7 --> R8 --> R9
```

**Trois codes à ne pas confondre** sur la chaîne d'inventaire :

| Usage | Code employé | Décidé dans |
|---|---|---|
| Écriture du `.dat` Stock XL | **NART** | `genererContenuFichier` |
| Résolution de l'article | **code réellement bipé** | `InventaireCollecte.lignes[].codeScanne` |
| Affichage fiche de contrôle | **GENCOD du catalogue** | `ficheControleService.construireLignes` |

---

## 3. Chaîne de traitement d'une requête API

```mermaid
sequenceDiagram
    autonumber
    participant N as Navigateur
    participant E as Express
    participant M as installerMasqueDbf
    participant P as protect
    participant A as checkEntrepriseAccess<br/>checkModuleAccess
    participant C as Controleur asyncHandler
    participant S as Service
    participant D as Cache DBF ou Mongo

    N->>E: GET /api/articles/:nomDossierDBF — cookie token
    E->>M: app.use /api, installerMasqueDbf AVANT les routeurs
    Note over M: enveloppe res.json<br/>le masquage est acquis PAR CONSTRUCTION
    M->>P: routeur
    P->>P: verifie le JWT du cookie httpOnly
    P->>P: pose req.user ET req.masqueDbf
    P->>A: suite de la chaine
    A->>A: le bon MODULE read/write/delete ET la bonne SOCIETE
    Note over A: les admins court-circuitent checkModuleAccess<br/>mais PAS checkEntrepriseAccess
    A->>C: handler
    C->>S: logique metier — le controleur reste mince
    S->>D: lecture via le cache, pas DBFFile.open
    D-->>S: donnees
    S-->>C: resultat
    C-->>M: res.json payload
    M->>M: filtre les champs DBF interdits — Permission.champsDbf
    M-->>N: JSON filtre
    Note over C,S: PIEGE — seul le JSON passe par le masque.<br/>Les exports Excel et PDF doivent filtrer A LA SOURCE<br/>avec filtrerColonnes(req, colonnes) / champMasque(req, champ)
```

Les erreurs remontent à `notFound` puis `errorHandler`
(`backend/middleware/errorMiddleware.js`). Un nouveau routeur doit être
**importé ET monté** (`app.use()`) dans `backend/server.js`.

---

## 4. Authentification, rôles et permissions

```mermaid
flowchart TB
    subgraph auth["Authentification"]
        JWT["JWT dans un cookie httpOnly nomme token<br/>PAS d'en-tete Bearer"]
        WEB["Front : credentials include<br/>CORS credentials true, pilote par FRONTEND_URL"]
        MOB["App mobile : POST /api/users/socket-token<br/>token passe dans le handshake socket"]
        JWT --> WEB
        JWT --> MOB
    end

    subgraph roles["Roles — UserModel.role"]
        SA["SUPER-ADMIN = admin + allEntreprises<br/>requis pour la gestion users et societes"]
        AD["admin — tous les modules<br/>MAIS scope a ses societes"]
        RE["responsable — droits explicites comme un user<br/>+ gestion d'equipes TeamModel<br/>avec permissions ATTENUEES, sous-ensemble des siennes"]
        US["user — droits explicites uniquement"]
        SA --> AD --> RE --> US
    end

    subgraph dims["Controle d'acces A DEUX DIMENSIONS"]
        MOD["MODULE — checkModuleAccess cle, action<br/>read / write / delete<br/>accepte un TABLEAU : un seul suffit"]
        ENTR["SOCIETE — checkEntrepriseAccess<br/>sur :entrepriseId ou :nomDossierDBF<br/>s'applique AUSSI aux admins"]
        OK(["Acces accorde"])
        MOD -->|"ET"| OK
        ENTR -->|"ET"| OK
    end

    auth --> dims
    roles --> dims
```

### Gardes complémentaires et droits fins

```mermaid
flowchart TB
    subgraph garde["Gardes complementaires — middleware/accessControl.js"]
        G1["superAdmin, getAccessibleEntreprises"]
        G2["checkAnalyseAccess, checkTeamAccess"]
        G3["getManageableUserScope, canAssignRole"]
        G4["assertGrantWithinScope — GARDE ANTI-ESCALADE<br/>on n'accorde jamais plus que ce qu'on possede,<br/>module par module ET societe par societe<br/>miroir NON securitaire au front : config/adminModules.js"]
    end

    subgraph champs["Droits champ par champ sur le DBF"]
        CH["Permission.champsDbf<br/>{ table: { mode: tous ou liste, champs: [] } }<br/>tables : backend/config/dbfTables.js<br/>noms de champs lus dans le DBF REEL — dbfChampsService"]
        CH --> CH2["Filtrage PAR NOM DE CHAMP sur toutes les reponses :<br/>un champ masque sur une table l'est partout<br/>ou ce nom apparait. Volontairement plus strict que fin."]
    end

    subgraph comm["Espace commercial — un PROFIL, pas un module"]
        CM["Permission.commercial = { actif, codes: [ { entreprise, code } ] }<br/>cle = societe + code vendeur REPRES — QC 12, KQ 08"]
        CM --> CM2["requireCommercial + checkCommercialEntreprise<br/>posent req.codesCommercial — seul filtre du service"]
        CM2 --> CM3["Un code REPRES n'est pas forcement un commercial :<br/>entreprise.vendeurs[].type === commercial fait foi<br/>repasser un code en vendeur ferme l'acces IMMEDIATEMENT"]
    end

    style G4 fill:#ffe9c9,stroke:#cc9933
```

**Exception assumée au scoping société** : `GET /api/inventaires-zones/:entrepriseId/agents-possibles`
renvoie **tous** les comptes actifs — un inventaire est régulièrement renforcé par
du personnel d'une autre société du groupe, qui doit pouvoir être crédité de son
travail. La route reste `admin` + `checkEntrepriseAccess` et ne renvoie que
l'identité (nom, e-mail).

**Décision client** : un responsable gère **tous** les utilisateurs de ses
sociétés, pas seulement les membres de son équipe.

### Le registre des modules vit à TROIS endroits

```mermaid
flowchart LR
    B["backend/config/adminModules.js<br/>SOURCE DE VERITE"]
    F["frontend/src/config/adminModules.js<br/>miroir + PATH_MODULE_MAP<br/>chemin d'ecran vers cle, pour ModuleRoute"]
    M["backend/models/PermissionModel.js<br/>schema Mongo"]

    B <-->|"a garder aligne"| F
    B <-->|"a garder aligne"| M

    D1["DERIVE — front seulement :<br/>executables_admin, facture_analyse_admin<br/>journal_caisse_admin, top_articles_admin"]
    D2["DERIVE — absents du schema Mongo :<br/>analyse_reappro_admin, reception_suivi_admin"]
    D3["Consequence : ces ecrans ne sont atteignables que par un admin,<br/>le droit n'etant pas persistable"]

    F --> D1 --> D3
    M --> D2 --> D3

    style B fill:#d9f2d9,stroke:#339933
    style D3 fill:#ffd9d9,stroke:#cc3333
```

> **En ajoutant un module, mettre à jour les trois.** Vérifier ces trois fichiers
> avant de conclure qu'un droit « ne marche pas ».

---

## 5. Frontend — pile et gardiennage des routes

```mermaid
flowchart TB
    IDX["frontend/src/index.js — TOUT le routage"]

    subgraph guards["Gardes de route"]
        PR["PrivateRoute — session valide"]
        MR["ModuleRoute module=cle<br/>s'appuie sur PATH_MODULE_MAP"]
        CR["CommercialRoute — profil commercial"]
        TR["TeamRoute — equipes et taches"]
        AR["AccueilRoute — la page / selon le profil"]
    end

    subgraph store["Etat — un seul store, frontend/src/store.js"]
        API["apiSlice.js — RTK Query<br/>tout le HTTP passe par la<br/>un injectEndpoints par feature — 81 slices<br/>ajouter les nouveaux tags au tableau tagTypes"]
        AUTH["authSlice"]
        EG["entrepriseGlobalSlice — societe selectionnee<br/>selecteur GLOBAL du header, qui remplace<br/>progressivement les selecteurs par module"]
        IS["inventaireSelectionSlice"]
    end

    subgraph ecrans["Ecrans — 120"]
        SU["screens/user — 16<br/>inventaire, reappro, controle commande,<br/>preparation, assistant IA, veille,<br/>mediatheque, espace equipe, mes taches"]
        SAD["screens/admin — 94<br/>donnees ERP, inventaire zones, analyses,<br/>administration, master report"]
        SC["screens/commercial — 10<br/>dashboard, portefeuille, proformas,<br/>reservations, factures, prime, alertes"]
    end

    subgraph menu["Menu et sidebar — TROIS couches a ne pas confondre"]
        L1["1. CATALOGUE — config/menuConfig.js<br/>onglets, libelles, icones, infobulles par defaut<br/>getMenuCatalog, getDefaultLayout, buildSidebar<br/>C'est du CODE : un nouvel ecran s'y declare"]
        L2["2. ORGANISATION GLOBALE — MenuLayoutModel<br/>singleton scope default, drag and drop /admin/infobulles<br/>SOURCE DE VERITE de l'affichage<br/>arborescence A PLAT, PROFONDEUR MAX 2"]
        L3["3. ORGANISATION PERSONNELLE — UserMenuLayoutModel<br/>un doc par utilisateur, flag useCustom, ecran /mon-menu"]
        L1 --> L2 --> L3
    end

    IDX --> guards
    guards --> ecrans
    ecrans --> store
    store -->|"fetch meme origine, credentials include"| BACK["/api/..."]
    menu --> ecrans

    PROXY["setupProxy.js — INDISPENSABLE en dev<br/>le champ proxy de package.json ne relaie PAS les requetes<br/>de navigation Accept text/html, ce qui casse window.open('/api/...')<br/>REDEMARRER le front apres toute modification"]
    IDX -.-> PROXY

    style L2 fill:#d9f2d9,stroke:#339933
    style PROXY fill:#fff2cc,stroke:#cc9933
```

**Sidebar** : elle s'ouvre **entièrement repliée** (décision client — l'état des
dossiers n'est plus persisté en localStorage). Le champ de recherche sous le
switch Défaut/Perso est le chemin rapide : il aplatit tout le menu, filtre sans
accent ni casse, et affiche le chemin du dossier sous chaque résultat.

Si un lien de sidebar « manque » alors qu'il est bien dans le DOM : suspecter
`max-height` / `overflow` **avant** les permissions.

---

## 6. Carte des domaines fonctionnels — 88 routeurs

Repères pour situer un écran ou un routeur. Les préfixes API sont sous `/api/`.

```mermaid
flowchart LR
    ROOT(["/api — 88 routeurs montes dans server.js"])

    ROOT --> TER["TERRAIN — gestion<br/>le travail quotidien en magasin et au dock"]
    ROOT --> DON["DONNEES — admin ERP<br/>consultation des tables de l'ERP"]
    ROOT --> ANA["ANALYSE<br/>restitutions, classeurs, indicateurs"]
    ROOT --> COM["COMMUNICATION<br/>mailing, IA, medias, temps reel"]
    ROOT --> ADM["ADMINISTRATION<br/>utilisateurs, societes, menu, rapports"]
    ROOT --> CMR["COMMERCIAL<br/>espace reserve au profil commercial"]
    ROOT --> PUB["API PARTENAIRE<br/>lecture seule, cle X-API-Key"]

    style PUB fill:#e6e6ff,stroke:#6666cc
```

### Domaines — Terrain

```mermaid
flowchart LR
    TER["TERRAIN — gestion"]

    TER --> T1["stock — recherche article<br/>articles, fournisseurs, photos, fiche-article"]
    TER --> T2["inventaire — inventaires-zones, inventaires-collecte<br/>fiches-controle, zones, bipages, inventaire-proforma"]
    TER --> T3["reapro — reappros, reappro-mecalac, reappro-local"]
    TER --> T4["demande_reappro — demande-reappro<br/>listes poussees au collecteur"]
    TER --> T5["bipage — demande-bipage, bipage-collecte"]
    TER --> T6["reception + reception_manuelle<br/>receptions, reception-manuelle, reception-suivi"]
    TER --> T7["prep_commande + prep_commande_manuelle<br/>preparations, suivi-preparations"]
    TER --> T8["ctr_commande — controle-commandes"]
    TER --> T9["etiquettes, changement-prix, edition-promo<br/>releves, historique-pachat, envoi-cde-fournisseur"]
    TER --> T10["collecteurs, app-release<br/>GET /app-release/current est PUBLIC"]
```

### Domaines — Données et Analyse

```mermaid
flowchart LR
    DON["DONNEES — admin ERP"]
    ANA["ANALYSE"]

    DON --> D1["clients, commandes, factures, proformas, fournisseurs"]
    DON --> D2["concurrents, suivi-entrees, resa-entrees"]
    DON --> D3["export-gisements + dictionnaire-rayons"]
    DON --> D4["champs-dbf — droits champ par champ"]

    ANA --> A1["analyse-ca, analyse-ca-matrices, analyse-ca-mensuelle<br/>analyse-stock, stats-commerciaux, historique-promos<br/>FICHIERS DU FTPS robot-documents — seule source"]
    ANA --> A2["filiales — deux routeurs montes sur le meme prefixe<br/>fillialeRoutes comparatif article<br/>filialesRoutes analyse reseau"]
    ANA --> A3["commerciaux, top-ventes, top-articles<br/>facture-analyse, proforma-analyse, journal-caisse"]
    ANA --> A4["rapport-tgc, balances-clients, derniere-facturation<br/>frequentation, debit-comptant, gencod-doublons"]
    ANA --> A5["performance-dock, analyse-reappro"]

    style A2 fill:#fff2cc,stroke:#cc9933
```

### Domaines — Communication, Administration, API partenaire

```mermaid
flowchart LR
    COM["COMMUNICATION"]
    ADM["ADMINISTRATION"]
    CMR["COMMERCIAL"]
    PUB["API PARTENAIRE"]

    COM --> C1["mailing — campagnes par blocs, segments,<br/>automatisations, stats, desinscription"]
    COM --> C2["communication-client — catalogue nouveautes"]
    COM --> C3["ai — assistant IA, outils lecture seule, SSE"]
    COM --> C4["veille — rapports hebdo IA, personnels"]
    COM --> C5["mediatheque — GridFS + lien PUBLIC sans auth"]
    COM --> C6["messages, conversations, notifications — temps reel"]

    ADM --> M1["users, entreprises, teams, tasks"]
    ADM --> M2["menu-layout, menu-hints, raccourcis"]
    ADM --> M3["smtp-config — surcharge module puis global puis .env"]
    ADM --> M4["config-rapports — socle MASTER REPORT"]
    ADM --> M5["report-subscriptions — registre reportRegistry.js"]
    ADM --> M6["executables, documents-ftp, repertoire-personnel"]

    CMR --> R1["commercial — dashboard, portefeuille, proformas,<br/>reservations, factures, alertes, prime"]

    PUB --> P1["public/v1 — articles, produits, clients<br/>LECTURE SEULE, X-API-Key, cles en CLI"]

    style PUB fill:#e6e6ff,stroke:#6666cc
```

### Deux « suivis bipage » à ne pas confondre

```mermaid
flowchart LR
    S1["/admin/suivi-demandes-bipage — module bipage<br/>suit les DEMANDES envoyees aux collecteurs depuis le web<br/>qui a bipe quoi, combien de lignes, en combien de temps<br/>vit avec les documents DemandeBipage<br/>Dossier : Terrain puis Bipage"]
    S2["/admin/suivi-bipage — module inventaire<br/>suit le COMPTAGE D'INVENTAIRE par zone<br/>se vide a chaque reinitialisation d'inventaire<br/>Dossier : Inventaire Zones"]
    S1 --- NB(["Memes mots, deux ecrans, deux modules"]) --- S2
```

### Réappro et bipage ne posent PAS la même question

```mermaid
flowchart TB
    Q1["REAPPRO — remplir le RAYON<br/>critere : S1 = 0 ET stock en reserve S2..S5 > 0<br/>on affiche le gisement du DOCK — GISM2 + libelle,<br/>la ou l'operateur va chercher"]
    Q2["BIPAGE — comptage LIBRE<br/>on compte ce qu'on veut, QUEL QUE SOIT le stock<br/>selection par fournisseur triee par meilleures ventes"]
    SVC["MEME service : bipageSelectionService<br/>le parametre emplacement MAGASIN/DOCK ne change que<br/>l'AFFICHAGE, jamais le critere de selection"]
    GIS["GISM1 = le rayon, emplacement MAGASIN<br/>GISM2 = la reserve, emplacement DOCK<br/>libelle resolu sur le couple CODE + EMPLACEMENT<br/>chez QC le meme code porte souvent deux noms"]
    LRV["Liste RAYON VIDE — getArticlesRayonVide<br/>absents du rayon S1 = 0 alors qu'il reste de la reserve<br/>triee MEILLEURES VENTES d'abord, somme des V1..V12<br/>1906 articles chez QC — l'ordre alphabetique n'y servirait a rien<br/>Elle vit sur l'ecran Listes de reappro, PAS sur les demandes de bipage"]
    EXCL["Les articles renvoyes GENDOUBL sont ecartes de toutes ces listes<br/>et comptes a part : faire biper un code que l'ERP n'utilise plus n'a pas de sens"]

    Q1 --> SVC
    Q2 --> SVC
    SVC --> GIS
    SVC --> LRV --> EXCL
```

---

## 7. Modèle de données MongoDB

Les entités centrales et leurs liens (67 modèles — seuls les pivots figurent ici).

```mermaid
erDiagram
    ENTREPRISE ||--o{ PERMISSION : "scope"
    ENTREPRISE ||--o{ INVENTAIRE_ZONE_SESSION : "porte"
    ENTREPRISE ||--o{ DEMANDE_REAPPRO : "porte"
    ENTREPRISE ||--o{ DEMANDE_BIPAGE : "porte"
    ENTREPRISE ||--o{ RECEPTION : "porte"
    ENTREPRISE ||--o{ PREPARATION : "porte"
    ENTREPRISE ||--o{ COLLECTEUR : "parc"

```

### Modèle de données — utilisateurs, équipes et échanges

```mermaid
erDiagram
    USER ||--|| PERMISSION : "droits"
    USER }o--o{ TEAM : "membre"
    USER ||--o{ USER_MENU_LAYOUT : "sidebar perso"
    USER ||--o{ TASK : "assignee"
    USER ||--o{ MESSAGE : "auteur"
    USER ||--o{ SUIVI_COMMERCIAL : "relances"

    TEAM ||--o{ CONVERSATION : "discussions"
    CONVERSATION ||--o{ MESSAGE : "contient"

```

### Modèle de données — les flux du terrain

```mermaid
erDiagram
    INVENTAIRE_ZONE_SESSION ||--o{ INVENTAIRE_COLLECTE : "zones bipees"
    INVENTAIRE_COLLECTE ||--o{ LIGNE_BIPAGE : "lignes creditees"
    INVENTAIRE_ZONE_SESSION ||--o{ FICHE_CONTROLE : "fiches imprimees"
    INVENTAIRE_ZONE_SESSION ||--o{ INVENTAIRE_STOCK_SNAPSHOT : "photo stock"

    DEMANDE_REAPPRO ||--o{ LIGNE_REAPPRO : "lignes"
    RECEPTION ||--o{ COMPTAGE : "comptages"
    RECEPTION ||--o{ SIGNALEMENT : "anomalies + photos"
    PREPARATION ||--o{ LIGNE_PREP : "dock puis magasin"

```

### Modèle de données — mailing et configuration

```mermaid
erDiagram
    MAIL_CAMPAIGN ||--o{ MAIL_EVENT : "ouvertures et clics"
    MAIL_CAMPAIGN }o--|| MAIL_SEGMENT : "cible"
    MAIL_TEMPLATE ||--o{ MAIL_CAMPAIGN : "modele"
    MAIL_AUTOMATION ||--o{ MAIL_AUTOMATION_ENROLLMENT : "inscrits"

    MENU_LAYOUT ||--o{ MENU_HINT : "infobulles"
    SMTP_CONFIG ||--o{ ENTREPRISE : "surcharge par perimetre"
```

### Les champs qui portent les décisions

Le détail des pivots : ce sont ces champs-là qui décident du comportement.

```mermaid
erDiagram
    ENTREPRISE {
        string nomDossierDBF "cle de scoping DBF"
        string trigramme "QC, KQ, MQ, DQ, HD, SIT"
        string cheminBase "surcharge par DBF_BASE_PATH"
        string cheminExportInventaire "collect_sec"
        string cheminRapportReception
        string cheminPhotos
        bool miroirFtpInventaire "defaut true"
        string modeDepotDat "rcommun ou ftp"
        array vendeurs "code REPRES + type"
        object mappingEtatsProforma
        object mappingEtatsReservation
        object mappingEntrepots "S2..S5"
    }

    PERMISSION {
        object modules "cle vers read write delete"
        array entreprises
        bool allEntreprises "super-admin"
        object champsDbf "par table ERP"
        object commercial "actif + codes par societe"
    }

    INVENTAIRE_ZONE_SESSION {
        string slug "horodate"
        string destination "rcommun ou collect_sec"
        string dossierDat "INDICATIF — jamais pour ecrire"
        string dossierFtp "miroir de reference"
        string statut
    }

    INVENTAIRE_COLLECTE {
        string zoneCode
        string emplacement "MAGASIN ou DOCK"
        bool estComplement "re-bipage = collecte de PLUS"
        string statut "en_cours deposee annulee"
        array lignes "codeScanne + quantite"
        string offlineId "idempotence du depot hors ligne"
    }

    DEMANDE_REAPPRO {
        string source "manuel proforma rapport"
        string sourceRef "NUMFACT — index unique partiel"
        string statut "en_attente en_cours realisee"
        object operateur "VERROU user"
        string nommageTransfert "gisement proforma libre"
    }
```

---

## 8. Tâches de fond et chaîne d'impression

```mermaid
flowchart TB
    subgraph srv["server.js — demarrage"]
        LOAD["backend/loadEnv.js<br/>DOIT RESTER LE PREMIER IMPORT :<br/>des services lisent process.env au chargement du module"]
    end

    subgraph sched["Taches de fond demarrees"]
        W["startInventaireWatcher<br/>surveille le partage .dat, genere le PDF de fiche<br/>et l'imprime via SumatraPDF / pdf-to-printer<br/>NE DEMARRE PAS si RCOMMON_STOCK_ROOT est defini<br/>surcharge par RUN_FICHE_WATCHER"]
        MS["startMailingScheduler — envoi par lots, 25/h"]
        AIS["startAiSnapshotScheduler — snapshots de ventes"]
        MET["startMeteoScheduler — contexte de l'ecran Frequentation"]
        CIW["startCommercialIndexWarmer — toutes les 8 min,<br/>societes a commercial actif seulement<br/>188 s mesurees en prod si un utilisateur paie le scan"]
        RPS["startReapproProformaScheduler — import horaire<br/>des proformas dont TEXTE commence par reappro"]
        VS["startVeilleScheduler — rapports hebdomadaires"]
        RSS["startReapproSnapshotScheduler — photo quotidienne du rayon vide"]
    end

    ORPH["startReportScheduler — services/reportScheduler.js<br/>EXISTE MAIS N'EST APPELE NULLE PART<br/>les abonnements aux rapports ne partent donc jamais seuls,<br/>alors que l'ecran laisse penser le contraire"]

    LOAD --> sched
    sched -.-> ORPH

    style ORPH fill:#ffd9d9,stroke:#cc3333
    style LOAD fill:#fff2cc,stroke:#cc9933
```

### Impression des fiches de contrôle — qui fait quoi

```mermaid
flowchart LR
    VPS["VPS Ubuntu — backend de prod<br/>NE PEUT PAS IMPRIMER"]
    POSTE["Poste 192.168.0.250<br/>npm run print-agent — backend/printAgent.js<br/>a le Rcommun ET l'imprimante<br/>connecte au MEME MongoDB Atlas"]
    SHARE[("Partages : STOCK, collect_sec")]
    MONGO[("Mongo : FicheControle, LigneBipage")]
    IMP["Imprimante"]
    WEB["Ecran web Fiches de controle"]

    POSTE -->|"tickOnce : boucle sur les sessions actives,<br/>charge l'entreprise PUIS recalcule la racine"| SHARE
    SHARE -->|".dat detecte"| POSTE
    POSTE --> MONGO
    POSTE --> IMP
    VPS --> MONGO
    WEB -->|"apercu + telechargement<br/>GET /api/fiches-controle/:entrepriseId/:id/pdf"| VPS
    VPS -->|"assurerPdfFiche : regenere a la volee<br/>d'abord depuis le .DAT, sinon depuis les LigneBipage"| WEB

    NOTE["Depuis le web on NE REIMPRIME PLUS a distance.<br/>Le drapeau FicheControle.reprintRequested reste traite<br/>par l'agent local, mais plus aucun ecran ne le pose."]
    WEB -.-> NOTE
```

### Destination du dossier d'inventaire — on stocke le MODE, jamais un chemin

```mermaid
flowchart TB
    CHOIX["A l'initialisation — InventaireZoneSession.destination<br/>rcommun par DEFAUT : partage STOCK, config.sharePath / STOCK_SHARE_PATH<br/>collect_sec : le cheminExportInventaire de la societe"]
    POURQUOI["Le MEME Mongo sert au poste de dev — Windows UNC —<br/>et au VPS — Linux, montages.<br/>Un chemin absolu stocke serait faux de l'autre cote."]
    CALC["racineInventaire(destination, entreprise)<br/>puis getInventaireDirs(slug, racine)<br/>recalcule A CHAQUE USAGE"]
    SIX["SIX endroits recalculent cette racine et doivent rester alignes :<br/>init, depot mobile resoudreDossierDepot, watcher tickOnce,<br/>Annuler, ZIP local, Recommencer la zone"]
    RECH["Les fonctions de RECHERCHE d'un fichier existant<br/>resoudreCheminPdf, resoudreCheminDat<br/>balaient AU CONTRAIRE toutes les racines — racinesInventaire<br/>les inventaires anterieurs a ce choix restent trouvables"]
    FTP["Le FTP n'est PAS une destination : le watcher lit un systeme<br/>de fichiers. Un inventaire vivant seulement sur le FTPS ne produirait<br/>ni FicheControle, ni LigneBipage, ni impression, ni recap, ni ecarts."]
    DOSS["session.dossierDat reste INDICATIF — affichage et trace.<br/>Ne jamais s'en servir pour ecrire ou scanner."]

    CHOIX --> POURQUOI --> CALC --> SIX
    CALC --> RECH
    CHOIX --> FTP
    CALC --> DOSS

    style FTP fill:#ffd9d9,stroke:#cc3333
    style DOSS fill:#fff2cc,stroke:#cc9933
```

---

## 9. Flux inventaire par zones — de bout en bout

Le flux qui traverse web, mobile, partage fichier et imprimante.

```mermaid
sequenceDiagram
    autonumber
    participant W as Web /admin/inventaire-progression
    participant API as Backend
    participant MG as MongoDB
    participant APP as Collecteur
    participant FS as Partage .dat
    participant FTP as FTPS robot-documents
    participant AG as print-agent 192.168.0.250
    participant PR as Imprimante

    W->>API: Initialiser un inventaire — destination rcommun ou collect_sec
    API->>MG: InventaireZoneSession — slug horodate + destination
    W->>API: Generer les fiches de rayons depuis le dictionnaire
    API-->>W: PDF — QR du rayon + EAN-13 mintes

    APP->>API: POST /inventaires-collecte/resoudre-zone — QR du rayon
    alt zone deja bipee
        API-->>APP: dejaBipee — avertissement continuer ?
        APP->>API: POST /inventaires-collecte — estComplement true
        Note over APP,API: la collecte deposee n'est JAMAIS reouverte :<br/>la reprise cree une collecte de PLUS,<br/>pour que le suivi credite chaque agent de SON travail
    else zone neuve
        APP->>API: POST /inventaires-collecte
    end

    loop pour chaque article bipe
        APP->>API: POST /inventaires-collecte/:id/scan — code bipe
        API-->>APP: article resolu — findByCode, zeros de tete toleres
        APP->>API: POST /:id/lignes — codeScanne + quantite, decimales admises
    end

    APP->>API: POST /:id/export — depot de la zone
```

### Du dépôt à la fiche imprimée

```mermaid
sequenceDiagram
    autonumber
    participant APP as Collecteur
    participant API as Backend
    participant MG as MongoDB
    participant FS as Partage .dat
    participant FTP as FTPS robot-documents
    participant AG as print-agent 192.168.0.250
    participant PR as Imprimante
    participant W as Web

    APP->>API: POST /:id/export — depot de la zone
    API->>MG: inventaireCumulService : fusionne TOUTES les collectes<br/>deposees de la zone — code + emplacement, session courante<br/>quantites ADDITIONNEES, collectes annulee exclues
    API->>FS: ecrit stock.dat [nom de zone] — le CUMUL, ecrase le precedent
    API->>FTP: miroir best-effort — inventaire/[TRIG]/[slug]/
    Note over API,FTP: best-effort : n'arrete JAMAIS le terrain.<br/>Activable par societe — Entreprise.miroirFtpInventaire, defaut true

    AG->>FS: tickOnce detecte le .dat
    AG->>MG: FicheControle + LigneBipage — agent PAR LIGNE
    AG->>PR: PDF A4 de la fiche de controle
    AG->>FTP: .dat final + PDF

    W->>API: Recap de zone, feuille d'ecarts, suivi bipage
    API->>MG: lecture
    API-->>W: restitution
    W->>API: Enregistrer en local — GET /:id/dossier-zip
    API->>FTP: lecture — meme miroir coupe
    API->>FS: lecture
    API-->>W: ZIP streame — archiver v8
```

**Re-bipage d'une zone** : un second agent rebipe le QR, l'app avertit, et ses
bipages **s'ajoutent**. « Recommencer la zone » est au contraire une **table rase** :
les collectes passent en `annulee`, exclues du cumul, du récap et des écarts — sans
ce drapeau le bipage suivant ferait ressusciter les lignes jetées. Le verrou du
**coupon** bipage (re-bipage refusé si la fiche est imprimée) est un autre sujet.

---

## 10. Espace commercial — découpage imposé par la perf

Le dashboard est **découpé en trois requêtes** parce que les caches DBF n'ont pas
du tout le même coût à froid sur QC. **Ne pas refusionner ces endpoints.**

```mermaid
flowchart TB
    FRONT["Ecran /commercial — dashboard"]

    R1["1. GET /dashboard — portefeuille + documents<br/>caches clients et proformas + index reservations<br/>clients ~3 s, proformas ~35 s a froid"]
    R2["2. GET /dashboard/ca — CA, top 3 clients, clients a recontacter<br/>cache factures : ~140 s pour 1,7 M factures + 6,2 M lignes<br/>et ce cache s'invalide a CHAQUE facturation"]
    R3["3. GET /:dossier/alertes — croisement reservations x entrees<br/>resaEntreesService, scan streaming"]

    FRONT -->|"affiche IMMEDIATEMENT"| R1
    FRONT -.->|"remplit EN DIFFERE"| R2
    FRONT -.->|"remplit EN DIFFERE"| R3

    subgraph idx["Index PROPRES au module — commercialService.js"]
        I1["getIndexFactures — UNE SEULE passe streaming sur facture.dbf<br/>vers un index COLONNAIRE en TypedArrays<br/>sert d'un coup : reservations TYPFACT R, liste des factures,<br/>CA et marge N vs N-1, date de dernier achat par client"]
        I2["getIndexProformas — entetes de proforma.dbf seuls<br/>80 k lignes, ~1,5 s"]
        I3["Invalides par TTL SEUL — 10 min — volontairement PAS sur le mtime :<br/>facture.dbf change a chaque facture emise, une invalidation<br/>sur fichier ferait repayer le scan a presque chaque requete"]
        I1 --> I3
        I2 --> I3
    end

    NOUSE["L'espace commercial n'utilise NI factureCacheService<br/>NI commerciauxService : tous deux chargent detail.dbf,<br/>6,2 M lignes, dont il n'a aucun besoin —<br/>CA et marge se calculent sur MONTANT / FACTREV des entetes"]

    MESURE["Apres refonte, index chaud : dashboard 1,6 s,<br/>factures 56 ms, CA 31 ms — contre 137 s<br/>pour le seul dashboard a l'origine"]

    R1 --> idx
    R2 --> idx
    idx --> NOUSE
    idx --> MESURE

    style I3 fill:#fff2cc,stroke:#cc9933
```

### Deux sources distinctes, ne pas les confondre

```mermaid
flowchart LR
    RES["RESERVATIONS et COMMANDES SPECIALES<br/>facture.dbf TYPFACT = R<br/>ETAT 1 = Reservation Stock<br/>ETAT 2 = Commande Speciale<br/>entreprise.mappingEtatsReservation<br/>Meme source que Entrees sur reservation et que les alertes"]
    PRO["PROFORMAS — proforma.dbf<br/>etats reels chez QC : 1 — 685 doc./12 mois pour un seul commercial,<br/>2 = Commande a preparer, 3 et 4 = devis<br/>ETAT 0 N'EXISTE PAS : l'ancienne convention<br/>0 = commande speciale est FAUSSE"]
    PIEGE["Le mappingEtatsProforma de QC libelle l'ETAT 1 Reservation,<br/>ALORS QUE CE N'EN EST PAS UNE.<br/>On affiche donc le libelle de CATEGORIE — ex. Proforma en attente —<br/>et non le libelle ERP, garde en etatLabelErp pour l'infobulle.<br/>Sans ca, 685 lignes Reservation cotoyaient les 33 vraies."]
    FEN["L'ERP ne purge JAMAIS ces tables : tous les compteurs<br/>en cours et a relancer sont bornes par une FENETRE GLISSANTE<br/>de 12 mois — FENETRE_MOIS_DEFAUT, fenetreMois=0 pour tout l'historique.<br/>Sans elle on remonte a 2019 : 4686 reservations en cours au lieu de 33."]

    RES --> PIEGE
    PRO --> PIEGE
    PIEGE --> FEN

    style PIEGE fill:#ffd9d9,stroke:#cc3333
```

L'écran **Réservations / Commandes spéciales** suit le même découpage :
la liste (entêtes, rapide), puis `/reservations/disponibilites` (croisement
`detail.dbf` × `entrees.dbf`, **142 s à froid en local**), puis le détail ligne à
ligne à l'ouverture. Une ligne est « arrivée » quand l'article a une entrée
**postérieure ou égale** à la date de la réservation ; au-delà de la profondeur du
scan (`FENETRE_DISPO_MOIS` = 24 mois) le statut est `inconnu`, pas « en attente ».

---

## 11. API partenaire — `/api/public/v1`

Accès externe **en lecture seule** pour un intégrateur (site marchand SITEC).
Contrat destiné au prestataire : **`docs/API_PARTENAIRE.md`** — à mettre à jour
**en même temps que le code**.

```mermaid
flowchart LR
    EXT["Integrateur SITEC"]

    subgraph chain["Chaine PROPRE a ce routeur — pas protect, pas checkEntrepriseAccess"]
        K["apiKeyAuth — en-tete X-API-Key"]
        L["limiterDebit"]
        SC["requireScope — articles:read, clients:read"]
        CH["chargerEntrepriseApi"]
        K --> L --> SC --> CH
    end

    subgraph routes["Routes"]
        RA["GET /articles — REPLIE PAR PRODUIT<br/>une ligne par produit, _variantesNarts donne les declinaisons<br/>?grouper=0 pour la liste brute<br/>cout du repli ~120 ms a chaud sur 100 k articles, 9 ms sans"]
        RB["GET /articles/:nart et /articles/gencod/:gencod<br/>la reference AVEC ses declinaisons dans _variantes"]
        RC["GET /articles/export — TOUJOURS BRUT<br/>c'est un export de synchronisation, pas un catalogue"]
        RD["GET /:societe/attributs — le dictionnaire REEL d'artplus"]
        RE2["GET /clients"]
    end

    subgraph art["artplus.dbf — complements article, services/artplusService.js"]
        AP["Table cle/valeur { NART, INTITULE, CONTENU }<br/>FACULTATIVE et SANS SCHEMA IMPOSE :<br/>qc 18 intitules dont 02_nom_produit, 06_groupe<br/>sitec 5 dont 01_DESIGN"]
        AP2["Le service ne code AUCUNE liste en dur :<br/>il detecte un ROLE par convention de nommage"]
        AP3["Regroupement en PRODUITS A VARIANTES<br/>une serrure en 5 couleurs = 1 produit, 5 NART<br/>cle = l'identifiant produit quand la societe en tient un<br/>— 01_n_produit chez qc, unicite VERIFIEE au chargement —<br/>sinon slug du nom tronque a 80 car. + empreinte"]
        AP4["Chargement : qc 637 k lignes en ~2,8 s, sitec ~0,3 s<br/>cache TTL 10 min + invalidation mtime/taille"]
        AP --> AP2 --> AP3 --> AP4
    end

    CORS["CORS ouvert origin * MAIS SANS cookies :<br/>l'authentification passe uniquement par X-API-Key,<br/>donc pas de requete authentifiee a l'insu d'un navigateur tiers"]
    CLES["Cles gerees EN CLI SEULEMENT :<br/>npm run apikey:list / create / revoke / activate<br/>jamais par une page d'admin"]
    INTER["AUCUNE route d'ecriture ne doit etre ajoutee ici<br/>sans decision explicite"]
    ENC["L'API restitue l'encodage DOS TEL QUEL"]

    EXT --> chain --> routes
    routes --> art
    chain --> CORS
    chain --> CLES
    routes --> INTER
    routes --> ENC

    style INTER fill:#ffd9d9,stroke:#cc3333
```

---

## 12. Temps réel — Socket.IO

```mermaid
flowchart TB
    SRV["server.js cree un serveur HTTP + Socket.IO<br/>sur la MEME ORIGINE que le REST<br/>io expose aux controleurs par req.app.get('io')"]

    AUTH["backend/socket/chatSocket.js authentifie chaque socket<br/>par le cookie JWT — web<br/>OU par un token dans le handshake — app mobile"]

    subgraph rooms["Salons"]
        G["global"]
        T["team:&lt;id&gt;"]
        TK["task:&lt;id&gt;"]
        U["user:&lt;id&gt; — salon PERSONNEL, JAMAIS quitte<br/>porte les notifications ciblees : message non lu,<br/>nouvelle tache — alimente les badges de la sidebar"]
    end

    PRES["Presence en ligne / actif / absent / occupe<br/>tenue EN MEMOIRE — seul lastSeenAt est persiste"]
    NL["Non-lus : User.chatSeenAt et User.tasksSeenAt<br/>+ /api/notifications"]
    CONV["Discussions de l'espace equipe : ConversationModel<br/>pieces jointes en GridFS"]
    MEMB["Discussions : MEMBRES SEULEMENT<br/>plus AUCUN bypass admin — decision client du 26/10/2026"]

    RESTART["REDEMARRER LE BACKEND apres toute modification du socket"]

    SRV --> AUTH --> rooms
    rooms --> PRES
    rooms --> NL
    rooms --> CONV --> MEMB
    SRV --> RESTART

    style RESTART fill:#ffd9d9,stroke:#cc3333
```

---

## 13. Bascule dev/prod et variables d'environnement

Les chemins des sociétés sont stockés en **UNC Windows** (`\\serveur\Bases\…`) pour
le développement local. En production (Ubuntu) des variables d'environnement les
remplacent ou les traduisent **sans aucune migration en base**.

```mermaid
flowchart LR
    subgraph dev["DEV — poste Windows"]
        D1["Entreprise.cheminBase en UNC Windows<br/>chemin du type serveur / Bases / ... stocke EN BASE"]
        D2["PORT=5000 OBLIGATOIRE :<br/>server.js fait PORT || 8000<br/>mais le proxy CRA vise 5000"]
    end

    subgraph prod["PROD — VPS Ubuntu"]
        P1["DBF_BASE_PATH remplace Entreprise.cheminBase<br/>— getter du modele"]
        P2["RCOMMON_STOCK_ROOT traduit les chemins d'export<br/>en CONSERVANT LE DERNIER SEGMENT, propre a chaque societe :<br/>collect_sec, collect_sec_aw, collecteur"]
        P3["STOCK_SHARE_PATH pour les partages .dat<br/>et les fiches de controle"]
        P4["FRONTEND_BUILD_PATH — build servi par Express"]
    end

    REGLE["Regles exactes : en-tete de backend/models/EntrepriseModel.js"]
    INCOMP["exemple.env est INCOMPLET :<br/>il documente 15 variables, le backend en lit 33.<br/>CLIENT_URL y apparait mais n'est lu NULLE PART —<br/>c'est FRONTEND_URL qui pilote CORS."]

    dev --> REGLE
    prod --> REGLE
    REGLE --> INCOMP

    style INCOMP fill:#ffd9d9,stroke:#cc3333
    style D2 fill:#fff2cc,stroke:#cc9933
```

### Les 33 variables, par usage

| Domaine | Variables |
|---|---|
| Base | `NODE_ENV`, `PORT`, `MONGO_URI` (alias `MONGODB_URI`), `JWT_SECRET` |
| Front / CORS | `FRONTEND_URL`, `FRONTEND_BUILD_PATH` |
| Chemins DBF & partages | `DBF_BASE_PATH`, `RCOMMON_STOCK_ROOT`, `RCOMMON_COLLECT_PATH`, `STOCK_SHARE_PATH`, `PHOTOS_BASE_PATH`, `REAPRO_MAG_DIR`, `ANALYSE_CA_DICTIONNAIRE_PATH` |
| Impression fiches | `RUN_FICHE_WATCHER`, `PRINTER_NAME`, `FICHE_AUTOPRINT`, `FICHE_WATCH_INTERVAL_MS`, `DAT_FILENAME_PREFIX`, `DAT_FILENAME_REGEX` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `MAIL_TRACK_SECRET` |
| Envoi Cde Fournisseur | `ENVOI_CDE_TEST_EMAILS` (le mode test se pilote **par société dans l'UI**) |
| IA | `OPENAI_API_KEY`, `OPENAI_MODEL`, `TAVILY_API_KEY`, `OPENAI_VEILLE_MODEL`, `OPENAI_VEILLE_MODEL_PRO` |
| Frontend (CRA) | `REACT_APP_MAPBOX_TOKEN`, `REACT_APP_API_TARGET` |

### Commandes

```mermaid
flowchart LR
    DEV["npm run dev — backend nodemon + frontend CRA, concurrently"]
    SRV2["npm run server — backend seul"]
    CLI["npm run client — front seul, port 3000, proxy /api vers 5000"]
    START["npm start — prod, node backend/server.js"]
    AGENT2["npm run print-agent — agent d'impression local"]
    SEED["data:import / data:destroy — users, permissions, entreprises<br/>data:import:envoi-cde — module Envoi Cde<br/>masterconfig:import — configs master report"]
    APIK["apikey:list / create / revoke / activate — CLI UNIQUEMENT"]
    MIG["pachat:historiser — historisation des prix d'achat<br/>migrate:groupes-prioritaires — migration ponctuelle"]
    BUILD["cd frontend puis npm run build<br/>VIDER NODE_OPTIONS et CI avant, sinon dns-fix.js echoue"]
    TEST["npm test existe mais NE TROUVE AUCUN TEST<br/>ne pas s'en servir comme preuve"]

    DEV --- SRV2 --- CLI --- START --- AGENT2
    SEED --- APIK --- MIG --- BUILD --- TEST

    style TEST fill:#ffd9d9,stroke:#cc3333
    style BUILD fill:#fff2cc,stroke:#cc9933
```

---

## 14. Pièges connus et dette identifiée

Détail et priorisation dans **`docs/AUDIT_APPLICATION.md`**.

```mermaid
flowchart TB
    subgraph derive["Derives structurelles"]
        A1["Registres de permission DESYNCHRONISES<br/>3 sources, 6 cles divergentes — audit 3.1"]
        A2["backend/routes/InventaireRoutes.js ne contient PLUS<br/>les routes d'inventaire : depuis le commit 7c5bf4f<br/>c'est un CLONE des routes de zones.<br/>/api/inventaires et /api/inventaires-zones servent les memes<br/>routes avec DEUX politiques d'acces differentes, et<br/>inventaireController.js — 1052 lignes — est ORPHELIN. Audit 3.2"]
        A3["DEUX routeurs montes sur /api/filiales :<br/>fillialeRoutes = comparatif par article,<br/>filialesRoutes = analyse reseau DQ/QC/LD.<br/>Ca ne marche que parce que leurs formes d'URL<br/>ne se recouvrent pas. Audit 3.3"]
        A4["startReportScheduler jamais appele :<br/>les abonnements aux rapports ne partent jamais seuls"]
    end

    subgraph mort["Code mort — audit 3.4"]
        B1["AdminProformaScreen.jsx"]
        B2["AdminDoublonsGencodeScreen.jsx"]
        B3["frontend/src/utils/api.js — utilise NEXT_PUBLIC_*,<br/>jamais expose par CRA"]
        B4["/api/dashboard/* sans consommateur web"]
    end

    subgraph filet["Absence de filet"]
        C1["AUCUN TEST. Les fonctions pures a fort enjeu n'ont aucun filet :<br/>calcul TGC, format .dat, assertGrantWithinScope,<br/>perimetre commercial"]
        C2["PAS de limitation de debit sur /api/users/login :<br/>limiterDebit n'existe que pour l'API partenaire"]
        C3["exemple.env ne suffit pas a monter une instance — audit 3.5"]
    end

    subgraph gardefous["Garde-fous d'envoi — a ne jamais relacher"]
        D1["Les tests de mailing ne doivent atteindre QUE<br/>communication@ / support@quincaillerie.nc<br/>et krysto.contact@gmail.com — JAMAIS la base clients"]
        D2["Le module Envoi Cde Fournisseur est en MODE TEST PAR DEFAUT,<br/>pilote par societe dans l'UI"]
    end

    subgraph etats["Etats des documents"]
        E1["Les pastilles proforma / facture / commande / reservation<br/>viennent des mappingEtats* de la fiche societe —<br/>JAMAIS de libelles en dur.<br/>mappingEtatsFacture est vide partout."]
    end

    style C1 fill:#ffd9d9,stroke:#cc3333
    style D1 fill:#ffd9d9,stroke:#cc3333
    style A2 fill:#fff2cc,stroke:#cc9933
```

### Deux modules jumeaux, deux règles métier OPPOSÉES

```mermaid
flowchart LR
    subgraph rec["reception_manuelle"]
        R1["Source : cmdref / cmdetail, ETAT >= 4"]
        R2["Entete : fournisseur, bateau, arrivee"]
        R3["Quantites JAMAIS imprimees — comptage A L'AVEUGLE"]
        R4["Cases vides : Qte recue / Ecart / Observation"]
        R5["Suivi : FicheReceptionModel"]
    end

    subgraph prep["prep_commande_manuelle"]
        P1["Source : proforma / prodet, ETAT = 2"]
        P2["Entete : CLIENT et VENDEUR — REPRES"]
        P3["Quantites IMPRIMEES — c'est l'instruction"]
        P4["Case vide : CTRL — qte reellement prise si ecart"]
        P5["Suivi : FichePreparationModel"]
    end

    COMMUN["Meme forme : liste DBF puis apercu puis PDF A4 paysage<br/>puis suivi leger des impressions en Mongo.<br/>AUCUNE ecriture DBF."]

    rec --- COMMUN --- prep
```

**Parcours de la fiche de préparation** : le PDF est découpé en **1 · DOCK** puis
**2 · MAGASIN**, et l'on commence *toujours* par le dock —
`qteDock = min(qté demandée, S2)`, le reste part au magasin (S1). Un article peut
donc apparaître **deux fois**. La répartition n'est **pas redéveloppée** :
`preparationManuelleService` appelle `analyserProforma()` de
`services/preparationService.js`, celui de la préparation scannée.

Colonnes, dans l'ordre : case à cocher, `NL`, `CODE`, `DÉSIGNATION`, `GENCODE`,
`FOURNISSEUR`, `RÉF.`, `GISEMENT`, `RAYON`, puis le trio `QTÉ CDE` / `À PRENDRE` /
`CTRL`. **Ce trio ne change jamais d'ordre** — retirer `QTÉ CDE` rend la fiche
illisible dès qu'un article est à cheval. La colonne de repères et la colonne
`DISPO` ont été **retirées le 10/09/2026** à la demande du client : ne pas les
réintroduire sans décision explicite.

---

## Conventions de code — rappel

```mermaid
flowchart TB
    subgraph back["Backend — routes puis controleurs puis services"]
        BR["routes/*Routes.js cablent les chaines de middleware<br/>presque toujours protect en premier.<br/>Plusieurs routeurs definissent des tableaux de gardes reutilisables :<br/>const read = [protect, checkEntrepriseAccess, checkModuleAccess(MODULE, 'read')]"]
        BC["controllers/*Controller.js sont MINCES, enveloppes dans asyncHandler.<br/>Contrat non tenu sur les plus gros modules — reception 3226 lignes.<br/>NE PAS AGGRAVER."]
        BS["services/* portent la vraie logique : cache DBF,<br/>generation Excel/PDF — exceljs, pdfkit —,<br/>envoi de rapports, construction de chemins utils/*Paths.js"]
        BE["ESM — type module : import/export,<br/>__dirname derive de path.resolve()"]
        BR --> BC --> BS --> BE
    end

    subgraph front["Frontend — React 19 CRA + Redux Toolkit + RTK Query"]
        FS["Un seul store ; tout le HTTP passe par apiSlice.js"]
        FC["Les variables --admin-*, color-scheme dark et option{}<br/>sont definies GLOBALEMENT dans index.css<br/>Collision de la classe globale .info-card — fond blanc — a scoper"]
        FL["Le code, les commentaires et l'UI sont en FRANCAIS : s'y tenir.<br/>Les commentaires existants portent souvent le POURQUOI<br/>— arbitrage client, mesure de perf, piege :<br/>les lire avant de modifier, les mettre a jour avec le code."]
        FS --> FC --> FL
    end

    style FL fill:#d9f2d9,stroke:#339933
```
