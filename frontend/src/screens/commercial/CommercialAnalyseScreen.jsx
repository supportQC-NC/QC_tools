// src/screens/commercial/CommercialAnalyseScreen.jsx
//
// MES ANALYSES — portage des pages « Analyse Fournisseur / Rayons / Clients »
// du rapport Power BI, avec les mêmes visuels :
//   - le PIVOT hiérarchique (3 niveaux dépliables, comme la matrice du rapport)
//   - la COURBE de CA cumulé N vs N-1 (areaChart / TOTALYTD)
//   - le WATERFALL d'évolution du CA par mois
//   - le TREEMAP du profit
//   - les SLICERS croisés (fournisseur, rayon, client, période)
//
// Chaque vue reprend la hiérarchie de la page d'origine ; les chiffres sont
// calculés ligne à ligne depuis detail.dbf (remise déduite) et bornés au
// portefeuille du commercial.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  HiChartBar,
  HiRefresh,
  HiOfficeBuilding,
  HiViewGrid,
  HiUserGroup,
  HiCube,
  HiChevronRight,
  HiChevronDown,
  HiX,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  Evolution,
} from "../../components/commercial/CommercialShell";
import {
  CourbeCumul,
  Waterfall,
  Treemap,
} from "../../components/commercial/AnalyseVisuels";
import {
  useGetCommercialAnalyseQuery,
  useGetCommercialAnalyseFiltresQuery,
} from "../../slices/commercialApiSlice";
import "./CommercialSpace.css";

// Hiérarchies des pages du rapport (matrice à 3 niveaux).
const VUES = [
  {
    key: "fournisseur",
    label: "Fournisseur",
    icon: HiOfficeBuilding,
    hierarchie: ["fournisseur", "rayon", "article"],
  },
  {
    key: "rayon",
    label: "Rayons",
    icon: HiViewGrid,
    hierarchie: ["rayon", "fournisseur", "article"],
  },
  {
    key: "client",
    label: "Clients",
    icon: HiUserGroup,
    hierarchie: ["client", "fournisseur", "article"],
  },
  {
    key: "article",
    label: "Articles",
    icon: HiCube,
    hierarchie: ["article"],
  },
];

