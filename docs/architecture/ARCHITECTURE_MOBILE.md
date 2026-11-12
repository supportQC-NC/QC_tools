# Architecture — Application MOBILE (COLLECTEUR)

> Diagrammes de l'app collecteur **QcApp** (`test-app-qc/QcApp`) — Expo SDK 54,
> React Native 0.81, React 19. Établi le 12/11/2026 par lecture du dépôt.
> Document frère : **[ARCHITECTURE_WEB.md](./ARCHITECTURE_WEB.md)**.
>
> ⚠️ **Dépôt git SÉPARÉ**, exclu du dépôt web par `.gitignore`. Lancer toutes
> les commandes depuis `test-app-qc/QcApp`.

## Ordres de grandeur (mesurés)

| Fichier | Lignes | Rôle |
|---|---|---|
| `ReceptionScreen.js` | 3 572 | contrôle de réception — le plus gros écran |
| `PreparationScreen.js` | 1 233 | préparation de commande, dock puis magasin |
| `api.js` | 1 170 | **toute** la couche réseau |
| `DemandeReapproScreen.js` | 1 038 | listes de réappro poussées du web |
| `InventaireScreen.js` | 988 | collecte d'inventaire par zone |
| `ReapproRayonScreen.js` | 906 | réappro rayon, sans état |
| `ui.js` | 720 | composants partagés |
| `InventaireOfflineScreen.js` | 721 | inventaire hors ligne |
| `ControleScreen.js` | 643 | contrôle de commande |
| `App.js` | 577 | **le shell** — auth, société, menus |
| **Total** | **~16 800** | 13 écrans de scan, 0 test |

### Sommaire

