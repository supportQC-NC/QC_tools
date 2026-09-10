// src/screens/admin/SuiviTerrain.jsx
//
// Briques d'affichage COMMUNES aux trois écrans de suivi terrain (réappro,
// bipage, préparation), à côté de leur feuille de style `SuiviTerrain.css`.
//
// Elles ne portent aucune logique métier : uniquement de quoi présenter la
// même donnée de la même façon d'un écran à l'autre. Les trois tableaux
// répétaient les mêmes tournures (« x / y » en texte brut, « — » aussi visible
// qu'une vraie valeur, badge d'origine emprunté à l'échelle de priorité) et
// dérivaient dès qu'on en modifiait un seul.
import React from "react";
import { HiDeviceMobile } from "react-icons/hi";

/* Valeur de cellule : atténue le tiret d'absence pour qu'une colonne vide ne
 * pèse pas autant qu'une colonne renseignée. Les formateurs des écrans
 * renvoient déjà « — », on se contente de le reconnaître. */
export const Val = ({ v }) =>
  v === null || v === undefined || v === "" || v === "—" ? (
    <span className="st-nil">—</span>
  ) : (
    <>{v}</>
  );

/* Origine du travail : fait AU COLLECTEUR (mobile) ou poussé depuis le WEB.
 * ⚠️ Ce n'est PAS une échelle de priorité — l'ancienne version réutilisait la
 * pastille « urgent », et « Collecteur » ressortait en rouge comme une alerte
 * alors que c'est le cas le plus courant. */
export const Origine = ({ mobile, children }) => (
  <span className={`st-origine st-origine-${mobile ? "mobile" : "web"}`}>
    {mobile && <HiDeviceMobile />}
    {children}
  </span>
);

/* Agent / opérateur, avec l'icône mobile quand le travail vient d'un
 * collecteur. Rend le tiret atténué quand personne n'a encore pris la main. */
export const Agent = ({ nom, mobile = true }) =>
  nom ? (
    <span className="st-agent">
      {mobile && <HiDeviceMobile />}
      {nom}
    </span>
  ) : (
    <Val v={null} />
  );

/* ⚠️ `Number(null)` vaut 0 — et `Number.isFinite(0)` vaut true. Passer par
 * `Number()` seul ferait donc lire « 0 » à une valeur ABSENTE, c'est-à-dire
 * exactement le faux zéro que ces écrans refusent d'afficher : une fiche
 * papier n'est pas saisie ligne à ligne, « 0 ligne préparée » y serait un
 * contresens. Absent doit rester absent. */
const nombre = (v) =>
  v === null || v === undefined || v === "" ? NaN : Number(v);

/* Avancement « fait / total ».
 *
 * Le compte exact reste affiché — c'est lui qu'on recopie — mais la barre
 * donne la proportion sans avoir à faire la division de tête sur chaque ligne.
 * Sans total connu (une fiche papier n'est pas saisie ligne à ligne, un
 * réappro libre n'a pas de liste de départ), on n'invente pas de dénominateur :
 * on affiche le seul chiffre dont on dispose, sans barre. */
export const Avancement = ({ fait, total, format = (v) => v }) => {
  const f = nombre(fait);
  const t = nombre(total);
  const faitOk = Number.isFinite(f);
  const totalOk = Number.isFinite(t) && t > 0;

  if (!faitOk && !totalOk) return <Val v={null} />;
  if (!totalOk) return <span className="st-prog-txt">{format(fait)}</span>;

  const pct = Math.max(0, Math.min(100, ((faitOk ? f : 0) / t) * 100));
  const complet = faitOk && f >= t;

  return (
    <span className={`st-prog${complet ? " st-prog-complet" : ""}`}>
      <span className="st-prog-txt">
        {format(faitOk ? fait : 0)}
        <span className="st-prog-tot"> / {format(total)}</span>
      </span>
      <span
        className="st-prog-bar"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="st-prog-fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
};
