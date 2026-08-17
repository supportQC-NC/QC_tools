# API Partenaire — Articles & Clients

Documentation d'intégration destinée à un prestataire externe.
**Version 1** — base d'URL : `https://robot-nc.com/api/public/v1`

> Tous les exemples de cette page sont des **réponses réelles**, relevées en
> production sur la société SITEC. Les volumes et temps de réponse annoncés sont
> mesurés depuis Nouméa, hors du réseau du groupe.

---

## 1. Ce que fait cette API

Elle expose, **en lecture seule**, les bases de l'ERP d'une société du groupe :

| Base | Fichier source | Contenu |
|---|---|---|
| Articles | `article.dbf` | catalogue, prix, stocks par entrepôt, promotions, classement |
| Compléments article | `artplus.dbf` | attributs libres (nom de produit, classement, couleur, dimension…) et **regroupement des références en produits à variantes** — voir §5.4 |
| Clients | `clients.dbf` | fiches clients, coordonnées, conditions commerciales |

**Tous les champs** des fichiers sources sont renvoyés, sous leur **nom d'origine
en MAJUSCULES** (`NART`, `DESIGN`, `PVTE`…). L'API ajoute quelques champs
calculés, systématiquement **préfixés par `_`** (`_stockTotal`, `_prixVenteHT`…)
pour qu'ils soient impossibles à confondre avec des champs de l'ERP.

### Ce qu'elle ne fait pas

- **Aucune écriture.** L'ERP est la source de vérité ; l'API ne crée ni ne
  modifie ni ne supprime quoi que ce soit. Il n'existe pas de route `POST`,
  `PUT` ou `DELETE`.
- **Pas de commandes, factures, proformas, fournisseurs.** Hors périmètre v1.
- **Pas de webhook / notification push.** La détection des changements se fait
  par interrogation (voir §8, *Stratégie de synchronisation*).

---

## 2. Accès

### Base d'URL

```
https://robot-nc.com/api/public/v1
```

### Authentification

Chaque appel doit porter la clé d'API dans un en-tête. Deux formes acceptées,
au choix :

```http
X-API-Key: qcapi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
```http
Authorization: Bearer qcapi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **La clé vous est transmise séparément** (elle n'est jamais écrite dans cette
> documentation ni dans un dépôt de code). Elle n'expire pas, mais elle est
> révocable à tout moment.
>
> **La clé est un secret serveur.** Elle ne doit jamais se retrouver dans du
> code exécuté par un navigateur (JavaScript front, application mobile), ni dans
> un dépôt Git. Tous les appels doivent partir de votre backend.

Pas de cookie, pas de session, pas de login/mot de passe : la clé suffit.

### Périmètre d'une clé

Une clé est verrouillée sur **deux dimensions**, vérifiées à chaque appel :

- les **sociétés** autorisées — le segment `:societe` de l'URL ;
- les **ressources** autorisées — `articles:read`, `clients:read`.

Un appel hors périmètre renvoie `403`. Pour connaître exactement le périmètre de
votre clé, appelez `GET /ping` (§5.1).

### Vérifier que tout fonctionne

```bash
curl -H "X-API-Key: VOTRE_CLE" https://robot-nc.com/api/public/v1/ping
```

---

## 3. Conventions de données

Ces règles valent pour **toutes** les réponses ; les connaître évite la plupart
des mauvaises surprises.

| Sujet | Règle |
|---|---|
| **Encodage** | UTF-8. Le `Content-Type` est `application/json; charset=utf-8`, sauf pour les exports (`application/x-ndjson`). |
| **Espaces** | Les champs texte viennent d'un format à largeur fixe : ils peuvent contenir des **espaces de remplissage**. Faites systématiquement un `trim()`. |
| **Champs vides** | Une chaîne vide `""` (et non `null`) pour un texte absent, `0` pour un numérique absent. |
| **Dates** | Renvoyées au format ISO 8601 UTC (`"2026-03-31T00:00:00.000Z"`) ou `null`. Attention : ce sont des dates *sans heure* à l'origine — n'utilisez que la partie `AAAA-MM-JJ`. Le fuseau local est `Pacific/Noumea` (UTC+11). |
| **Booléens DBF** | Le type DBF `L` est renvoyé en `true`/`false` (ex. `TARIFL`). Les autres indicateurs sont des **lettres** : `WEB` vaut `"O"` (oui) ou `""`, `FOTO` vaut `"F"` si une photo existe. |
| **Monnaie** | Franc Pacifique (XPF), **sans décimale** dans les usages courants. Les prix de vente (`PVTE`, `PVTETTC`, `PVPROMO`) sont des entiers. Les prix d'achat/revient peuvent avoir des décimales. |
| **Casse** | Les noms de champs DBF sont **toujours en MAJUSCULES**. Les champs ajoutés par l'API sont en `_camelCase` préfixé. |
| **Caractères** | Les fichiers sources sont encodés en jeu de caractères **DOS** et l'API les restitue tels quels. Deux conséquences visibles : le symbole degré peut remonter en `ø` (`N°37` → `Nø37`), et certains accents ont été perdus à la saisie dans l'ERP (`À` stocké sur deux caractères, restitué `Aÿ`). Ce n'est pas un défaut de transport : la donnée est ainsi dans la base. Prévoyez un nettoyage à l'affichage si nécessaire. |
| **Fraîcheur** | Les données sont servies depuis un cache mémoire rafraîchi automatiquement (TTL 5 minutes, et invalidation immédiate si le fichier source est réécrit). Un changement dans l'ERP est donc visible en **5 minutes au pire**. |

---

## 4. Erreurs et quotas

### Format d'erreur

Toute erreur renvoie un JSON avec une clé `message` :

```json
{ "message": "Clé d'API invalide" }
```

### Codes HTTP

| Code | Signification | Que faire |
|---|---|---|
| `200` | OK | — |
| `400` | Paramètre invalide | Corriger la requête. |
| `401` | Clé absente ou invalide | Vérifier l'en-tête `X-API-Key`. |
| `403` | Clé révoquée/expirée, société non autorisée, scope manquant, IP non autorisée | Le message précise le motif. Nous contacter. |
| `404` | Ressource inexistante (article, client) | Cas normal (article inconnu) — à traiter, pas à réessayer. |
| `429` | Quota dépassé | Attendre le délai indiqué par `Retry-After`, puis réessayer. |
| `500` | Erreur serveur (ex. fichier source momentanément indisponible) | Réessayer avec un délai croissant ; nous signaler si ça persiste. |