1. [Vue d'ensemble](#1-vue-densemble--ou-vit-lapp)
2. [Le shell App.js](#2-le-shell--appjs)
3. [Carte des menus et des outils](#3-carte-des-menus-et-des-outils)
4. [Modules partagés](#4-modules-partagés--ne-pas-dupliquer-leurs-préoccupations)
5. [La chaîne de scan douchette](#5-la-chaîne-de-scan-douchette--13-écrans-une-seule-règle)
6. [Inventaire en ligne](#6-inventaire-par-zone--en-ligne)
7. [Inventaire hors ligne](#7-inventaire-hors-ligne)
8. [Réappro — quatre outils](#8-réappro--quatre-outils-distincts)
9. [Préparation de commande](#9-préparation-de-commande--dock-puis-magasin)
10. [Réception](#10-réception--le-plus-gros-écran)
11. [Chat et notifications](#11-chat-notifications-et-présence)
12. [Mapping endpoints ↔ backend](#12-mapping-endpoints-mobiles--routeurs-backend)
13. [Build et distribution](#13-build-et-distribution)
14. [Pièges connus](#14-pièges-connus)

---

## 1. Vue d'ensemble — où vit l'app

```mermaid
flowchart TB
    subgraph device["Terminal collecteur — Android, dark mode only"]
        APP["QcApp — Expo managed workflow<br/>bottom-tabs @react-navigation"]
        SQL[("SQLite locale — expo-sqlite<br/>articles.db + offlineInventaire")]
        AS[("AsyncStorage<br/>collecteur.serverBase, id collecteur")]
        SCAN["Douchette materielle<br/>emulation clavier"]
        GPS["GPS foreground"]
    end

    subgraph back["Backend — adresse CONFIGURABLE sur l'ecran de connexion"]
        PROD["https://robot-nc.com/api — DEFAUT"]
        LAN["http://192.168.0.x:5000/api — serveur LAN de dev"]
    end

    subgraph srv["Serveur"]
        REST["Express /api"]
        IO["Socket.IO"]
        MG[("MongoDB")]
        DBF[("DBF de l'ERP — lecture seule")]
        SHARE[("Partages .dat")]
    end

    SCAN -->|"champ TextInput cache"| APP
    APP --> SQL
    APP --> AS
    GPS -->|"ping toutes les 60 s"| APP

    APP -->|"fetch, credentials include — cookie d'auth"| PROD
    APP -.->|"usesCleartextTraffic pour le LAN"| LAN
    PROD --> REST
    LAN --> REST
    APP -->|"websocket + token du handshake"| IO

    REST --> MG
    REST --> DBF
    REST --> SHARE

    ALERTE["L'app vise robot-nc.com, dont la base Mongo<br/>est DIFFERENTE de celle du poste de dev<br/>— meme JWT_SECRET.<br/>Le verifier AVANT de conclure qu'un correctif ne marche pas."]
    PROD -.-> ALERTE

    style ALERTE fill:#ffd9d9,stroke:#cc3333
    style DBF fill:#ffe0e8,stroke:#cc6677
```

> **L'app de scan réception est un client RN sur un AUTRE backend** ; le Mongo est
> un Atlas cloud partagé. À vérifier avant de conclure qu'un correctif est inopérant.

---

## 2. Le shell — `App.js`

`App.js` fait **trois** choses, et c'est le **seul** endroit à étendre pour ajouter
une fonctionnalité.

```mermaid
stateDiagram-v2
    [*] --> checking
    checking: phase = checking
    checking: loadServerBase() puis getProfile()

    checking --> out: echec
    checking --> aucune_societe: succes, 0 societe
    checking --> picker: succes, plusieurs societes
    checking --> tabs: succes, UNE seule societe (auto-selection)

    out: phase = out
    out: LoginScreen — email, mot de passe,<br/>ET adresse du serveur modifiable
    out --> checking: login reussi

    aucune_societe: Ecran d'information
    aucune_societe: aucun rattachement — rien a faire

    picker: Gate societe GLOBALE
    picker: StorePicker avant les onglets
    picker --> tabs: societe choisie

    tabs: phase = in — Tab.Navigator
    tabs: GlobalBar persistante rendue par MenuHub<br/>dropdown societe + icone deconnexion
    tabs --> picker: changement de societe
    tabs --> out: deconnexion

    note right of tabs
        Changer de societe pendant un travail ouvert
        declenche une confirmation puis abandon.
        App.js suit les travaux ouverts via reportSession.
    end note
```

### Navigation PILOTÉE PAR CONFIG

```mermaid
flowchart LR
    MENUS["const MENUS — le tableau qui declare TOUT :<br/>chaque onglet du bas et les cartes qu'il contient"]
    TAB["Tab.Navigator — un onglet par entree de MENUS"]
    HUB["MenuHub — grille de cartes de l'onglet"]
    ECR["Ecran de l'outil<br/>bascule hub vers ecran par ETAT LOCAL<br/>aucun navigateur imbrique"]

    MENUS --> TAB --> HUB -->|"tap sur une carte"| ECR
    ECR -->|"Retour, fusionne dans la GlobalBar"| HUB

    AJOUT["POUR AJOUTER UN OUTIL — rien d'autre a toucher :<br/>{ key, label, icon, hint, render: p => &lt;MonEcran {...p} /&gt; }<br/>status 'bientot' sans render = carte desactivee<br/>badge: () => Promise&lt;number&gt; = compteur sur la carte"]
    PROPS["Chaque ecran recoit { user, onLogout, entreprise,<br/>entreprises, reportSession, sessionKey }<br/>et est sinon AUTONOME — son state local + son StyleSheet"]
    SESS["Un ecran a tache reprenable appelle<br/>reportSession(sessionKey, !!openSession) dans un effet<br/>avec un cleanup false, et remet sa session a zero<br/>quand entreprise._id change"]

    MENUS --> AJOUT
    ECR --> PROPS --> SESS

    style AJOUT fill:#d9f2d9,stroke:#339933
```

> La société choisie vit dans `App.js`, **pas par écran**. Utiliser l'objet
> `entreprise` reçu (`_id`, `trigramme`, `nomComplet`, `nomDossierDBF`) plutôt que
> de le redériver de `user.permissions.entreprises`. Les écrans ne rendent plus
> leur propre sélecteur de magasin ni leur lien de déconnexion.

---

## 3. Carte des menus et des outils

```mermaid
flowchart TB
    ROOT(["Bottom tabs"])

    ROOT --> M1["SCAN — barcode-outline"]
    M1 --> M1A["Scan article — ScanScreen<br/>consulter un article<br/>lit les articles par l'API, PAS la base locale"]
    M1 --> M1B["Recherche web — RechercheWebScreen<br/>infos produit en ligne"]

    ROOT --> M2["REAPPRO — cube-outline"]
    M2 --> M2A["Reappro — ReapproScreen<br/>creer un reappro libre"]
    M2 --> M2B["Listes de reappro — DemandeReapproScreen<br/>preparer une liste au dock<br/>BADGE = nombre de listes a faire"]
    M2 --> M2C["Reappro rayon — ReapproRayonScreen<br/>biper le QR d'un rayon<br/>SANS ETAT"]
    M2 --> M2D["Ou ranger ? — RangementScreen<br/>scanner un article vers son rayon<br/>CONSULTATION PURE"]

    ROOT --> M3["BIPAGE — scan-outline"]
    M3 --> M3A["Bipage — BipageScreen<br/>bipage terminal libre"]
    M3 --> M3B["Demandes bipage — DemandeBipageScreen<br/>articles a biper, proforma ou gisement<br/>BADGE"]

    ROOT --> M4["INVENTAIRE — clipboard-outline"]
    M4 --> M4A["Inventaire — InventaireScreen<br/>collecte de zone EN LIGNE"]
    M4 --> M4B["Inventaire hors ligne — InventaireOfflineScreen<br/>biper sans reseau, deposer plus tard"]
    M4 --> M4C["Bientot — carte desactivee"]

```

### Menus Commande, Réception et Compte

```mermaid
flowchart TB
    ROOT(["Bottom tabs — suite"])

    ROOT --> M5["COMMANDE — cart-outline"]
    M5 --> M5A["Preparation — PreparationScreen<br/>dock puis magasin"]
    M5 --> M5B["Bientot"]

    ROOT --> M6["RECEPTION — file-tray-full-outline"]
    M6 --> M6A["Reception — ReceptionScreen<br/>receptionner une commande"]
    M6 --> M6B["Bientot"]

    ROOT --> M7["COMPTE — person-circle-outline"]
    M7 --> M7A["Mon profil — AccountScreen<br/>profil et mot de passe"]
    M7 --> M7B["Messagerie — ChatScreen + ChatThread<br/>discussions d'equipe — BADGE non lus"]

    ROOT -.-> M8["DONNEES — EN COMMENTAIRE dans App.js<br/>Controles reception — ReceptionSuiviScreen<br/>l'ecran existe mais l'onglet est desactive"]

    style M8 fill:#eeeeee,stroke:#999999,color:#555
```

---

## 4. Modules partagés — ne pas dupliquer leurs préoccupations

```mermaid
flowchart TB
    subgraph net["Reseau"]
        API["api.js — LA couche REST<br/>defaut https://robot-nc.com/api<br/>base RUNTIME-configurable sur l'ecran de connexion,<br/>persistee en AsyncStorage<br/>normalizeBase accepte IP nue, host ou URL complete<br/>tout passe par req / reqForm, credentials include,<br/>et jette une Error portant .status et .data"]
        SOCK["socket.js — connectSocket(token)<br/>reconnexion, emit / on / off<br/>le token vient de getSocketToken()"]
    end

    subgraph ui["Presentation"]
        TH["theme.js — SOURCE DE VERITE unique du design<br/>colors (dark), spacing, radius, font, TOUCH, hitSlop<br/>NE JAMAIS coder une couleur ou un espacement dans un ecran"]
        UIM["ui.js — composants PRESENTATIONNELS seulement, zero metier<br/>Screen, Button, Banner, StartHeader, StorePicker,<br/>GlobalBar, ScanTarget, ManualInput, NumPad,<br/>QuantityStep, StockGrid, ScannedArticleCard<br/>Reutiliser au lieu de rebatir scan / quantite / stock"]
        FMT["format.js — formateurs PURS<br/>fmtPrice (XPF), fmtStock, fmtDbfDate, parseYMD, isPromo,<br/>totaux de stock, parseQte / addQteChar / cleanQteText / fmtQte<br/>+ LONGUEUR_MINI_SCAN = 6 et DELAI_SCAN_MS = 250<br/>SEULE definition de ces deux constantes"]
    end

    subgraph loc["Donnees locales"]
        ADB["articleDB.js — catalogue article HORS LIGNE<br/>parse le article.dbf EMBARQUE — metro.config.js bundle les .dbf —<br/>vers articles.db au premier lancement<br/>reimport auto si taille / recordCount changent ou SCHEMA_VERSION bumpe<br/>search() auto-route : 8 a 13 chiffres vers gencod, sinon nart"]
        OFF["offlineInventaire.js — base d'inventaire hors ligne<br/>importerBase, infoBase, effacerBase, chercherLocal,<br/>zonesLocales, sauverZoneLocale, supprimerZoneLocale"]
    end

    GPSM["location.js — GPS foreground<br/>startTracking / stopTracking<br/>ping la position toutes les 60 s — INTERVAL_MS<br/>peut declencher une alarme de 2 min sur ordre du serveur<br/>— vibration + expo-audio<br/>exige un id collecteur materiel stocke sur le terminal"]

    ECRANS["13 ecrans — chacun autonome"]

    net --> ECRANS
    ui --> ECRANS
    loc --> ECRANS
    GPSM --> ECRANS

    PIEGE["ScanScreen lit les articles par l'API, PAS par articleDB.<br/>Verifier QUELLE SOURCE un ecran utilise<br/>avant de toucher sa logique de lookup."]
    ADB -.-> PIEGE

    style TH fill:#d9f2d9,stroke:#339933
    style PIEGE fill:#fff2cc,stroke:#cc9933
```

---

## 5. La chaîne de scan douchette — 13 écrans, une seule règle

Le point le plus piégeux de l'app. Règles figées le 10/09/2026, corrigées le
09/11/2026.

```mermaid
flowchart TD
    START(["Etape de scan — AUCUN champ visible"])
    HID["Champ TextInput CACHE<br/>showSoftInputOnFocus false, caretHidden<br/>alimente par la douchette"]
    FRAPPE["Frappes de la douchette"]

    D1{"Separateur<br/>CR, LF ou TAB ?"}
    D2{">= 13 chiffres<br/>immediatement ?"}
    D3{">= LONGUEUR_MINI_SCAN = 6 chiffres<br/>ET DELAI_SCAN_MS = 250 ms<br/>sans nouvelle frappe ?"}
    BIP(["BIP — on resout le code"])
    ATT["On continue d'accumuler"]

    ECHO["L'ecran affiche Code recu : ...<br/>sans cet echo, une douchette mal reglee<br/>donne un ecran IMMOBILE, impossible<br/>a diagnostiquer sur le terrain"]

    MAN["Saisie manuelle — s'ouvre sur un BOUTON explicite<br/>Saisir le NART / Saisir le code<br/>etat saisieOuverte / manualOpen<br/>se referme au passage a l'article suivant"]

    START --> HID --> FRAPPE --> D1
    D1 -->|oui| BIP
    D1 -->|non| D2
    D2 -->|oui| BIP
    D2 -->|non| D3
    D3 -->|oui| BIP
    D3 -->|non| ATT --> FRAPPE
    BIP --> ECHO
    START -.-> MAN

    style BIP fill:#d9f2d9,stroke:#339933
```

### Les cinq règles du champ caché

```mermaid
flowchart TB
    RA["1. Il se rend par une FONCTION — {champScanCache()} — ou en JSX direct,<br/>JAMAIS par un composant declare dans le rendu.<br/>React y voit un type neuf a chaque rendu, demonte/remonte le champ<br/>a CHAQUE FRAPPE, et son autoFocus reprend le focus au clavier :<br/>clavier qui clignote et obligation de retoucher le champ entre deux chiffres."]
    RB["2. Le champ de SAISIE MANUELLE est fait pour etre tape :<br/>ni showSoftInputOnFocus false ni caretHidden — meme symptome —,<br/>blurOnSubmit false pour enchainer, et SON PROPRE ref — manualRef.<br/>Un ref partage fait pointer les focus() sur le mauvais champ.<br/>Les deux champs ne doivent JAMAIS etre montes en meme temps."]
    RC["3. Chaque ecran de scan porte le meme couple champActif() / redonnerFocus() :<br/>c'est lui qui rend la main au bon champ apres un scan, une erreur<br/>ou un changement de mode — et Keyboard.dismiss() au retour en mode scan.<br/>NE PAS reintroduire un setTimeout(() => inputRef.current?.focus(), ...) en dur."]
    RD["4. Le bip se declenche sur la LONGUEUR du code, PAS sur un Entree :<br/>beaucoup de douchettes n'envoient aucun suffixe.<br/>Un ecran qui ne pose qu'un onSubmitEditing est un ecran ou bipper<br/>NE FAIT RIEN DU TOUT."]
    RE2["5. On bipe, on ne tape pas : a l'etape de scan, aucun champ n'est visible."]

    RA --> RB --> RC --> RD --> RE2
```

### Pourquoi un PLANCHER et non une liste blanche

```mermaid
flowchart LR
    AV["AVANT le 09/11/2026 — liste blanche de longueurs :<br/>12 ou 8 chiffres apres 160 ms"]
    TROU["TROU SILENCIEUX : une douchette reglee<br/>Transmit UPC-A Check Digit = off envoie 11 CHIFFRES.<br/>Aucune branche ne s'allumait : ecran immobile, aucun message,<br/>l'agent concluait les codes americains ne marchent pas.<br/>Meme trou sur 10, 9, 7 et 6 chiffres — longueurs qui EXISTENT<br/>dans l'ERP de QC : 598 gencods de 11 chiffres, 257 de 10,<br/>23 de 9, 28 de 7, 36 de 6."]
    AP["APRES — un PLANCHER + une TEMPORISATION<br/>couvrent toutes les longueurs.<br/>Delai passe de 160 a 250 ms : a 160 ms un collecteur charge<br/>pouvait couper un EAN-13 a 12 chiffres et sortir<br/>article inconnu sur un code VALIDE."]

    AV --> TROU --> AP

    style TROU fill:#ffd9d9,stroke:#cc3333
    style AP fill:#d9f2d9,stroke:#339933
```

**Les 13 écrans concernés** : scan, bipage, contrôle, inventaire, inventaire hors
ligne, préparation, réception, réappro, réappro rayon, rangement, recherche web,
demandes de réappro, demandes de bipage.

---

## 6. Inventaire par zone — EN LIGNE

```mermaid
sequenceDiagram
    autonumber
    participant AG as Agent
    participant APP as InventaireScreen
    participant API as Backend
    participant MG as MongoDB
    participant FS as Partage .dat
    participant AGP as print-agent + imprimante

    APP->>API: GET /inventaires-collecte/en-cours/:entrepriseId
    API-->>APP: zones deja ouvertes — reprise possible
    APP->>API: GET session active

    AG->>APP: bipe le QR du rayon
    APP->>API: POST /inventaires-collecte/resoudre-zone — entrepriseId, code
    alt zone deja bipee
        API-->>APP: dejaBipee
        APP->>AG: Zone deja bipee — continuer ?
        AG->>APP: oui
        APP->>API: POST /inventaires-collecte — estComplement
        Note over APP,API: la collecte deposee n'est JAMAIS reouverte :<br/>la reprise cree une collecte de PLUS,<br/>pour que le suivi credite chaque agent de SON travail
    else zone neuve
        APP->>API: POST /inventaires-collecte — entrepriseId, zoneCode, type
    end

    loop chaque article
        AG->>APP: bip du code-barres
        APP->>API: POST /inventaires-collecte/:id/scan — code
        API-->>APP: article resolu — findByCode, zeros de tete toleres
        AG->>APP: quantite au NumPad — decimales et virgule admises
        APP->>API: POST /:id/lignes — codeScanne + quantite
    end

    AG->>APP: Deposer la zone
    APP->>API: POST /:id/export — observation
    API->>MG: inventaireCumulService fusionne TOUTES les collectes<br/>deposees de la zone — quantites ADDITIONNEES
    API->>FS: stock.dat [nom de zone] — le CUMUL, ecrase le precedent
    FS->>AGP: le watcher detecte le .dat
    AGP->>MG: FicheControle + LigneBipage — agent PAR LIGNE
    AGP->>AGP: imprime la fiche de controle A4
```

---

## 7. Inventaire hors ligne

Ajouté le 29/10/2026. Même chaîne d'arrivée que le dépôt en ligne — cœur partagé
`effectuerDepot`.

```mermaid
sequenceDiagram
    autonumber
    participant AG as Agent
    participant APP as InventaireOfflineScreen
    participant SQL as SQLite — offlineInventaire.js
    participant API as Backend

    rect rgb(224,242,224)
    Note over AG,API: 1 — EN LIGNE : telecharger l'image du catalogue
    APP->>API: GET /inventaires-collecte/catalogue-offline/:entrepriseId
    API-->>APP: texte NART|GENCOD|GENDOUBL|DESIGN — ~6 Mo chez QC
    APP->>SQL: importerBase() — table offline_articles
    end

    rect rgb(255,242,224)
    Note over AG,SQL: 2 — SANS RESEAU : biper les zones
    loop chaque zone
        AG->>APP: bipe le QR du rayon
        loop chaque article
            AG->>APP: bip du code
            APP->>SQL: chercherLocal(code) — zeros de tete toleres
            SQL-->>APP: article
            AG->>APP: quantite
        end
        AG->>APP: deposer SUR LE COLLECTEUR
        APP->>SQL: sauverZoneLocale() — offlineId genere
    end
    end

    rect rgb(224,232,255)
    Note over APP,API: 3 — A LA RECONNEXION : renvoyer
    loop chaque zone locale
        APP->>API: POST /inventaires-collecte/depot-horsligne<br/>IDEMPOTENT PAR offlineId
        API-->>APP: ok
        APP->>SQL: supprimerZoneLocale()
    end
    APP->>AG: Effacer l'image locale du catalogue ?
    Note over APP,AG: l'app PROPOSE, jamais d'office
    end
```

---

## 8. Réappro — quatre outils distincts

```mermaid
flowchart TB
    subgraph A["1 — REAPPRO libre (ReapproScreen)"]
        A1["POST /reappros — cree un reappro"]
        A2["scan, lignes, quantites"]
        A3["POST /:id/export — .dat dans collect_sec"]
        A1 --> A2 --> A3
    end

    subgraph B["2 — LISTES DE REAPPRO (DemandeReapproScreen)"]
        B1["GET /demande-reappro/mobile — listes a faire<br/>BADGE sur la carte"]
        B2["POST /mobile/:id/ouvrir — pose un VERROU operateur.user<br/>la liste DISPARAIT de l'ecran des autres operateurs"]
        B3["POST /mobile/:id/scan — resout DANS LA LISTE<br/>NART, gencode ou REFER, puis le catalogue<br/>article du catalogue ABSENT de la liste = 409 REFUSE<br/>code totalement inconnu = 404, l'app propose une saisie NART/REFER"]
        B4["POST /mobile/:id/lignes — CHAQUE ligne validee part IMMEDIATEMENT<br/>quantitePrise, statutLigne, traiteAt"]
        B5["PATCH /mobile/:id/realiser — .dat tsf_reappro_mag_...<br/>nommage par liste : gisement, proforma ou libre"]
        B6["POST /mobile/:id/liberer — rendre la liste<br/>porteur du verrou ou admin seulement"]
        B1 --> B2 --> B3 --> B4 --> B5
        B2 -.-> B6
    end

```

### Réappro — les deux outils SANS ÉTAT

```mermaid
flowchart TB
    subgraph C["3 — REAPPRO RAYON (ReapproRayonScreen) — SANS ETAT"]
        C1["L'agent choisit D'ABORD sa zone : DOCK ou MAGASIN"]
        C2["Il bipe le QR / code-barres de l'etiquette du RAYON<br/>l'etiquette encode le code du gisement BRUT, sans emplacement<br/>l'app tolere aussi code|emplacement des fiches de zone"]
        C3["POST /mobile/rayon — body zone, defaut DOCK pour les apps deployees<br/>filtre sur GISM2 si dock, GISM1 si magasin<br/>regle RAYON VIDE : S1 = 0, reserve S2..S5 > 0,<br/>MEILLEURES VENTES d'abord"]
        C4["qteProposee = min(reserve, max(1, ceil(vteMoyMois)))<br/>+ les DEUX gisements par article<br/>cote dock on met en avant gism1 — la DESTINATION<br/>cote magasin gism2 — ou aller CHERCHER"]
        C5["Parcours deroule EN LOCAL : pour valider une reference<br/>l'agent doit LA BIPER — biper un autre article du rayon<br/>saute a sa ligne, saisie NART en secours —<br/>puis saisir la quantite reellement prise. Passer reste direct."]
        C6["POST /mobile/rayon/transfert — .dat dans collect_sec<br/>nomme COMME LE REAPPRO CLASSIQUE :<br/>stock.dat [nom du rayon]_[code rayon]<br/>AUCUNE DemandeReappro creee, rien dans les listes ni le suivi"]
        C1 --> C2 --> C3 --> C4 --> C5 --> C6
    end

    subgraph D["4 — OU RANGER ? (RangementScreen) — CONSULTATION PURE"]
        D1["Zone dock/magasin, bascule rapide en haut d'ecran"]
        D2["Scan article — gencode, NART ou reference<br/>renvois GENDOUBL suivis vers la fiche ACTIVE"]
        D3["POST /mobile/rangement — renvoie LES DEUX emplacements<br/>+ libelles du dictionnaire : gism2/rayonDock, gism1/rayonMagasin<br/>l'app met en avant celui de la zone choisie, rappelle l'autre<br/>en petit, et AVERTIT si la fiche n'a pas de gisement"]
        D1 --> D2 --> D3
    end

    NOTE["C et D ne creent AUCUN document Mongo —<br/>decision client du 23/10/2026 : une premiere version<br/>de Reappro rayon qui creait une liste a ete RETIREE."]
    C -.-> NOTE
    D -.-> NOTE

    style NOTE fill:#fff2cc,stroke:#cc9933
```

### Quantités décimales — règle transverse

```mermaid
flowchart LR
    R["Beaucoup d'articles se vendent AU METRE :<br/>tuyau, cable. prodet.QTE, article.S1 et S2 sont des N(x.3)."]
    B["Backend : plus aucun parseInt / Math.round a l'unite<br/>helper round3, 3 decimales — controleurs reappro, bipage,<br/>inventaire, controle, preparation, reception"]
    M["App : helpers parseQte / addQteChar / cleanQteText / fmtQte<br/>de format.js, touche virgule sur les NumPad<br/>vider = APPUI LONG sur la touche retour"]
    DAT["Les .dat Stock XL acceptent AUSSI decimales ET negatifs<br/>depuis le 29/10/2026 : champ QTE(8) complete de zeros a gauche,<br/>le signe moins et le point comptant dans les 8 caracteres<br/>000001.5 / 00000-52 / 0000-1.5<br/>formatage UNIQUE dans utils/qteDat.js — fmtQteDat,<br/>utilise par les 10 generateurs de .dat"]
    INT["NE PLUS JAMAIS reintroduire un Math.round a l'ecriture d'un .dat"]

    R --> B
    R --> M
    B --> DAT --> INT

    style INT fill:#ffd9d9,stroke:#cc3333
```

---

## 9. Préparation de commande — dock puis magasin

Parcours en **trois temps** par article (décision client du 09/09/2026).

```mermaid
stateDiagram-v2
    [*] --> liste
    liste: Choix de la proforma a preparer
    liste: GET /preparations/proformas-a-preparer<br/>ou /reservations-a-preparer
    liste --> dock: POST /preparations — analyserProforma()

    dock: 1 — DOCK<br/>article par article, voir le parcours en trois temps
    dock --> transition: POST /:id/terminer-dock
    transition: Ecran PLEIN de transition dock vers magasin<br/>position absolute + elevation 10
    transition --> magasin
    magasin: 2 — MAGASIN<br/>meme parcours en trois temps, sur le reliquat
    magasin --> controle: POST /:id/terminer
    controle: Controle final — GET /:id/controle-final
    controle --> colisage: POST /:id/controle-final
    colisage: Nombre de COLIS / PALETTES / LONGUEURS<br/>PreparationModel.colisage<br/>repris sur le rapport et dans l'email — c'est tout
    colisage --> [*]: POST /:id/rapport
```

### Le parcours en trois temps, pour chaque article

```mermaid
stateDiagram-v2
    [*] --> confirm
    confirm: CONFIRM — carte article COMPLETE<br/>designation, fournisseur, ref., gencodes,<br/>GISEMENT DE LA ZONE<br/>SEUL moment ou l'agent CHERCHE le produit
    confirm --> qty: gencode conforme bipe<br/>le bip est actif DES confirm
    confirm --> scan: Oui — article SANS code-barres
    scan: SCAN — la carte DISPARAIT<br/>uniquement la cible de bip, AUCUN champ visible<br/>le NART est rappele en petit<br/>la saisie NART s'ouvre a la demande, bouton manualOpen
    scan --> qty: bip conforme
    qty: QTY — la carte DISPARAIT<br/>A prendre et Prepare sur UNE ligne, deux cases cote a cote<br/>au-dessus du pave numerique, dont les touches retrecissent<br/>sous 700 dp de haut — empiles, les compteurs poussaient<br/>la derniere rangee hors de l'ecran
    qty --> confirm: POST /:id/lignes/:ligneId — article suivant
    qty --> [*]: derniere ligne de la zone
```

### Répartition dock / magasin — qui décide

```mermaid
flowchart TB
    SRV["Le SERVEUR decide tout — services/preparationService.js, analyserProforma()"]
    REP["qteDock = min(qte demandee, S2), le reste part au MAGASIN (S1)<br/>un article peut donc apparaitre DEUX FOIS,<br/>avec la quantite propre a chaque zone"]
    BORNE["Le reliquat magasin n'est PAS borne par S1 :<br/>si le stock total ne couvre pas la demande,<br/>la ligne part quand meme au magasin —<br/>l'agent la decouvre au rayon"]
    ORD["ORDRE DE PARCOURS — regle client du 09/09/2026 :<br/>la priorite du dictionnaire des rayons l'emporte quand elle est renseignee ;<br/>a defaut — cas de QC, ou aucune ne l'est — ordre NATUREL :<br/>comparerCodeGisement decoupe au premier underscore,<br/>allee en alphabetique, repere en NUMERIQUE"]
    POURQUOI["Un localeCompare brut donnait A_1, A_10, A_11, A_2d<br/>et faisait REDESCENDRE L'ALLEE a l'agent.<br/>On obtient A_1, A_2d, A_9, A_10."]
    MOB["L'app suit EXACTEMENT le meme ordre : elle trie sur les<br/>ordreDock / ordreMagasin calcules par le serveur<br/>et affiche le gisement de la zone en cours.<br/>NE JAMAIS RETRIER COTE MOBILE : les deux supports divergeraient."]
    GIS["Le libelle du rayon vient du serveur — rayon / rayonDock —<br/>resolu dans le DICTIONNAIRE DES RAYONS sur le couple<br/>code + emplacement : GISM2 au dock, GISM1 au magasin.<br/>gisementZone(l, phase) choisit le bon jeu.<br/>Ne JAMAIS afficher GISM1 pendant la phase dock."]

    SRV --> REP --> BORNE
    SRV --> ORD --> POURQUOI
    ORD --> MOB
    SRV --> GIS

    style MOB fill:#ffd9d9,stroke:#cc3333
```

> **Colisage** : les **feuilles de colisage** (une A4 par unité) et la
> **répartition article par article** ont été **retirées le 09/09/2026** à la
> demande du client. Seuls les compteurs subsistent. Le code correspondant
> (`ecrirePDFColisage`, `listerUnitesColisage`, `construireLignesColisage`) a été
> **supprimé**, pas mis en commentaire — ne pas le réintroduire sans décision.

> **Abandonner une préparation demande une confirmation** (`Alert.alert`) : le lien
> est à portée de pouce pendant toute la préparation. Il est masqué sur les écrans
> de transition, où une seule action doit être possible.

---

## 10. Réception — le plus gros écran

```mermaid
sequenceDiagram
    autonumber
    participant AG as Agent
    participant APP as ReceptionScreen — 3572 lignes
    participant API as Backend
    participant MG as MongoDB

    APP->>API: GET /receptions/commandes/:nomDossierDBF — recherche, page, limit
    API-->>APP: commandes receptionnables — cmdref ETAT >= 4
    AG->>APP: choisit un NUMCDE
    APP->>API: POST /receptions — entrepriseId, numcde
    APP->>API: GET /receptions/:id/articles

    loop comptage
        AG->>APP: bip
        APP->>API: POST /receptions/:id/scan — code
        API-->>APP: article ou inconnu
        AG->>APP: quantite comptee
        APP->>API: POST /:id/comptages
    end

```

### Réception — conflits, anomalies et clôture

```mermaid
sequenceDiagram
    autonumber
    participant AG as Agent
    participant APP as ReceptionScreen
    participant API as Backend
    participant MG as MongoDB

    loop en continu — travail A PLUSIEURS sur la meme commande
        APP->>API: GET /:id/state?revision=N — POLLING par revision
        API-->>APP: delta + conflits eventuels
        opt conflit detecte
            AG->>APP: arbitre
            APP->>API: POST /:id/conflits/:conflitId — action, valeur
        end
    end

    opt anomalie
        AG->>APP: photo + type de signalement
        APP->>API: POST /:id/signalements — MULTIPART, reqForm
        Note over APP,API: pas d'en-tete Content-Type :<br/>fetch / RN ajoute le boundary correct
    end

    AG->>APP: Terminer le scan
    APP->>API: POST /:id/terminer-scan
    APP->>API: GET /:id/analyse
    API-->>APP: ecarts calcules
    loop chaque ecart
        AG->>APP: valide la quantite retenue
        APP->>API: POST /:id/ecarts/:comptageId
    end
    AG->>APP: commentaire puis rapport
    APP->>API: POST /:id/commentaire puis POST /:id/rapport
    API->>MG: ReceptionModel + rapport dans cheminRapportReception
```

Le module web jumeau **`reception_manuelle`** produit au contraire une fiche
papier **sans quantités imprimées** — comptage à l'aveugle. Voir
[ARCHITECTURE_WEB.md §14](./ARCHITECTURE_WEB.md#deux-modules-jumeaux-deux-règles-métier-opposées).

---

## 11. Chat, notifications et présence

```mermaid
flowchart TB
    LOGIN["Connexion reussie"]
    TOK["GET /users/socket-token<br/>l'app NE PEUT PAS lire le cookie httpOnly :<br/>le token passe dans le HANDSHAKE socket"]
    CONN["connectSocket(token) — socket.js<br/>origine = socketOrigin() derivee de la base API"]

    subgraph rooms["Salons rejoints"]
        G["global"]
        T["team:&lt;id&gt;"]
        TK["task:&lt;id&gt;"]
        U["user:&lt;id&gt; — personnel, JAMAIS quitte<br/>porte les notifications ciblees"]
    end

    subgraph rest["REST du chat — api.js"]
        C1["GET /conversations, /messages/:room, /messages/:room/membres"]
        C2["POST sendMessageFiles — MULTIPART, pieces jointes GridFS"]
        C3["reactMessage, pinMessage, editMessage, deleteMessageChat"]
        C4["GET /messages/:room/reads, /media, /pinned, /search"]
        C5["GET /notifications/counts — alimente les BADGES des cartes<br/>POST /notifications/chat/seen"]
    end

    ECR["ChatScreen — liste des discussions<br/>ChatThread — un fil"]
    MEMB["Discussions : MEMBRES SEULEMENT<br/>plus AUCUN bypass admin — decision client du 26/10/2026"]

    LOGIN --> TOK --> CONN --> rooms --> ECR
    rest --> ECR
    ECR --> MEMB
```

---

## 12. Mapping endpoints mobiles ↔ routeurs backend

```mermaid
flowchart LR
    subgraph app["api.js — groupes de fonctions"]
        F1["Auth<br/>login, getProfile, logout, changePassword"]
        F2["Chat<br/>getSocketToken, conversations, messages, notifications"]
        F3["Reappro libre<br/>createReappro, scanArticle, addLigne, exportReappro"]
        F4["Bipage libre<br/>createBipage, scanArticleBipage, exportBipage"]
        F5["Inventaire collecte<br/>resoudreZoneInventaire, createCollecte, scanArticleCollecte,<br/>exportCollecte, getCatalogueOffline, depotHorsLigne"]
        F6["Articles<br/>getArticleByGencodApi, getArticleByNartApi, photoUrl"]
    end

    subgraph back1["Routeurs backend"]
        R1["/api/users"]
        R2["/api/messages /api/conversations /api/notifications"]
        R3["/api/reappros"]
        R4["/api/bipage-collecte"]
        R5["/api/inventaires-collecte"]
        R6["/api/articles /api/photos"]
    end

    F1 --> R1
    F2 --> R2
    F3 --> R3
    F4 --> R4
    F5 --> R5
    F6 --> R6
```

### Endpoints — métier et terrain

```mermaid
flowchart LR
    subgraph app2["api.js — suite"]
        F7["Reception<br/>getCommandesReception, createReception, scanReception,<br/>comptages, signalements, analyse, ecarts, rapport"]
        F8["Preparation<br/>getProformasAPreparer, createPreparation, scanControle,<br/>preparerLigne, terminerDock, controleFinal, colisage, rapport"]
        F9["Demandes reappro<br/>getDemandesReappro, ouvrir, liberer, scan, lignes, realiser"]
        F10["Reappro rayon / rangement<br/>getArticlesReapproRayon, transfertReapproRayon, getRangementArticle"]
        F11["Demandes bipage<br/>getDemandesBipage, realiserDemandeBipage"]
        F12["Collecteur<br/>getCollecteurId, pingCollecteur"]
        F13["Suivi reception<br/>getReceptionsEnCoursSuivi, getReceptionProgressSuivi"]
    end

    subgraph back["Routeurs backend"]
        R7["/api/receptions"]
        R8["/api/preparations"]
        R9["/api/demande-reappro/mobile/*"]
        R11["/api/demande-bipage/mobile/*"]
        R12["/api/collecteurs"]
        R13["/api/reception-suivi/mobile/*"]
        R14["/api/app-release — GET /current est PUBLIC :<br/>page d'installation"]
    end

    F7 --> R7
    F8 --> R8
    F9 --> R9
    F10 --> R9
    F11 --> R11
    F12 --> R12
    F13 --> R13

    style R14 fill:#e6e6ff,stroke:#6666cc
```

---

## 13. Build et distribution

```mermaid
flowchart LR
    DEV["npm start — expo start, Metro<br/>npm run android / ios / web"]

    subgraph eas["EAS — eas.json"]
        E1["development — APK dev-client"]
        E2["preview — APK interne"]
        E3["production — Android app bundle"]
    end

    VER["Bumper android.versionCode dans app.json<br/>a CHAQUE build store"]
    STORE["Play Store PRIVE — piste Tests internes"]
    NATIF["Les dossiers ios/ et android/ sont git-ignores<br/>et GENERES par EAS"]
    MOD["Ajouter un module natif avec npx expo install [pkg]<br/>— PAS npm install — pour rester compatible SDK 54"]
    DOCS["Consulter les docs VERSIONNEES du SDK installe<br/>https://docs.expo.dev/versions/v54.0.0/"]
    NOTEST["AUCUN test, linter ni type-checker configure :<br/>ne pas supposer que npm test / npm run lint existent"]

    DEV --> eas --> VER --> STORE
    eas --> NATIF
    DEV --> MOD --> DOCS
    DEV --> NOTEST

    style NOTEST fill:#ffd9d9,stroke:#cc3333
    style VER fill:#fff2cc,stroke:#cc9933
```

---

## 14. Pièges connus

```mermaid
flowchart TB
    subgraph rn["React Native / Android"]
        P1["SUPERPOSITION : zIndex seul NE SUFFIT PAS —<br/>l'ordre de rendu prime tant qu'aucune elevation n'est posee.<br/>Les ecrans PLEINS en position absolute portent elevation 10,<br/>l'overlay de chargement elevation 20.<br/>Sans ca, le lien Annuler la preparation, rendu apres,<br/>retombait pile sur le bouton Passer au magasin."]
        P2["Dark mode ONLY — userInterfaceStyle dark dans app.json<br/>Android : softwareKeyboardLayoutMode resize<br/>+ usesCleartextTraffic, pour les serveurs LAN en http://"]
        P3["Objectif ERGONOMIE : chaque etape doit tenir SANS SCROLLER<br/>sur l'ecran bas du collecteur"]
    end

    subgraph scan["Scan"]
        S1["Les 5 regles du champ cache — section 5<br/>Ne jamais declarer le champ comme composant dans le rendu"]
        S2["LONGUEUR_MINI_SCAN et DELAI_SCAN_MS vivent dans format.js :<br/>SEULE definition, ne pas remettre de nombre en dur dans un ecran"]
    end

    subgraph data["Donnees"]
        D1["ScanScreen lit l'API, PAS articleDB :<br/>verifier la source avant de changer une logique de lookup"]
        D2["Le backend vise par l'app a une base Mongo DIFFERENTE<br/>de celle du poste de dev"]
        D3["Ne JAMAIS afficher GISM1 pendant la phase dock<br/>— chez QC les deux gisements differrent presque toujours"]
        D4["Ne JAMAIS retrier les lignes cote mobile :<br/>l'ordre vient du serveur, ordreDock / ordreMagasin"]
    end

    subgraph code["Code"]
        C1["Vocabulaire metier en FRANCAIS :<br/>reappro, bipage, collecte, reception, preparation,<br/>proforma / numcde, entreprise / trigramme,<br/>nart, gencod, S1..S5"]
        C2["theme.js et ui.js sont les sources uniques :<br/>aucune couleur ni espacement en dur dans un ecran"]
        C3["Le bloc de commentaires d'App.js previent contre toute<br/>modification de la logique des ecrans quand on touche<br/>la couche menu / hub : l'extension prevue est ADDITIVE —<br/>une nouvelle carte, rien de plus"]
    end

    style P1 fill:#fff2cc,stroke:#cc9933
    style D2 fill:#ffd9d9,stroke:#cc3333
    style D4 fill:#ffd9d9,stroke:#cc3333
```
