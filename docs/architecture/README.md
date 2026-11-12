# Documentation d'architecture — sources

Les deux PDF **A3 paysage** à la racine du dépôt sont *générés* depuis ce dossier :

| PDF (racine) | Source |
|---|---|
| `Architecture_Application_WEB_A3.pdf` | `ARCHITECTURE_WEB.md` |
| `Architecture_Application_MOBILE_A3.pdf` | `ARCHITECTURE_MOBILE.md` |

**Ne pas corriger le PDF : corriger le `.md`, puis régénérer.**

## Régénérer

Le générateur (`generer-pdf.mjs`) rend les diagrammes Mermaid dans le Chrome
installé sur le poste, puis imprime en PDF A3 paysage (420 × 297 mm).

```bash
# 1. dependances de rendu, dans un dossier de travail quelconque hors du depot
npm install puppeteer-core mermaid marked

# 2. generation (depuis ce dossier de travail)
node "<chemin>/docs/architecture/generer-pdf.mjs"
```

⚠️ **Vider `NODE_OPTIONS` (et `CI`) avant** — sinon `dns-fix.js` fait échouer
`npm` et `node` sur ce poste, comme pour `npm run build`.

Le script attend Chrome dans `C:\Program Files\Google\Chrome\Application\chrome.exe`
(constante `CHROME` en tête de fichier) et écrit les deux PDF à la racine du dépôt
(constante `PROJET`).

## Ce que fait le générateur

1. découpe le `.md` en pages A3 : **une page par diagramme**, le texte qui précède
   devient l'intro, celui qui suit l'encadré de notes ;
2. rend les diagrammes avec Mermaid 11, puis **remplace la mise en page** d'un
   schéma mal proportionné (un flowchart en colonne, un ER étalé en ligne) par la
   variante qui accepte le plus gros facteur d'échelle ;
3. réduit le texte, jamais le diagramme, quand une page déborde ;
4. compose page de garde, sommaire paginé, en-têtes et pieds de page.

Il écrit aussi un `*.plan.txt` (page → diagramme) et affiche en fin de course le
facteur d'échelle de chaque schéma : **en dessous de ~0,5 le schéma devient trop
petit pour du papier — il faut alors le découper en deux dans le `.md`**.