### Quota

Limite par défaut : **300 requêtes / minute** (fenêtre d'une minute).
Chaque réponse porte :

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 297
X-RateLimit-Reset: 1786423095      (horodatage Unix de remise à zéro)
```

En cas de dépassement : `429` + en-tête `Retry-After` (en secondes).

> Pour une synchronisation complète, **n'itérez pas sur des milliers de pages** :
> utilisez les routes `/export` (§5.5), conçues pour ça — un seul appel.

---

## 5. Référence des endpoints

Dans les URL ci-dessous, `:societe` est l'identifiant de la société.
Pour ce projet : **`sitec`** (trigramme `SIT`).

### 5.1 Méta

#### `GET /ping`

Vérifie la clé et décrit son périmètre. Aucun paramètre.

```bash
curl -H "X-API-Key: VOTRE_CLE" https://robot-nc.com/api/public/v1/ping
```

```json
{
  "ok": true,
  "horodatage": "2026-08-11T23:38:22.741Z",
  "cle": {
    "nom": "Site marchand SITEC",
    "prefixe": "qcapi_3mi6PzfT_KMv",
    "scopes": ["articles:read", "clients:read"],
    "scopesDisponibles": ["articles:read", "clients:read"],
    "limiteParMinute": 300,
    "expireLe": null
  },
  "societes": [
    { "nomDossierDBF": "sitec", "trigramme": "SIT", "nomComplet": "Sitec", "isActive": true }
  ],
  "votreIp": "203.0.113.10"
}
```

`prefixe` est la partie **non secrète** de votre clé : citez-la dans vos
demandes de support, jamais la clé complète.

#### `GET /societes`

Sociétés accessibles, avec le libellé de leurs entrepôts.

```json
{
  "total": 1,
  "societes": [{
    "nomDossierDBF": "sitec", "trigramme": "SIT", "nomComplet": "Sitec",
    "entrepots": { "S1": "Magasin", "S2": "S2", "S3": "S3", "S4": "S4", "S5": "S5" }
  }]
}
```

Ce mapping donne le **nom métier** de chaque entrepôt `S1`…`S5` : utilisez-le
plutôt que de coder « S1 = Magasin » en dur.

---

### 5.2 Articles

Scope requis : `articles:read`.

> Ces routes renvoient les **références** de l'ERP, une par ligne de catalogue.
> Pour la vue **produit** (références regroupées en déclinaisons, classement,
> attributs), voir §5.4.

#### `GET /:societe/articles` — liste paginée

**Paramètres de pagination**

| Paramètre | Défaut | Détail |
|---|---|---|
| `page` | `1` | Numéro de page (1-indexé). |
| `limit` | `100` | Taille de page, **maximum 500**. |
| `champs` | *(tous)* | Projection : liste de champs séparés par des virgules. Ex. `champs=NART,DESIGN,PVTE,_stockTotal`. Réduit fortement le volume transféré. |

**Paramètres de filtrage** (cumulables ; tous les filtres s'appliquent au
fichier entier *avant* pagination)

| Paramètre | Type | Effet |
|---|---|---|
| `search` | texte | Recherche partielle, insensible à la casse, dans `DESIGN`, `NART`, `GENCOD`, `REFER`. |
| `nart` | texte | Code article, correspondance **partielle**. |
| `groupe` | texte | Famille (`GROUPE`), correspondance **exacte**. |
| `fourn` | nombre | Code fournisseur. Partiel par défaut ; ajoutez `fournExact=1` pour une égalité stricte (sinon le fournisseur `3` remonte aussi `30`, `130`…). |
| `fournExact` | `1` | Rend `fourn` strictement égal. |
| `gisement` | texte | Recherche dans `GISM1`…`GISM5` et `PLACE`. |
| `enStock` | `1` | Uniquement les articles dont le stock total (`S1+…+S5`) est **> 0**. |
| `stock` | `positif` \| `zero` | Variante explicite du précédent. `zero` inclut les stocks négatifs. |
| `avecGencod` | `1` | Uniquement les articles ayant un code-barres. |
| `enPromo` | `1` | Uniquement les promotions **actives aujourd'hui**. |
| `web` | `1` | Uniquement les articles marqués publiables sur le web (`WEB = "O"`). |
| `avecPhoto` | `1` | Uniquement les articles marqués comme ayant une photo (`FOTO = "F"`). |
| `tgc` | nombre | Égalité exacte sur le champ `TAXES`. ⚠️ Ce n'est **pas** le taux de TGC — voir l'avertissement sous `GET /:societe/articles/tgc`. |

> Les filtres booléens s'activent avec `1`, `true` ou `oui`. Les omettre = pas
> de filtre (et **non** « valeur fausse »).

**Exemple**

```bash
curl -H "X-API-Key: VOTRE_CLE" \
  "https://robot-nc.com/api/public/v1/sitec/articles?web=1&enStock=1&avecGencod=1&limit=3&champs=NART,DESIGN,GENCOD,PVTE,_stockTotal,_prixVenteHT"
```

```json
{
  "societe": { "nomDossierDBF": "sitec", "trigramme": "SIT", "nomComplet": "Sitec" },
  "pagination": {
    "page": 1, "limit": 3, "totalRecords": 4921, "totalPages": 1641,
    "hasNextPage": true, "hasPrevPage": false
  },
  "_tempsMs": 22,
  "articles": [
    { "NART": "800391", "DESIGN": "CAGOULE SOUDURE MIG/MMA OPTOELECT VARIABLE 9/13",
      "GENCOD": "8423246234749", "PVTE": 10800, "_stockTotal": 5, "_prixVenteHT": 10800 }
  ]
}
```

#### `GET /:societe/articles/:nart` — un article par code

`:nart` = code article (`NART`). Insensible à la casse.
`404` si inconnu. Accepte `champs`.

```bash
curl -H "X-API-Key: VOTRE_CLE" \
  https://robot-nc.com/api/public/v1/sitec/articles/800391
```

#### `GET /:societe/articles/gencod/:gencod` — un article par code-barres

`:gencod` = EAN (`GENCOD`). `404` si aucun article ne porte ce code.

```bash
curl -H "X-API-Key: VOTRE_CLE" \
  https://robot-nc.com/api/public/v1/sitec/articles/gencod/8423246234749
```

> Un même code-barres n'est indexé qu'une fois : si l'ERP contient des doublons
> de `GENCOD`, cette route renvoie l'un d'eux. Utilisez `NART` comme identifiant
> stable.

#### `GET /:societe/articles/structure` — schéma du fichier

Renvoie la liste exacte des champs de `article.dbf` **pour cette société**, avec
type, taille et décimales. **C'est la référence qui fait foi** : la structure
peut varier légèrement d'une société à l'autre du groupe.

```json
{
  "societe": { "nomDossierDBF": "sitec", "trigramme": "SIT", "nomComplet": "Sitec" },
  "fichier": "article.dbf",
  "nbEnregistrements": 21857,
  "derniereModification": "2026-08-11T04:38:15.602Z",
  "champs": [
    { "name": "NART", "type": "C", "size": 6, "decimalPlaces": 0 },
    { "name": "DESIGN", "type": "C", "size": 50, "decimalPlaces": 0 }
  ]
}
```

Types DBF : `C` = texte, `N` = numérique, `D` = date, `L` = booléen.

> `nbEnregistrements` provient ici de l'en-tête du fichier et compte aussi les
> enregistrements **marqués supprimés** : il est légèrement supérieur au nombre
> de lignes réellement servies (ex. 21 857 contre 21 846 articles ; 1 366 contre
> 1 362 clients). Le compte qui fait foi est `pagination.totalRecords` d'une
> liste sans filtre, ou l'en-tête `X-Total-Records` d'un export.

#### `GET /:societe/articles/version` — empreinte du jeu de données

Appel très léger, à utiliser pour décider s'il faut resynchroniser.

```json
{
  "societe": { "nomDossierDBF": "sitec", "trigramme": "SIT", "nomComplet": "Sitec" },
  "fichier": "article.dbf",
  "nbEnregistrements": 21846,
  "derniereModification": "2026-08-11T04:38:15.602Z",
  "version": "1786423095602-21846"
}
```

`version` change dès que l'ERP réécrit le fichier. Voir §8.

#### `GET /:societe/articles/groupes` — familles avec comptage

Valeurs distinctes du champ `GROUPE`, triées, avec le nombre d'articles.

```json
{
  "societe": {...},
  "total": 1832,
  "groupes": [{ "code": "*A10", "count": 2 }, { "code": "*AA21", "count": 2 }]
}
```

> Sur SITEC, `GROUPE` est très granulaire (**1 832 valeurs distinctes** pour
> 21 846 articles, dont des codes non significatifs comme `.` ou `*`). Ce champ
> n'est **pas** utilisable tel quel comme arborescence de rayons pour un site
> marchand : prévoyez votre propre table de correspondance, ou demandez-nous un
> regroupement métier.

#### `GET /:societe/articles/tgc` — valeurs distinctes du champ `TAXES`

```json
{ "societe": {...}, "taux": [0, 2.36, 3, 5, 6, 6.5, 7, 8, 10, 11, 13, 22, 87] }
```

> ⚠️ **Ce n'est pas la liste des taux de TGC.** Sur SITEC, `TAXES` contient des
> valeurs qui ne sont pas des taux de taxe (jusqu'à `87`), et il vaut très
> souvent `0` alors que l'article est bien taxé. **Le taux de taxe à utiliser
> pour tout calcul de prix est `ATVA`** (voir §6 et §7.1). Cette route est
> conservée pour le filtre `?tgc=`, qui interroge `TAXES`.

---

### 5.3 Clients

Scope requis : `clients:read`.

#### `GET /:societe/clients` — liste paginée

`page`, `limit` (max 500) et `champs` fonctionnent comme pour les articles.

| Filtre | Effet |
|---|---|
| `search` | Recherche partielle dans `NOM`, `AD1`, `TEL`, `ADMAIL`, `OBSERV`, `TIERS`, RIDET, `TYPE`, `CATEGORIE`, `GROUPE`. |
| `categorie` | `CATEGORIE`, égalité exacte. |
| `type` | `TYPE`, égalité exacte. |
| `catcli` | `CATCLI`, égalité exacte. |
| `groupe` | `GROUPE`, égalité exacte. |
| `repres` | Code représentant (`REPRES`). |
| `banque`, `codtarif`, `cltva`, `ecotaxe`, `sav`, `fdm` | Égalité exacte sur le champ homonyme. |
| `compte` | Compte comptable rattaché (issu de `tiers.dbf`). |

Les résultats sont triés par `NOM`.

```bash
curl -H "X-API-Key: VOTRE_CLE" \
  "https://robot-nc.com/api/public/v1/sitec/clients?limit=50&champs=TIERS,NOM,ADMAIL,TEL,CATEGORIE"
```

#### `GET /:societe/clients/:tiers` — un client par numéro de tiers

`:tiers` = champ `TIERS` (numérique). `404` si inconnu.

#### `GET /:societe/clients/structure`

Même forme que pour les articles, sur `clients.dbf`.

#### `GET /:societe/clients/version`

Même forme que pour les articles.

#### `GET /:societe/clients/filtres` — valeurs distinctes

Renvoie, en un appel, toutes les valeurs distinctes utilisables comme filtres
(`categories`, `types`, `catclis`, `professions`, `groupes`, `banques`,
`codtarifs`, `cltvas`, `ecotaxes`, `savs`, `fdms`, `comptes`, `representants`),
chacune avec son nombre d'occurrences. Pratique pour construire des listes
déroulantes sans parcourir toute la base.

```json
{
  "societe": {...},
  "representants": [{ "code": 0, "count": 643 }, { "code": 1, "count": 473 }],
  "catclis": [],
  "types": [{ "code": "*", "count": 6 }, { "code": "ARTISAN", "count": 1 }],
  "categories": [
    { "code": "ADMINISTRATION", "count": 92 },
    { "code": "COMPTANT", "count": 98 },
    { "code": "PARTICULIER", "count": 16 }
  ]
}
```

> Certaines listes peuvent être **vides** (ici `catclis`) : le champ existe mais
> n'est pas renseigné sur cette société. Ne présumez pas qu'une liste est
> peuplée.

---

### 5.4 Produits & attributs (compléments `artplus`)

Scope requis : `articles:read` — ce sont les **mêmes données que les articles**,
présentées autrement. Aucune nouvelle clé à demander.

L'ERP raisonne en **références** (`NART`). Un site marchand raisonne en
**produits** : « verrou de fenêtre à clé » est *un* produit, décliné en argent
et blanc, à l'unité ou en blister — soit 14 références. Le fichier `artplus.dbf`
porte ce qui permet de faire le lien : un nom de produit lisible, un classement
groupe / famille / sous-famille, et les caractéristiques qui distinguent les
déclinaisons (couleur, dimension, conditionnement…).

> ⚠️ **Les attributs ne sont pas les mêmes d'une société à l'autre.** Ils sont
> libres et propres à chaque base. Sur `sitec` : `01_DESIGN`, `02_DIMENSION`,
> `03_MODELE`, `04_INFO`, `05_ARBORESCENCE`. Sur d'autres sociétés du groupe, il
> y en a 18. **Commencez toujours par `GET /:societe/attributs`** : c'est le
> dictionnaire réel, et il vous dit quel attribut joue quel rôle. Ne codez pas
> une liste d'attributs en dur.
>
> Si la société n'a pas de fichier `artplus.dbf`, ces routes répondent
> normalement avec `present: false` et des listes vides — jamais une erreur.

#### `GET /:societe/attributs` — dictionnaire des attributs

À lire en premier. `roles` indique ce que l'API a reconnu : quel attribut est le
nom du produit, lequel porte le classement, etc. `facettes` donne les valeurs
distinctes avec leur nombre de produits — de quoi construire des filtres.

```json
{
  "societe": {...},
  "fichier": "artplus.dbf",
  "present": true,
  "nbEnregistrements": 28406,
  "derniereModification": "2026-07-13T03:34:56.321Z",
  "nbArticles": 5680,
  "nbProduits": 2946,
  "roles": { "nom": "design", "arborescence": "arborescence" },
  "attributs": [
    { "intitule": "01_DESIGN", "cle": "design", "role": "nom", "nbLignes": 5681, "nbRemplies": 5681 },
    { "intitule": "02_DIMENSION", "cle": "dimension", "role": "", "nbLignes": 5681, "nbRemplies": 3142 }
  ],
  "facettes": {
    "groupes": [], "familles": [], "sousFamilles": [],
    "arborescences": [{ "valeur": "1F4", "nb": 71 }]
  }
}
```

Rôles possibles : `produitId`, `nom`, `marque`, `rang`, `arborescence`,
`groupe`, `famille`, `sousFamille`. Un rôle absent = la société ne renseigne pas
cette information. `cle` est la forme normalisée de `intitule` (préfixe
numérique retiré, minuscules) : **c'est elle qui sert de clé** dans `attributs`
et `_plus`.

#### `GET /:societe/classement` — arbre groupe > famille > sous-famille

Le menu du catalogue, avec le nombre de produits et de références à chaque
niveau. `disponible: false` si la société ne renseigne pas ce classement (c'est
le cas de `sitec` : utilisez alors `arborescence`).

```json
{
  "societe": {...}, "disponible": true, "total": 9,
  "groupes": [{
    "valeur": "OUTILLAGE", "nbProduits": 3769, "nbArticles": 5412,
    "familles": [{
      "valeur": "OUTILLAGE A MAIN", "nbProduits": 1577, "nbArticles": 2578,
      "sousFamilles": [{ "valeur": "PINCES", "nbProduits": 140, "nbArticles": 169 }]
    }]
  }]
}
```

#### `GET /:societe/produits` — liste paginée des produits

| Paramètre | Effet |
|---|---|
| `page`, `limit` | Pagination (`limit` ≤ 500, défaut 100). |
| `search` | Recherche sur le nom, le classement, les codes article **et** les valeurs de variantes. Les produits dont le **nom** correspond sont remontés en premier. |
| `groupe`, `famille`, `sousFamille`, `marque` | Égalité, insensible à la casse et aux accents. |
| `arborescence` | **Préfixe** accepté : `G010` remonte tout le rayon, `G010J03` la seule case. |
| `enStock=1` | Ne garde que les produits dont **au moins une** variante a du stock. |
| `web=1` | Idem pour `WEB = "O"`. |
| `articles=0` | N'inclut pas la fiche article complète dans chaque variante (réponse ~10× plus légère). |
| `champs` | Projection appliquée aux fiches articles des variantes. |

```json
{
  "societe": {...},
  "present": true,
  "pagination": { "page": 1, "limit": 2, "totalRecords": 229, "totalPages": 115, "hasNextPage": true, "hasPrevPage": false },
  "produits": [{
    "cle": "p10937",
    "id": "10937",
    "nom": "CARTE POUR VERROU ELECTRIQUE RL1120",
    "groupe": "BATIMENT",
    "famille": "CONTROLE DACCES - SECURITE",
    "sousFamille": "VERROUILLAGE ELECTRIQUE",
    "arborescence": "G010H01",
    "marque": "VACHETTE",
    "axes": ["tet3_couleur", "tet2_dimension"],
    "nbVariantes": 1,
    "variantes": [{
      "nart": "370020",
      "attributs": { "nom_produit": "CARTE POUR VERROU ELECTRIQUE RL1120", "ss_famille": "VERROUILLAGE ELECTRIQUE" },
      "articleTrouve": true,
      "article": { "NART": "370020", "DESIGN": "CARTE P/VERROU ELECT RL1120", "PVTE": 1351.35, "_stockTotal": 8 }
    }]
  }]
}
```

- **`cle`** : identifiant du produit, à utiliser tel quel dans l'URL de la fiche.
  Il est stable tant que la source ne change pas, mais **ce n'est pas une clé
  ERP** : la clé qui fait foi reste `NART`.
- **`axes`** : les attributs qui **diffèrent** d'une variante à l'autre. C'est ce
  qui vous dit sur quoi construire vos sélecteurs (couleur, dimension…).
  Vide quand le produit n'a qu'une déclinaison.
- **`variantes[].articleTrouve`** : `false` si le `NART` a des compléments mais
  n'existe pas (ou plus) dans `article.dbf`. La variante est conservée et
  signalée plutôt que masquée en silence ; `article` est alors absent.
- L'ordre des variantes suit le rang du catalogue quand la société le renseigne
  (rôle `rang`), sinon l'ordre des `NART`.

#### `GET /:societe/produits/:cle` — un produit et toutes ses variantes

Mêmes paramètres `champs` et `articles`. `404` si la clé est inconnue.

#### `GET /:societe/produits/export` — export NDJSON des produits

Un produit complet par ligne. Accepte les mêmes filtres que la liste, ignore
`page`/`limit`. Voir §5.5 pour le format NDJSON.

#### `GET /:societe/articles/:nart/attributs` — compléments d'une référence

Les attributs d'un article dans les deux formes, plus le produit auquel il
appartient et la liste de ses références sœurs.

```json
{
  "societe": {...},
  "nart": "110320",
  "attributs": { "design": "CEINTURE DE SECURITE…", "arborescence": "1J1" },
  "attributsBruts": [
    { "intitule": "01_DESIGN", "cle": "design", "role": "nom", "contenu": "CEINTURE DE SECURITE…" },
    { "intitule": "05_ARBORESCENCE", "cle": "arborescence", "role": "arborescence", "contenu": "1J1" }
  ],
  "produit": { "cle": "nceinture-de-securite…", "id": "", "nom": "CEINTURE DE SECURITE…", "nbVariantes": 1, "axes": [], "narts": ["110320"] }
}
```

---

### 5.5 Exports complets (synchronisation)

#### `GET /:societe/articles/export`
#### `GET /:societe/clients/export`
#### `GET /:societe/produits/export`

Renvoient **l'intégralité** des enregistrements au format **NDJSON**
(*newline-delimited JSON*) : **un objet JSON complet par ligne**, pas de tableau
englobant. Le flux est envoyé au fil de l'eau — vous pouvez le traiter sans
charger toute la réponse en mémoire.

Ces routes acceptent les mêmes filtres que les listes correspondantes, ainsi que
`champs`. Elles ignorent `page` et `limit`.

En-têtes de réponse utiles :

```
Content-Type: application/x-ndjson; charset=utf-8
X-Total-Records: 21846
X-Data-Version: 1786423095602-21846
```

```bash
curl -H "X-API-Key: VOTRE_CLE" \
  "https://robot-nc.com/api/public/v1/sitec/articles/export?champs=NART,DESIGN,GENCOD,PVTE,_stockTotal" \
  -o articles.ndjson
```

```
{"NART":"904950","DESIGN":"BOUTON POUSSOIR BET S350","GENCOD":"","PVTE":11861,"_stockTotal":1}
{"NART":"906751","DESIGN":"FLASQUE DE SERRAGE 125","GENCOD":"4002395307708","PVTE":1132,"_stockTotal":1}
```

**Volumes mesurés en production** (SITEC, appels depuis Nouméa) :

| Appel | Lignes | Taille | Durée |
|---|---|---|---|
| `articles/export` — sans projection (92 champs + calculés) | 21 846 | 29,2 Mo | ~7,1 s |
| `articles/export?web=1&enStock=1` | 5 105 | 6,9 Mo | ~2,8 s |
| `articles/export?champs=` (8 champs) | 21 846 | 3,3 Mo | ~2,5 s |
| `clients/export` | 1 362 | — | < 1 s |

La projection `champs=` divise le volume par ~9 : ne rapatriez que ce dont vous
avez besoin.

---

## 6. Champs calculés ajoutés par l'API (articles)

Ils évitent de recoder côté site marchand une logique métier qui doit rester
identique partout. Présents sur toutes les routes articles.

| Champ | Type | Calcul |
|---|---|---|
| `_stockTotal` | nombre | `S1 + S2 + S3 + S4 + S5`. **C'est le stock qui fait foi**, pas le champ `STOCK`. |
| `_stockParEntrepot` | objet | `{ S1: { libelle, quantite }, … S5 }`, `libelle` provenant du paramétrage de la société. |
| `_enStock` | booléen | `_stockTotal > 0`. |
| `_promoActive` | booléen | `true` si `DPROMOD ≤ aujourd'hui ≤ DPROMOF` **et** `PVPROMO` renseigné. |
| `_prixVenteHT` | nombre | Prix HT réellement applicable aujourd'hui : `PVPROMO` si `_promoActive` et `PVPROMO > 0`, sinon `PVTE`. |
| `_publieWeb` | booléen | `WEB` vaut `"O"`. |
| `_aPhoto` | booléen | `FOTO` vaut `"F"`. |
| `_plus` | objet | Attributs `artplus` de la référence, par clé normalisée (§5.4). Absent si la société n'a pas de compléments, ou avec `?plus=0`. |
| `_produit` | objet | Produit de rattachement : `{ cle, id, nom, groupe, famille, sousFamille, arborescence, marque, nbVariantes }`. Sert à passer d'une référence à sa fiche produit. |

> `?plus=0` retire `_plus` et `_produit` de la réponse. Utile pour un export de
> masse dont vous n'avez pas besoin des compléments.

> **Prix TTC.** Le champ `PVTETTC` est fourni par l'ERP. La conversion utilisée
> en interne est `PVTETTC = tronquer(PVTE × (1 + ATVA / 100))` (troncature, pas
> arrondi). Pour un prix promotionnel TTC, appliquez la même formule à
> `PVPROMO`. `_prixVenteHT` est volontairement **HT** : n'en déduisez pas un TTC
> sans passer par `ATVA`.

---

## 7. Dictionnaire des champs

⚠️ Les tableaux ci-dessous décrivent la structure **de la société SITEC** au
moment de la rédaction. La source qui fait foi reste
`GET /:societe/articles/structure` et `GET /:societe/clients/structure`.
Traitez les champs de manière tolérante : n'échouez pas si un champ inattendu
apparaît ou disparaît.

Certains champs sont propres à l'exploitation interne de l'ERP et n'ont pas
d'usage documenté côté site marchand ; ils sont marqués *(usage ERP interne)* —
ils sont exposés par souci d'exhaustivité, mais ne construisez rien dessus sans
nous demander confirmation.

### 7.1 `article.dbf` — 92 champs

**Identification et description**

| Champ | Type | Description |
|---|---|---|
| `NART` | C(6) | **Code article — identifiant unique et stable.** Clé à utiliser partout. |
| `DESIGN` | C(50) | Désignation commerciale. |
| `GENCOD` | C(13) | Code-barres EAN. Peut être vide. |
| `REFER` | C(14) | Référence fournisseur. |
| `DESIFRN` | C(50) | Désignation fournisseur. |
| `GENDOUBL` | C(13) | Code article de **renvoi** : l'article est remplacé par celui-ci (chaîne de remplacement possible). |
| `ASSOCIE` | C(6) | Code d'un article associé. |
| `UNITE` | C(3) | Unité de vente (ex. `U`, `M`, `KG`). |
| `CONDITNM` | N(4) | Conditionnement (quantité par colis). |
| `VOL` | N(10,3) | Volume unitaire. |
| `COULR` | C(2) | Code couleur. |
| `DOUANE` | C(9) | Code douanier (nomenclature). |
| `DEVISE` | C(4) | Devise d'achat. |
| `OBSERV` | C(70) | Observation libre. |
| `GARANTIE` | C(10) | Durée / mention de garantie. |
| `SAV` | C(1) | Indicateur SAV. |
| `CREATION` | D | Date de création de la fiche article. |
| `TEXTE` | C(1) | *(usage ERP interne)* Présence d'un texte long associé. |
| `KL` | C(1) | *(usage ERP interne)* |
| `RENV` | C(1) | *(usage ERP interne)* Indicateur de renvoi. |
| `CODMAJ` | C(1) | *(usage ERP interne)* Code de mise à jour. |

**Prix et taxes**

| Champ | Type | Description |
|---|---|---|
| `PVTE` | N(11,2) | **Prix de vente HT.** |
| `PVTETTC` | N(8) | **Prix de vente TTC** tel que calculé par l'ERP. |
| `PVPROMO` | N(8) | Prix promotionnel **HT**. `0` si aucune promo. |
| `DPROMOD` | D | Date de début de promotion (incluse). |
| `DPROMOF` | D | Date de fin de promotion (incluse). |
| `ATVA` | N(5,2) | **Taux de taxe (%) — le seul à utiliser pour les calculs de prix** : `PVTETTC = tronquer(PVTE × (1 + ATVA/100))`. Vérifié en production : `PVTE=10800`, `ATVA=11` → `PVTETTC=11988`. |
| `TAXES` | N(5,2) | ⚠️ **Ne pas confondre avec le taux de TGC.** Sur SITEC ce champ vaut `0` sur des articles pourtant taxés à 11 %, et prend des valeurs qui ne sont pas des taux (jusqu'à `87`). Son usage exact est interne à l'ERP. Il n'est exposé que parce que le filtre `?tgc=` l'interroge. |
| `CODTGC` | C(1) | Code de régime TGC. |
| `TXADEDUIRE` | N(5,2) | Taux à déduire *(usage ERP interne)*. |
| `PREV` | N(11,2) | **Prix de revient** (coût). Sert au calcul de la valeur de stock et du taux de marque : `(PVTE − PREV) / PVTE`. |
| `DERPREV` | N(11,2) | Dernier prix de revient connu. |
| `PACHAT` | N(13,4) | Prix d'achat. ⚠️ Champ historiquement peu fiable dans cet ERP : nos outils internes reconstituent l'historique d'achat depuis les lignes de commande plutôt que depuis ce champ. |
| `PDETAIL` | N(11,2) | Prix de détail *(usage ERP interne)*. |
| `POURC` | N(2) | Pourcentage de remise/marge *(usage ERP interne)*. |
| `QT2` / `PR2` | N | Palier tarifaire 2 : quantité seuil / prix associé. |
| `QT3` / `PR3` | N | Palier tarifaire 3. |
| `CODTAR` | C(6) | Code tarif. |
| `TARIFL` | L | Indicateur tarif *(booléen)*. |

**Stocks et approvisionnement**

| Champ | Type | Description |
|---|---|---|
| `S1` … `S5` | N(10,2) | **Stock par entrepôt.** `S1` = magasin par défaut ; les libellés réels sont donnés par `GET /societes`. |
| `STOCK` | N(10,2) | Champ stock hérité. ⚠️ **Ne pas utiliser** : le stock qui fait foi est la somme `S1..S5`, exposée en `_stockTotal`. |
| `STLOC2` | N(10,2) | Stock second emplacement *(usage ERP interne)*. |
| `SMINI` | N(8,2) | Stock minimum (seuil de réappro). |
| `STSECUR` | N(3) | Stock de sécurité. |
| `ENCDE` | N(9,2) | Quantité **en commande** fournisseur (attendue). |
| `RESERV` | N(7,2) | Quantité / nombre de réservations en cours. |
| `CDESPEC` | N(7,2) | Commande spéciale *(usage ERP interne)*. |
| `DEPREC` | N(3) | Indicateur de dépréciation. Convention interne : un article est considéré **déprécié** si `_stockTotal = 0` **et** `DEPREC > 1`. |
| `DATINV` | D | Date du dernier inventaire. |
| `DATINV2` | D | Date d'inventaire secondaire. |

**Classement et emplacement**

| Champ | Type | Description |
|---|---|---|
| `GROUPE` | C(6) | Code famille / groupe. Liste et comptages via `GET /:societe/articles/groupes`. ⚠️ Très granulaire (1 832 valeurs sur SITEC) et non hiérarchisé : à ne pas utiliser tel quel comme arborescence de catégories. |
| `FOURN` | N(3) | Code fournisseur principal. |
| `GISM1` … `GISM5` | C(6) | Gisements (emplacements en magasin), du plus général au plus fin. |
| `PLACE` | C(6) | Emplacement complémentaire. |

**Historique de ventes**

| Champ | Type | Description |
|---|---|---|
| `V1` … `V12` | N(6) | **Quantités vendues par mois glissant** : `V1` = mois en cours, `V2` = mois précédent, … `V12` = il y a 11 mois. Les valeurs peuvent être négatives (retours). Vente annuelle ≈ `Σ V1..V12`. |
| `V13`, `V14` | N(6) | Prolongement de la série *(usage ERP interne ; non utilisé par nos outils)*. |
| `RUP1` … `RUP12` | N(2) | **Jours de rupture par mois**, même indexation que `V1..V12`. Utilisés en interne pour corriger la vente moyenne : `vente_moy_mois = (Σ|V| × 30) / (360 − Σ RUP)`. |

**Indicateurs de publication**

| Champ | Type | Description |
|---|---|---|
| `WEB` | C(1) | `"O"` = article destiné à être publié sur le web. **C'est le drapeau à utiliser pour alimenter le catalogue du site marchand.** Exposé en `_publieWeb`. |
| `FOTO` | C(1) | `"F"` = une photo existe pour cet article. Exposé en `_aPhoto`. ⚠️ Les fichiers images eux-mêmes ne sont **pas** servis par cette API (voir §10). |

### 7.2 `clients.dbf` — 63 champs

> ⚠️ **Données personnelles.** Cette base contient des coordonnées nominatives
> et des informations commerciales sensibles (encours, blocages, relances). Elle
> est fournie **pour les seuls besoins du site marchand**. Ne la rediffusez pas,
> ne l'exportez pas hors de l'infrastructure du projet, et ne l'exposez jamais
> côté navigateur.

**Identité et coordonnées**

| Champ | Type | Description |
|---|---|---|
| `TIERS` | N(4) | **Numéro de tiers — identifiant unique du client.** |
| `NOM` | C(30) | Raison sociale / nom. |
| `AD1` … `AD4` | C(30) | Lignes d'adresse. |
| `AD5` | C(30) | Contient le **RIDET** (identifiant d'entreprise NC) sous forme libre ; les 7 premiers chiffres après nettoyage constituent le RIDET exploitable. |
| `TEL` | C(10) | Téléphone. |
| `FAX` | C(10) | Fax. |
| `ADMAIL` | C(80) | Adresse e-mail. Peut être vide ou mal formée : **validez avant tout envoi**. |
| `INTERLOC` | C(60) | Interlocuteur principal. |
| `CONTACT1` … `CONTACT4` | C(55) | Contacts complémentaires (texte libre). |
| `CREATION` | D | Date de création de la fiche. |

**Segmentation commerciale**

| Champ | Type | Description |
|---|---|---|
| `CATEGORIE` | C(52) | Catégorie client (ex. `PARTICULIER`, `PRO DEBIT`…). Attention : valeurs libres, avec des variantes orthographiques. |
| `TYPE` | C(12) | Type de client. |
| `CATCLI` | C(1) | Catégorie codifiée sur un caractère. |
| `PROFES` | C(50) | Profession / secteur. |
| `GROUPE` | C(6) | Groupe client. |
| `REPRES` | N(3) | Code du représentant/commercial rattaché. |
| `FDM` | C(4) | Code famille de marché *(usage ERP interne)*. |

**Conditions commerciales**

| Champ | Type | Description |
|---|---|---|
| `REMISE` | N(2) | Taux de remise (%). |
| `CODREM` | C(1) | Code de remise. |
| `TARIF` | C(10) | Tarif appliqué. |
| `CODTARIF` | C(1) | Code tarif. |
| `TARIFL` | L | Indicateur tarif *(booléen)*. |
| `CONDPAI` | C(70) | Conditions de paiement (texte libre). |
| `ECHEANCE2` | N(5) | Échéance secondaire. |
| `CLTVA` | C(1) | Régime de TVA/TGC du client. |
| `ECOTAXE` | C(1) | Assujettissement écotaxe. |
| `NBEXFACT` | N(1) | Nombre d'exemplaires de facture. |
| `BANQUE` | C(31) | Domiciliation bancaire. |
| `SAV` | C(1) | Indicateur SAV. |

**Encours et recouvrement** *(informations sensibles)*

| Champ | Type | Description |
|---|---|---|
| `DEBIT` | N(8) | Total débit. |
| `CREDIT` | N(8) | Total crédit. |
| `DEBIMAX` | N(8) | Encours maximum autorisé (plafond de crédit). |
| `BALANCE` | C(100) | Balance sous forme textuelle *(format interne)*. |
| `DATECHEAN` | C(20) | Échéance sous forme textuelle *(format interne)*. |
| `CAUTION` / `DATCAUTION` | C(70) / D | Caution et sa date. |
| `BLOCAGE` / `DATBLOCAGE` | C(60) / D | Motif de blocage du compte et sa date. **Un client bloqué ne doit pas pouvoir commander à crédit.** |
| `RELANCE` | C(70) | Note de relance. |
| `FACTURE` / `DATFACTURE` | C(10) / D | Dernière facture et sa date. |
| `ACTION` / `ACTPAR` / `DATACTPAR` | C / C / D | Suivi d'action de recouvrement. |
| `FAITPAR` / `DATFAIPAR` | C(10) / D | Auteur et date de la dernière intervention. |
| `COMMENT` / `COMMENTPAR` / `DATCOMPAR` | C / C / D | Commentaire de suivi, auteur, date. |

**Divers**

| Champ | Type | Description |
|---|---|---|
| `LOGIN` | C(20) | Identifiant extranet ERP. ⚠️ Voir l'avertissement ci-dessous. |
| `INTPASS` | C(20) | Mot de passe extranet ERP. ⚠️ Voir l'avertissement ci-dessous. |
| `OBSERV` | C(50) | Observation courte. |
| `OBSERVAT` | C(100) | Observation longue. |
| `MEMOLIVR1` … `MEMOLIVR3` | C(70) | Consignes de livraison. |
| `TEXTE` | C(1) | *(usage ERP interne)* Présence d'un texte long associé. |

> ⚠️ **`LOGIN` / `INTPASS`.** Ces champs contiennent des identifiants de
> l'extranet de l'ERP. Ils sont exposés parce que la demande porte sur
> « tous les champs », mais **ils ne doivent servir à rien dans le site
> marchand** : n'implémentez pas d'authentification client à partir d'eux, ne
> les stockez pas, ne les journalisez pas. Ils peuvent être retirés de la
> réponse à la demande (voir §11).

---

## 8. Stratégie de synchronisation recommandée

Il n'y a **pas de champ « date de dernière modification » par enregistrement**
dans ces fichiers : un delta ligne à ligne est donc impossible côté serveur.
Le schéma qui fonctionne bien :

1. **Sonder** `GET /:societe/articles/version` (appel très léger) toutes les
   5 à 15 minutes. Conserver la valeur de `version`.
2. Si `version` **n'a pas changé** → ne rien faire.
3. Si `version` **a changé** → appeler `GET /:societe/articles/export` avec la
   projection `champs` dont vous avez réellement besoin, puis reconstruire ou
   mettre à jour votre catalogue par comparaison sur `NART`.
4. Même principe pour les clients (`clients/version` → `clients/export`), à une
   fréquence plus faible : cette base bouge beaucoup moins.
5. Pour l'arborescence du site, rejouer `GET /:societe/classement` et
   `GET /:societe/produits/export` dans la même passe : les compléments
   `artplus` changent au rythme du catalogue, pas des prix.

Points d'attention :

- **Une nuit suffit pour un catalogue.** Un export complet + reconstruction en
  tâche planifiée nocturne est le mode le plus simple et le plus robuste.
- **Le stock, lui, bouge en continu.** Si votre site affiche une disponibilité,
  interrogez `GET /:societe/articles/:nart` ponctuellement (fiche produit,
  ajout au panier, validation de commande) plutôt que de vous fier à un export
  de la nuit. Rappel : la donnée a au plus 5 minutes de retard.
- **Ne présumez jamais qu'un `NART` existe encore.** Traitez le `404`.
- **`GENDOUBL` non vide** signifie que l'article est remplacé : à traiter comme
  une redirection produit plutôt que comme une fiche active.
- **Filtrez à la source.** `?web=1&enStock=1` côté API coûte bien moins cher que
  de rapatrier 21 000 articles pour en garder 4 000.

---

## 9. Exemples de code

### Node.js — pagination

```js
const BASE = "https://robot-nc.com/api/public/v1";
const CLE = process.env.QC_API_KEY; // jamais en dur dans le code

async function tousLesArticlesWeb() {
  const articles = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/sitec/articles?web=1&limit=500&page=${page}`;
    const r = await fetch(url, { headers: { "X-API-Key": CLE } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.json()).message}`);
    const data = await r.json();
    articles.push(...data.articles);
    if (!data.pagination.hasNextPage) break;
    page++;
  }
  return articles;
}
```

### Node.js — export NDJSON en flux

```js
import readline from "node:readline";
import { Readable } from "node:stream";

const r = await fetch(
  `${BASE}/sitec/articles/export?web=1&champs=NART,DESIGN,GENCOD,PVTE,_stockTotal,_prixVenteHT`,
  { headers: { "X-API-Key": CLE } },
);
console.log("version des données :", r.headers.get("X-Data-Version"));

const lignes = readline.createInterface({ input: Readable.fromWeb(r.body) });
for await (const ligne of lignes) {
  if (!ligne) continue;
  const article = JSON.parse(ligne);
  // ... upsert dans votre base, clé = article.NART
}
```

### PHP

```php
<?php
$cle  = getenv('QC_API_KEY');
$base = 'https://robot-nc.com/api/public/v1';

$ch = curl_init("$base/sitec/articles?web=1&limit=100");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER     => ["X-API-Key: $cle"],
  CURLOPT_TIMEOUT        => 60,
]);
$reponse = curl_exec($ch);
$code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code !== 200) {
  throw new RuntimeException("API $code : " . json_decode($reponse, true)['message']);
}
$data = json_decode($reponse, true);
foreach ($data['articles'] as $a) {
  echo trim($a['NART']) . ' — ' . trim($a['DESIGN']) . ' — ' . $a['_prixVenteHT'] . " XPF\n";
}
```

### Python

```python
import os, requests

BASE = "https://robot-nc.com/api/public/v1"
S = requests.Session()
S.headers["X-API-Key"] = os.environ["QC_API_KEY"]

r = S.get(f"{BASE}/sitec/articles", params={"web": 1, "enStock": 1, "limit": 500}, timeout=60)
r.raise_for_status()
for a in r.json()["articles"]:
    print(a["NART"].strip(), a["DESIGN"].strip(), a["_prixVenteHT"])
```

---

## 10. Limites connues

| Limite | Détail |
|---|---|
| **Lecture seule** | Aucune écriture possible. Les commandes passées sur le site marchand ne remontent pas dans l'ERP par cette API. |
| **Pas de photos** | `FOTO` indique qu'une photo *existe* dans l'ERP, mais les fichiers images ne sont pas servis par cette API. À traiter séparément si le site marchand en a besoin. |
| **Pas de webhook** | Détection des changements par sondage (§8). |
| **Latence de 5 min** | Cache serveur. Une modification ERP est visible en 5 minutes au pire. |
| **Pas de delta** | Pas d'horodatage par ligne dans les fichiers sources ; seul l'export complet garantit l'exhaustivité. |
| **Doublons de code-barres** | `GENCOD` n'est pas garanti unique dans l'ERP. `NART` est la seule clé fiable. |
| **Périmètre v1** | Articles, produits/attributs et clients. Fournisseurs, commandes, factures et proformas existent en interne mais ne sont pas exposés. |
| **Compléments facultatifs** | `artplus.dbf` n'existe pas dans toutes les sociétés, et son contenu est libre : les attributs disponibles varient. Interrogez `GET /:societe/attributs` plutôt que de supposer un schéma. |
| **Regroupement produits** | Le regroupement se fait sur l'identifiant produit quand la société en tient un, sinon sur le **nom** du produit. Deux références portant exactement le même nom sont donc vues comme deux variantes d'un même produit. |

---

## 11. Support et évolutions

- Pour toute demande, indiquez le **préfixe** de votre clé (`GET /ping` →
  `cle.prefixe`), l'URL appelée et le code HTTP obtenu. **N'envoyez jamais la
  clé complète.**
- Peuvent être ajustés à la demande, sans changement de code de votre côté :
  quota par minute, restriction par adresse IP, date d'expiration, et
  **exclusion de champs** (par exemple retirer `LOGIN` et `INTPASS` des réponses
  clients).
- Toute extension du périmètre (fournisseurs, commandes, écriture) fait l'objet
  d'une décision explicite et d'une nouvelle version de cette documentation.

---

<a id="annexe-interne"></a>

## Annexe — administration des clés (interne, non destinée au prestataire)

Les clés se gèrent en ligne de commande depuis la racine du dépôt. Il n'y a
volontairement pas d'écran d'administration.

```bash
# Lister les clés et leur usage
npm run apikey:list

# Créer une clé
npm run apikey:create -- --nom "Site marchand SITEC" \
                         --societes sitec \
                         --scopes articles:read,clients:read \
                         --limite 300

# Options supplémentaires
#   --expire 2027-12-31                 date d'expiration
#   --ips 203.0.113.10,203.0.113.11     liste blanche d'IP appelantes
#   --exclure-clients LOGIN,INTPASS     champs retirés des réponses clients
#   --exclure-articles PACHAT           champs retirés des réponses articles
#   --notes "..."                       mémo libre

# Révoquer / réactiver
npm run apikey:revoke -- --prefixe qcapi_XXXXXXXXXXXX
npm run apikey:activate -- --prefixe qcapi_XXXXXXXXXXXX
```

**La clé en clair n'est affichée qu'une seule fois, à la création.** Seul son
SHA-256 est stocké ; elle n'est pas récupérable ensuite. En cas de perte, il
faut révoquer et recréer.

Fichiers concernés :

| Fichier | Rôle |
|---|---|
| `backend/models/ApiKeyModel.js` | Modèle Mongo (hash, périmètre, quota, exclusions). |
| `backend/middleware/apiKeyAuth.js` | Authentification, quota, contrôle de scope et de société. |
| `backend/controllers/publicApiController.js` | Contrôleurs de l'API partenaire. |
| `backend/routes/publicApiRoutes.js` | Routage, monté sur `/api/public/v1` dans `server.js`. |
| `backend/scripts/apiKeys.js` | CLI de gestion des clés. |

L'exclusion de champs réutilise le masque DBF global
(`backend/middleware/masquerChampsDbf.js`) : `apiKeyAuth` pose `req.masqueDbf`,
et l'enveloppe `res.json` installée sur `/api` fait l'élagage. Les exports
NDJSON n'y passent pas et appliquent l'élagage explicitement.
