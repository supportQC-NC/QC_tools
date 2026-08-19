// src/components/ui/RichTextEditor/sanitizeHtml.js
//
// Nettoyage du HTML d'un mail : whitelist de balises et d'attributs.
// Sert à deux moments dans l'éditeur visuel :
//   - au COLLER (un copier/coller depuis Word ou une page web arrive bardé de
//     balises et de styles qui cassent le rendu dans les clients mail) ;
//   - à l'ENREGISTREMENT, en garde-fou.
// Le serveur refait sa propre passe : ce nettoyage-ci est un confort, pas une
// sécurité (voir nettoyerHtmlMessage côté backend).

// Balises conservées — volontairement limitées à ce qu'un client mail affiche
// correctement.
const BALISES_OK = new Set([
  "b", "strong", "i", "em", "u", "s", "strike", "font", "span",
  "p", "div", "br", "hr", "blockquote",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "a", "img",
  "table", "thead", "tbody", "tr", "td", "th",
  "sub", "sup", "small",
]);

// Balises supprimées AVEC leur contenu.
const BALISES_KO = "script,style,iframe,object,embed,link,meta,form,input,button,noscript";

// Attributs autorisés par balise (+ ceux autorisés partout).
const ATTRS_OK = {
  "*": ["style", "align", "dir"],
  a: ["href", "target", "title"],
  font: ["color", "size", "face"],
  img: ["src", "alt", "width", "height"],
  table: ["border", "cellpadding", "cellspacing", "width"],
  td: ["colspan", "rowspan", "width", "valign"],
  th: ["colspan", "rowspan", "width", "valign"],
};

const urlDangereuse = (v) => /^\s*(javascript|data:text\/html|vbscript):/i.test(v || "");

export const sanitizeHtml = (html) => {
  if (!html) return "";
  if (typeof window === "undefined" || !window.DOMParser) return html;

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  // 1) Balises dangereuses : supprimées avec leur contenu.
  body.querySelectorAll(BALISES_KO).forEach((n) => n.remove());

  // 2) Balises inconnues : dépliées (on garde le texte, on jette l'enveloppe).
  //    Boucle car déplier peut faire remonter d'autres balises inconnues.
  let garde = 0;
  let aDeplier = true;
  while (aDeplier && garde++ < 50) {
    const inconnues = [...body.querySelectorAll("*")].filter(
      (el) => !BALISES_OK.has(el.tagName.toLowerCase()),
    );
    aDeplier = inconnues.length > 0;
    inconnues.forEach((el) => el.replaceWith(...el.childNodes));
  }

  // 3) Attributs : whitelist + neutralisation des URL exécutables.
  body.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const autorises = [...(ATTRS_OK["*"] || []), ...(ATTRS_OK[tag] || [])];
    [...el.attributes].forEach((attr) => {
      const nom = attr.name.toLowerCase();
      if (nom.startsWith("on") || !autorises.includes(nom)) {
        el.removeAttribute(attr.name);
        return;
      }
      if ((nom === "href" || nom === "src") && urlDangereuse(attr.value)) {
        el.removeAttribute(attr.name);
      }
    });
    // Un lien s'ouvre dans un nouvel onglet.
    if (tag === "a" && el.getAttribute("href")) el.setAttribute("target", "_blank");
  });

  return body.innerHTML;
};

// Vrai si le contenu ne porte aucun texte ni image (sert au texte d'invite).
export const htmlEstVide = (html) => {
  const sansBalise = String(html || "")
    .replace(/<(img|hr|table)\b/gi, "X")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return sansBalise === "";
};

export default sanitizeHtml;
