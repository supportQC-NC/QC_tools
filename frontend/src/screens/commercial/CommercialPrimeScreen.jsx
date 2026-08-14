// src/screens/commercial/CommercialPrimeScreen.jsx
//
// MA PRIME — portage de la page « Suivi Prime » du rapport Power BI.
//
// Dans le rapport, le taux était une constante DAX propre à chaque commercial
// (`IF(NOM="CAMELIA", 0.015, 0)`), d'où un fichier par personne. Ici chaque
// commercial saisit lui-même son taux, son assiette et ses paliers fournisseur ;
// il ne voit que les siens.
//
// ⚠️ Outil de suivi et de simulation — ce n'est pas un bulletin de paie.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  HiCurrencyDollar,
  HiRefresh,
  HiCog,
  HiCheckCircle,
  HiTrendingUp,
  HiPlus,
  HiTrash,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  Evolution,
} from "../../components/commercial/CommercialShell";
import {
  useGetCommercialPrimeQuery,
  useGetCommercialPrimeConfigQuery,
  useUpdateCommercialPrimeConfigMutation,
} from "../../slices/commercialApiSlice";
import "./CommercialSpace.css";

const MOIS = [
  "Toute l'année",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const CommercialPrimeScreen = () => {
  const { societes, dossier, setDossier } = useSocietesCommerciales();
  const [mois, setMois] = useState(0);
  const [config, setConfig] = useState(null);
  const [ouvertConfig, setOuvertConfig] = useState(false);
  const [message, setMessage] = useState("");

  const { data, isFetching, isError, error, refetch } =
    useGetCommercialPrimeQuery({ dossier, mois }, { skip: !dossier });
  const { data: configServeur } = useGetCommercialPrimeConfigQuery(
    { dossier },
    { skip: !dossier },
  );
  const [enregistrer, { isLoading: enCours }] =
    useUpdateCommercialPrimeConfigMutation();

  useEffect(() => {
    if (configServeur) {
      setConfig({
        taux: (configServeur.taux || 0) * 100, // saisi en %
        assiette: configServeur.assiette || "marge",
        code: configServeur.fournisseurPrime?.code || "",
        libelle: configServeur.fournisseurPrime?.libelle || "",
        surTouteLaSociete:
          configServeur.fournisseurPrime?.surTouteLaSociete !== false,
        paliers: configServeur.fournisseurPrime?.paliers || [],
      });
    }
  }, [configServeur]);

  const majPalier = (i, champ, valeur) =>
    setConfig((c) => ({
      ...c,
      paliers: c.paliers.map((p, j) =>
        j === i ? { ...p, [champ]: Number(valeur) || 0 } : p,
      ),
    }));

  const sauvegarder = async () => {
    setMessage("");
    await enregistrer({
      dossier,
      taux: (Number(config.taux) || 0) / 100,
      assiette: config.assiette,
      fournisseurPrime: {
        code: config.code,
        libelle: config.libelle,
        surTouteLaSociete: config.surTouteLaSociete,
        paliers: config.paliers,
      },
    }).unwrap();
    setMessage("Paramètres enregistrés.");
    refetch();
  };

  const p = data;
  const f = p?.fournisseur;

  return (
    <CommercialShell
      titre="Ma prime"
      sousTitre="Suivi et simulation de ma prime — paramètres personnels, visibles de moi seul."
      icone={HiCurrencyDollar}
      societes={societes}
      dossier={dossier}
      onDossier={setDossier}
      actions={
        <>
          <button
            type="button"
            className="co-btn"
            onClick={() => setOuvertConfig((v) => !v)}
          >
            <HiCog /> Mes paramètres
          </button>
          <button
            type="button"
            className="co-btn"
            onClick={() => dossier && refetch()}
            disabled={isFetching || !dossier}
          >
            <HiRefresh /> Actualiser
          </button>
        </>
      }
    >
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de calculer la prime."}
        </div>
      )}

      <div className="co-body">
        {/* ── Paramétrage personnel ── */}
        {ouvertConfig && config && (
          <section className="co-card">
            <div className="co-card-head">
              <h2>
                <HiCog /> Mes paramètres de prime
              </h2>
              {message && <span className="co-hint">{message}</span>}
            </div>
            <div className="co-card-body">
              <div className="co-toolbar" style={{ borderBottom: "none", padding: 0 }}>
                <div className="co-field">
                  <label htmlFor="co-taux">Taux (%)</label>
                  <input
                    id="co-taux"
                    type="number"
                    step="0.01"
                    value={config.taux}
                    onChange={(e) =>
                      setConfig({ ...config, taux: e.target.value })
                    }
                  />
                </div>
                <div className="co-field">
                  <label htmlFor="co-assiette">Assiette</label>
                  <select
                    id="co-assiette"
                    value={config.assiette}
                    onChange={(e) =>
                      setConfig({ ...config, assiette: e.target.value })
                    }
                  >
                    <option value="marge">Marge (CA − coût de revient)</option>
                    <option value="ca">CA HT net</option>
                  </select>
                </div>
                <div className="co-field">
                  <label htmlFor="co-fourn">Fournisseur primé (code)</label>
                  <input
                    id="co-fourn"
                    type="text"
                    placeholder="ex. 24"
                    value={config.code}
                    onChange={(e) =>
                      setConfig({ ...config, code: e.target.value })
                    }
                  />
                </div>
                <div className="co-field">
                  <label htmlFor="co-fourn-lib">Libellé</label>
                  <input
                    id="co-fourn-lib"
                    type="text"
                    placeholder="ex. BLUM"
                    value={config.libelle}
                    onChange={(e) =>
                      setConfig({ ...config, libelle: e.target.value })
                    }
                  />
                </div>
              </div>

              <p className="co-hint" style={{ marginTop: "0.75rem" }}>
                Paliers de la prime fournisseur, évalués sur la marge{" "}
                <strong>du mois</strong>
                {config.surTouteLaSociete
                  ? " réalisée par toute la société"
                  : " réalisée sur mon portefeuille"}
                .
              </p>

              <div className="co-table-wrap">
                <table className="co-table">
                  <thead>
                    <tr>
                      <th className="num">À partir d'une marge de</th>
                      <th className="num">Prime</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {config.paliers.map((pa, i) => (
                      <tr key={i}>
                        <td className="num">
                          <input
                            type="number"
                            value={pa.seuil}
                            onChange={(e) =>
                              majPalier(i, "seuil", e.target.value)
                            }
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            value={pa.montant}
                            onChange={(e) =>
                              majPalier(i, "montant", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="co-btn"
                            onClick={() =>
                              setConfig({
                                ...config,
                                paliers: config.paliers.filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                          >
                            <HiTrash />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="co-btn"
                  onClick={() =>
                    setConfig({
                      ...config,
                      paliers: [...config.paliers, { seuil: 0, montant: 0 }],
                    })
                  }
                >
                  <HiPlus /> Ajouter un palier
                </button>
                <button
                  type="button"
                  className="co-btn co-btn-primary"
                  onClick={sauvegarder}
                  disabled={enCours}
                >
                  <HiCheckCircle /> Enregistrer
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Indicateurs ── */}
        {isFetching && !p && (
          <div className="co-loading">Calcul de la prime en cours…</div>
        )}

        {p && (
          <>
            <div className="co-kpis">
              <div className="co-kpi ok">
                <span className="co-kpi-label">
                  <HiCurrencyDollar /> Prime totale
                </span>
                <span className="co-kpi-value">
                  {fmtMontant(p.primeTotale)} F
                </span>
                <span className="co-kpi-sub">
                  {p.mois ? MOIS[p.mois] : `année ${p.annee}`}
                </span>
              </div>
              <div className="co-kpi">
                <span className="co-kpi-label">Prime sur portefeuille</span>
                <span className="co-kpi-value">
                  {fmtMontant(p.portefeuille.prime)} F
                </span>
                <span className="co-kpi-sub">
                  <Evolution valeur={p.portefeuille.evolutionPct} /> vs N-1 (
                  {fmtMontant(p.portefeuille.primeN1)})
                </span>
              </div>
              {f && (
                <div className={`co-kpi ${f.prime > 0 ? "ok" : "alerte"}`}>
                  <span className="co-kpi-label">
                    <HiTrendingUp /> Prime {f.libelle}
                  </span>
                  <span className="co-kpi-value">{fmtMontant(f.prime)} F</span>
                  <span className="co-kpi-sub">
                    {f.resteAAtteindre > 0 && f.palierSuivant
                      ? `encore ${fmtMontant(f.resteAAtteindre)} F de marge ce mois pour ${fmtMontant(f.palierSuivant.montant)} F`
                      : "palier maximum atteint"}
                  </span>
                </div>
              )}
              {f && (
                <>
                  <div className="co-kpi">
                    <span className="co-kpi-label">CA HT net {f.libelle}</span>
                    <span className="co-kpi-value">{fmtMontant(f.caHT)}</span>
                    <span className="co-kpi-sub">
                      {f.surTouteLaSociete ? "toute la société" : "mon portefeuille"}
                    </span>
                  </div>
                  <div className="co-kpi">
                    <span className="co-kpi-label">Marge brute {f.libelle}</span>
                    <span className="co-kpi-value">{fmtMontant(f.marge)}</span>
                    <span className="co-kpi-sub">
                      mois en cours : {fmtMontant(f.moisCourant?.marge || 0)}
                    </span>
                  </div>
                </>
              )}
              <div className="co-kpi">
                <span className="co-kpi-label">Assiette</span>
                <span className="co-kpi-value">
                  {fmtMontant(
                    p.config.assiette === "ca"
                      ? p.portefeuille.caN
                      : p.portefeuille.profitN,
                  )}
                </span>
                <span className="co-kpi-sub">
                  {p.config.assiette === "ca" ? "CA HT net" : "marge"} ·{" "}
                  {(p.config.taux * 100).toFixed(2)} % · taux effectif{" "}
                  {p.portefeuille.tauxEffectifPct.toFixed(2)} %
                </span>
              </div>
            </div>

            <section className="co-card">
              <div className="co-toolbar">
                <div className="co-field">
                  <label htmlFor="co-pr-mois">Période</label>
                  <select
                    id="co-pr-mois"
                    value={mois}
                    onChange={(e) => setMois(Number(e.target.value))}
                  >
                    {MOIS.map((m, i) => (
                      <option key={i} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginLeft: "auto" }} className="co-hint">
                  {fmtNombre(p.portefeuille.nbClients)} clients ·{" "}
                  {p.config.taux === 0 &&
                    "⚠️ taux à 0 : renseignez vos paramètres"}
                </div>
              </div>

              <div className="co-table-wrap">
                <table className="co-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th className="num">CA HT net</th>
                      <th className="num">Profit</th>
                      <th className="num">Assiette</th>
                      <th className="num">Prime</th>
                      <th className="num">Prime N-1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lignes.map((l) => (
                      <tr key={l.cle}>
                        <td>
                          <Link to={`/commercial/clients/${dossier}/${l.cle}`}>
                            {l.libelle}
                          </Link>
                        </td>
                        <td className="num">{fmtMontant(l.caN)}</td>
                        <td className="num">{fmtMontant(l.profitN)}</td>
                        <td className="num">{fmtMontant(l.basePrime)}</td>
                        <td className="num">
                          <strong>{fmtMontant(l.prime)}</strong>
                        </td>
                        <td className="num">{fmtMontant(l.primeN1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Détail mensuel de la prime fournisseur */}
            {f && f.detailMois && (
              <section className="co-card">
                <div className="co-card-head">
                  <h2>
                    <HiTrendingUp /> {f.libelle} — marge et palier par mois
                  </h2>
                  <span className="co-hint">
                    {f.surTouteLaSociete
                      ? "marge de toute la société"
                      : "marge de mon portefeuille"}
                  </span>
                </div>
                <div className="co-table-wrap">
                  <table className="co-table">
                    <thead>
                      <tr>
                        <th>Mois</th>
                        <th className="num">Marge</th>
                        <th className="num">Prime</th>
                        <th className="num">Reste pour le palier suivant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.detailMois
                        .filter((d) => d.marge !== 0)
                        .map((d) => (
                          <tr
                            key={d.mois}
                            className={d.prime === 0 ? "co-row-alerte" : ""}
                          >
                            <td>{MOIS[d.mois]}</td>
                            <td className="num">{fmtMontant(d.marge)}</td>
                            <td className="num">
                              <strong>{fmtMontant(d.prime)}</strong>
                            </td>
                            <td className="num">
                              {d.palierSuivant
                                ? `${fmtMontant(d.resteAAtteindre)} → ${fmtMontant(d.palierSuivant.montant)} F`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </CommercialShell>
  );
};

export default CommercialPrimeScreen;
