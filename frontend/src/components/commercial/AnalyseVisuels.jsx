// src/components/commercial/AnalyseVisuels.jsx
//
// Les visuels du rapport Power BI, en SVG inline (aucune dépendance ajoutée) :
//   - CourbeCumul   : areaChart « CA HT Net Cumulé » vs « Cumulé (N-1) »
//   - Waterfall     : waterfallChart « Evolution CA HT » par mois
//   - Treemap       : treemap du Profit par fournisseur / rayon / client
//   - Pivot         : le tableau hiérarchique (voir CommercialAnalyseScreen)

import React from "react";
import { fmtMontant } from "./CommercialShell";

const MOIS_COURT = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Courbe de CA cumulé : année en cours vs N-1 (TOTALYTD du rapport). */
export const CourbeCumul = ({ cumulN = [], cumulN1 = [], anneeN, anneeN1 }) => {
  const L = 12;
  const max = Math.max(1, ...cumulN.map(Math.abs), ...cumulN1.map(Math.abs));
  const W = 720;
  const H = 200;
  const px = (i) => (i / (L - 1)) * (W - 40) + 30;
  const py = (v) => H - 25 - (Math.abs(v) / max) * (H - 45);
  const ligne = (serie) =>
    serie.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i)} ${py(v)}`).join(" ");
  const aire = (serie) =>
    `${ligne(serie)} L ${px(L - 1)} ${H - 25} L ${px(0)} ${H - 25} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="co-svg" role="img"
      aria-label={`CA cumulé ${anneeN} contre ${anneeN1}`}>
      <defs>
        <linearGradient id="grad-ca" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path d={aire(cumulN1)} fill="rgba(148,163,184,0.16)" />
      <path d={ligne(cumulN1)} fill="none" stroke="#94a3b8" strokeWidth="2"
        strokeDasharray="4 3" />
      <path d={aire(cumulN)} fill="url(#grad-ca)" />
      <path d={ligne(cumulN)} fill="none" stroke="#a855f7" strokeWidth="2.5" />
      {cumulN.map((v, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(v)} r="3" fill="#a855f7">
            <title>{`${MOIS_COURT[i]} ${anneeN} : ${fmtMontant(v)} F`}</title>
          </circle>
          <text x={px(i)} y={H - 8} textAnchor="middle" className="co-svg-axe">
            {MOIS_COURT[i]}
          </text>
        </g>
      ))}
    </svg>
  );
};

/** Waterfall : écart de CA mois par mois entre N et N-1. */
export const Waterfall = ({ evolutionMois = [] }) => {
  const max = Math.max(1, ...evolutionMois.map(Math.abs));
  const W = 720;
  const H = 200;
  const zero = H / 2;
  const larg = (W - 40) / 12 - 6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="co-svg" role="img"
      aria-label="Évolution du CA par mois">
      <line x1="20" y1={zero} x2={W - 10} y2={zero} stroke="var(--admin-border)" />
      {evolutionMois.map((v, i) => {
        const h = (Math.abs(v) / max) * (zero - 20);
        const x = 30 + i * ((W - 40) / 12);
        return (
          <g key={i}>
            <rect
              x={x}
              y={v >= 0 ? zero - h : zero}
              width={larg}
              height={Math.max(1, h)}
              fill={v >= 0 ? "#34d399" : "#f87171"}
              rx="2"
            >
              <title>{`${MOIS_COURT[i]} : ${v >= 0 ? "+" : ""}${fmtMontant(v)} F`}</title>
            </rect>
            <text x={x + larg / 2} y={H - 6} textAnchor="middle" className="co-svg-axe">
              {MOIS_COURT[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/**
 * Treemap du profit. Découpage en bandes horizontales successives : rendu
 * proche du treemap Power BI sans dépendance de calcul de pavage.
 */
export const Treemap = ({ lignes = [], onSelect }) => {
  const top = lignes
    .filter((l) => l.profitN > 0)
    .slice(0, 16);
  const total = top.reduce((s, l) => s + l.profitN, 0) || 1;
  const couleurs = [
    "#7c3aed", "#a855f7", "#c084fc", "#6d28d9", "#8b5cf6",
    "#9333ea", "#5b21b6", "#7e22ce",
  ];

  if (!top.length) return <div className="co-empty">Aucun profit à afficher.</div>;

  return (
    <div className="co-treemap">
      {top.map((l, i) => {
        const part = (l.profitN / total) * 100;
        return (
          <button
            type="button"
            key={l.cle}
            className="co-treemap-case"
            style={{
              flexBasis: `${Math.max(6, part)}%`,
              background: couleurs[i % couleurs.length],
            }}
            onClick={() => onSelect && onSelect(l)}
            title={`${l.libelle} — profit ${fmtMontant(l.profitN)} F (${part.toFixed(1)} %)`}
          >
            <span className="co-treemap-lbl">{l.libelle}</span>
            <span className="co-treemap-val">{fmtMontant(l.profitN)}</span>
          </button>
        );
      })}
    </div>
  );
};

const AnalyseVisuels = { CourbeCumul, Waterfall, Treemap };
export default AnalyseVisuels;