const MOIS = [
  "Toute l'année", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// Le filtre à poser pour descendre d'un niveau (la clé du parent).
const filtreDeNiveau = (axe, cle) => {
  if (axe === "fournisseur") return { fournisseur: cle };
  if (axe === "rayon") return { rayon: cle };
  if (axe === "client") return { tiers: cle };
  return {};
};

// Colonnes du pivot — celles de la matrice du rapport.
const Entetes = ({ libelleAxe }) => (
  <thead>
    <tr>
      <th>{libelleAxe}</th>
      <th className="num">Stock</th>
      <th className="num">Transac.</th>
      <th className="num">Quantité</th>
      <th className="num">CA HT net</th>
      <th className="num">Coût revient</th>
      <th className="num">Profit</th>
      <th className="num">Marge</th>
      <th className="num">Évol. CA</th>
      <th className="num">Évol. %</th>
    </tr>
  </thead>
);

const Cellules = ({ l }) => (
  <>
    <td className="num">{fmtNombre(Math.round(l.stockTotal))}</td>
    <td className="num">{fmtNombre(l.nbTransactions)}</td>
    <td className="num">{fmtNombre(Math.round(l.qteN))}</td>
    <td className="num">{fmtMontant(l.caN)}</td>
    <td className="num">{fmtMontant(l.revientN)}</td>
    <td className="num">{fmtMontant(l.profitN)}</td>
    <td className="num">{l.margePct.toFixed(1)} %</td>
    <td className="num">{fmtMontant(l.evolutionCa)}</td>
    <td className="num">
      <Evolution valeur={l.evolutionPct} />
    </td>
  </>
);

/**
 * Un niveau du pivot. Se charge à la demande quand on déplie la ligne parente :
 * on rejoue l'analyse sur l'axe suivant avec le filtre du parent.
 */
const Niveau = ({ dossier, hierarchie, profondeur, filtres, communs }) => {
  const axe = hierarchie[profondeur];
  const [ouvert, setOuvert] = useState({});

  const { data, isFetching } = useGetCommercialAnalyseQuery(
    { dossier, axe, ...communs, ...filtres, limit: 300 },
    { skip: !dossier },
  );

  if (isFetching) {
    return (
      <tr>
        <td colSpan={10} className="co-loading">
          Chargement du niveau « {axe} »…
        </td>
      </tr>
    );
  }

  const lignes = data?.lignes || [];
  if (!lignes.length) {
    return (
      <tr>
        <td colSpan={10} className="co-empty">
          Aucune vente à ce niveau.
        </td>
      </tr>
    );
  }

  const dernier = profondeur >= hierarchie.length - 1;

  return (
    <>
      {lignes.map((l) => (
        <React.Fragment key={`${axe}-${l.cle}`}>
          <tr className={profondeur > 0 ? "co-row-sous" : ""}>
            <td style={{ paddingLeft: `${0.75 + profondeur * 1.4}rem` }}>
              {!dernier ? (
                <button
                  type="button"
                  className="co-expand"
                  onClick={() =>
                    setOuvert((o) => ({ ...o, [l.cle]: !o[l.cle] }))
                  }
                >
                  {ouvert[l.cle] ? <HiChevronDown /> : <HiChevronRight />}
                </button>
              ) : (
                <span className="co-expand-vide" />
              )}
              {axe === "client" && l.cle !== "—" ? (
                <Link to={`/commercial/clients/${dossier}/${l.cle}`}>
                  {l.libelle}
                </Link>
              ) : (
                l.libelle
              )}
            </td>
            <Cellules l={l} />
          </tr>
          {!dernier && ouvert[l.cle] && (
            <Niveau
              dossier={dossier}
              hierarchie={hierarchie}
              profondeur={profondeur + 1}
              filtres={{ ...filtres, ...filtreDeNiveau(axe, l.cle) }}
              communs={communs}
            />
          )}
        </React.Fragment>
      ))}
    </>
  );
};

const CommercialAnalyseScreen = () => {
  const { societes, dossier, setDossier } = useSocietesCommerciales();
  const [vue, setVue] = useState("fournisseur");
  const [mois, setMois] = useState(0);
  const [annee, setAnnee] = useState("");
  // Slicers croisés du rapport.
  const [fFourn, setFFourn] = useState("");
  const [fRayon, setFRayon] = useState("");
  const [fClient, setFClient] = useState("");

  const conf = VUES.find((v) => v.key === vue);
  const communs = {
    mois,
    annee: annee || undefined,
    fournisseur: fFourn || undefined,
    rayon: fRayon || undefined,
    tiers: fClient || undefined,
  };

  // Niveau 1 : sert aussi aux totaux et aux visuels.
  const { data, isFetching, isError, error, refetch } =
    useGetCommercialAnalyseQuery(
      { dossier, axe: conf.hierarchie[0], ...communs, limit: 300 },
      { skip: !dossier },
    );
  const { data: filtres } = useGetCommercialAnalyseFiltresQuery(
    { dossier },
    { skip: !dossier },
  );

  const t = data?.totaux;
  const lignes = data?.lignes || [];
  const actifs = [fFourn, fRayon, fClient].filter(Boolean).length;

  return (
    <CommercialShell
      titre="Mes analyses"
      sousTitre="CA, marge, stock et quantités de mon portefeuille — fournisseur, rayon, client, article."
      icone={HiChartBar}
      societes={societes}
      dossier={dossier}
      onDossier={setDossier}
      actions={
        <button
          type="button"
          className="co-btn"
          onClick={() => dossier && refetch()}
          disabled={isFetching || !dossier}
        >
          <HiRefresh /> Actualiser
        </button>
      }
    >
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger l'analyse."}
        </div>
      )}

      <div className="co-body">
        {/* ── Indicateurs ── */}
        {t && (
          <div className="co-kpis">
            <div className="co-kpi">
              <span className="co-kpi-label">CA HT net {data.annee}</span>
              <span className="co-kpi-value">{fmtMontant(t.caN)}</span>
              <span className="co-kpi-sub">
                <Evolution valeur={t.evolutionPct} /> vs {data.anneeN1} (
                {fmtMontant(t.caN1)})
              </span>
            </div>
            <div className="co-kpi">
              <span className="co-kpi-label">Profit</span>
              <span className="co-kpi-value">{fmtMontant(t.profitN)}</span>
              <span className="co-kpi-sub">
                marge {t.margePct.toFixed(1)} % · revient {fmtMontant(t.revientN)}
              </span>
            </div>
            <div className="co-kpi">
              <span className="co-kpi-label">Transactions</span>
              <span className="co-kpi-value">{fmtNombre(t.nbTransactions)}</span>
              <span className="co-kpi-sub">
                {fmtNombre(Math.round(t.qteN))} unités vendues
              </span>
            </div>
            <div className="co-kpi">
              <span className="co-kpi-label">Produits vendus</span>
              <span className="co-kpi-value">{fmtNombre(t.nbArticles)}</span>
              <span className="co-kpi-sub">
                stock actuel {fmtNombre(Math.round(t.stockTotal))}
              </span>
            </div>
            <div className="co-kpi">
              <span className="co-kpi-label">Portefeuille</span>
              <span className="co-kpi-value">
                {fmtNombre(data.nbClientsPortefeuille)}
              </span>
              <span className="co-kpi-sub">clients à mon nom</span>
            </div>
          </div>
        )}

        {/* ── Slicers ── */}
        <section className="co-card">
          <div className="co-toolbar">
            <div className="co-tabs">
              {VUES.map(({ key, label, icon: I }) => (
                <button
                  key={key}
                  type="button"
                  className={`co-tab ${vue === key ? "active" : ""}`}
                  onClick={() => setVue(key)}
                >
                  <I /> {label}
                </button>
              ))}
            </div>
            <div className="co-field">
              <label htmlFor="co-an-mois">Période</label>
              <select
                id="co-an-mois"
                value={mois}
                onChange={(e) => setMois(Number(e.target.value))}
              >
                {MOIS.map((m, i) => (
                  <option key={i} value={i}>{m}</option>
                ))}
              </select>
            </div>
            <div className="co-field">
              <label htmlFor="co-an-annee">Année</label>
              <select
                id="co-an-annee"
                value={annee}
                onChange={(e) => setAnnee(e.target.value)}
              >
                <option value="">{data?.annee || "en cours"}</option>
                {data?.anneeN1 && (
                  <option value={data.anneeN1}>{data.anneeN1}</option>
                )}
              </select>
            </div>
            <div className="co-field">
              <label htmlFor="co-sl-fourn">Fournisseur</label>
              <select
                id="co-sl-fourn"
                value={fFourn}
                onChange={(e) => setFFourn(e.target.value)}
              >
                <option value="">Tous</option>
                {(filtres?.fournisseurs || []).map((f) => (
                  <option key={f.code} value={f.code}>{f.code}</option>
                ))}
              </select>
            </div>
            <div className="co-field">
              <label htmlFor="co-sl-rayon">Rayon</label>
              <select
                id="co-sl-rayon"
                value={fRayon}
                onChange={(e) => setFRayon(e.target.value)}
              >
                <option value="">Tous</option>
                {(filtres?.rayons || []).map((r) => (
                  <option key={r.code} value={r.code}>{r.code}</option>
                ))}
              </select>
            </div>
            {actifs > 0 && (
              <button
                type="button"
                className="co-btn"
                onClick={() => {
                  setFFourn("");
                  setFRayon("");
                  setFClient("");
                }}
              >
                <HiX /> Effacer les filtres ({actifs})
              </button>
            )}
          </div>

          {/* ── Pivot hiérarchique ── */}
          {isFetching && !data && (
            <div className="co-loading">
              Calcul en cours… (la première analyse construit l'index des lignes
              de facture, les suivantes sont immédiates)
            </div>
          )}

          {data && (
            <div className="co-table-wrap">
              <table className="co-table co-pivot">
                <Entetes libelleAxe={conf.label} />
                <tbody>
                  <Niveau
                    key={`${vue}-${mois}-${annee}-${fFourn}-${fRayon}-${fClient}`}
                    dossier={dossier}
                    hierarchie={conf.hierarchie}
                    profondeur={0}
                    filtres={{}}
                    communs={communs}
                  />
                </tbody>
                {t && (
                  <tfoot>
                    <tr>
                      <td>
                        <strong>Total ({fmtNombre(data.totalLignes)})</strong>
                      </td>
                      <Cellules l={t} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>

        {/* ── Visuels ── */}
        {t && (
          <>
            <div className="co-grid-2">
              <section className="co-card">
                <div className="co-card-head">
                  <h2>
                    <HiChartBar /> CA cumulé {data.annee} vs {data.anneeN1}
                  </h2>
                  <span className="co-hint">trait plein = {data.annee}</span>
                </div>
                <div className="co-card-body">
                  <CourbeCumul
                    cumulN={t.cumulN}
                    cumulN1={t.cumulN1}
                    anneeN={data.annee}
                    anneeN1={data.anneeN1}
                  />
                </div>
              </section>

              <section className="co-card">
                <div className="co-card-head">
                  <h2>
                    <HiChartBar /> Évolution du CA par mois
                  </h2>
                  <span className="co-hint">écart avec {data.anneeN1}</span>
                </div>
                <div className="co-card-body">
                  <Waterfall evolutionMois={t.evolutionMois} />
                </div>
              </section>
            </div>

            <section className="co-card">
              <div className="co-card-head">
                <h2>
                  <HiViewGrid /> Profit par {conf.label.toLowerCase()}
                </h2>
                <span className="co-hint">cliquez pour filtrer</span>
              </div>
              <div className="co-card-body">
                <Treemap
                  lignes={lignes}
                  onSelect={(l) => {
                    if (conf.hierarchie[0] === "fournisseur") setFFourn(l.cle);
                    else if (conf.hierarchie[0] === "rayon") setFRayon(l.cle);
                    else if (conf.hierarchie[0] === "client") setFClient(l.cle);
                  }}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </CommercialShell>
  );
};

export default CommercialAnalyseScreen;
