// src/screens/commercial/CommercialClientScreen.jsx
//
// FICHE CLIENT 360° de l'espace commercial : informations, chiffre d'affaires,
// factures, proformas, réservations et commandes spéciales — le tout limité au
// portefeuille du commercial (le serveur refuse un client qui n'est pas le sien).

import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  HiUser,
  HiArrowLeft,
  HiCurrencyDollar,
  HiDocumentReport,
  HiBookmark,
  HiStar,
  HiClipboardList,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  fmtDate,
  Evolution,
  ChipCategorie,
} from "../../components/commercial/CommercialShell";
import { useGetCommercialClientQuery } from "../../slices/commercialApiSlice";
import "./CommercialSpace.css";

const Info = ({ label, valeur }) => (
  <div className="co-info-item">
    <span className="co-info-label">{label}</span>
    <span className="co-info-value">{valeur || "—"}</span>
  </div>
);

// Tableau de documents (proformas / réservations / commandes spéciales).
const TableDocs = ({ docs, vide }) => {
  if (!docs.length) return <div className="co-empty">{vide}</div>;
  return (
    <div className="co-table-wrap">
      <table className="co-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Date</th>
            <th>Objet</th>
            <th>État</th>
            <th className="num">Montant</th>
            <th className="num">Ancienneté</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.numfact}>
              <td>{d.numfact}</td>
              <td>{fmtDate(d.date)}</td>
              <td>{d.texte || "—"}</td>
              <td>
                <ChipCategorie
                  categorie={d.categorie}
                  label={d.etatLabel}
                  labelErp={d.etatLabelErp}
                />
              </td>
              <td className="num">{fmtMontant(d.montant)}</td>
              <td className="num">{fmtNombre(d.joursAnciennete)} j</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ONGLETS = [
  { key: "factures", label: "Factures", icon: HiCurrencyDollar },
  { key: "proformas", label: "Proformas", icon: HiDocumentReport },
  { key: "reservations", label: "Réservations", icon: HiBookmark },
  { key: "speciales", label: "Commandes spéciales", icon: HiStar },
  { key: "preparer", label: "À préparer", icon: HiClipboardList },
];

const CommercialClientScreen = () => {
  const { dossier, tiers } = useParams();
  const { societes } = useSocietesCommerciales();
  const [onglet, setOnglet] = useState("factures");

  const { data, isFetching, isError, error } = useGetCommercialClientQuery({
    dossier,
    tiers,
  });

  const client = data?.client;
  const kpi = data?.kpi;
  const maxMois = Math.max(1, ...((kpi?.mois || []).map((m) => Math.abs(m))));

  return (
    <CommercialShell
      titre={client ? client.nom || `Client ${tiers}` : `Client ${tiers}`}
      sousTitre="Fiche client — toutes ses opérations sur cette société."
      icone={HiUser}
      societes={societes}
      dossier={dossier}
      sansSociete
      actions={
        <Link className="co-btn" to="/commercial/clients">
          <HiArrowLeft /> Retour au portefeuille
        </Link>
      }
    >
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger cette fiche client."}
        </div>
      )}

      <div className="co-body">
        {isFetching && <div className="co-loading">Chargement de la fiche…</div>}

        {client && (
          <>
            <div className="co-kpis">
              <div className="co-kpi">
                <span className="co-kpi-label">CA {kpi.anneeN}</span>
                <span className="co-kpi-value">{fmtMontant(kpi.caN)}</span>
                <span className="co-kpi-sub">
                  <Evolution valeur={kpi.evolCA} /> vs {fmtMontant(kpi.caN1)}
                </span>
              </div>
              <div className="co-kpi">
                <span className="co-kpi-label">Marge</span>
                <span className="co-kpi-value">{fmtMontant(kpi.margeN)}</span>
                <span className="co-kpi-sub">
                  {(kpi.pctMarge || 0).toFixed(1)} % du CA
                </span>
              </div>
              <div className="co-kpi">
                <span className="co-kpi-label">Factures</span>
                <span className="co-kpi-value">{fmtNombre(kpi.nbFacture)}</span>
                <span className="co-kpi-sub">
                  {fmtNombre(kpi.nbFactureN1)} l'an dernier
                </span>
              </div>
              <div
                className={`co-kpi ${
                  kpi.joursSansAchat === null || kpi.joursSansAchat >= 90
                    ? "alerte"
                    : "ok"
                }`}
              >
                <span className="co-kpi-label">Dernier achat</span>
                <span className="co-kpi-value">
                  {kpi.derniereVente ? fmtDate(kpi.derniereVente) : "—"}
                </span>
                <span className="co-kpi-sub">
                  {kpi.joursSansAchat === null
                    ? "aucun achat enregistré"
                    : `il y a ${fmtNombre(kpi.joursSansAchat)} jours`}
                </span>
              </div>
              <div className="co-kpi">
                <span className="co-kpi-label">Part de mon portefeuille</span>
                <span className="co-kpi-value">
                  {(kpi.tauxContribution || 0).toFixed(1)} %
                </span>
                <span className="co-kpi-sub">de mon CA total</span>
              </div>
            </div>

            <div className="co-grid-2">
              <section className="co-card">
                <div className="co-card-head">
                  <h2>
                    <HiUser /> Informations
                  </h2>
                  <span className="co-chip co-chip-muted">
                    code client {client.tiers}
                  </span>
                </div>
                <div className="co-card-body">
                  <div className="co-fiche-infos">
                    <Info label="Nom" valeur={client.nom} />
                    <Info label="Contact" valeur={client.contact} />
                    <Info label="Téléphone" valeur={client.telephone} />
                    <Info label="Email" valeur={client.email} />
                    <Info label="Adresse" valeur={client.adresse} />
                    <Info label="Ville" valeur={client.ville} />
                    <Info label="Catégorie" valeur={client.categorie} />
                    <Info label="Profession" valeur={client.profession} />
                    <Info label="RIDET" valeur={client.ridet} />
                    <Info
                      label="Remise"
                      valeur={client.remise ? `${client.remise} %` : "—"}
                    />
                    <Info
                      label="Encours"
                      valeur={
                        client.encours ? `${fmtMontant(client.encours)} F` : "—"
                      }
                    />
                    <Info
                      label="Plafond"
                      valeur={
                        client.plafond ? `${fmtMontant(client.plafond)} F` : "—"
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="co-card">
                <div className="co-card-head">
                  <h2>
                    <HiCurrencyDollar /> CA mensuel {kpi.anneeN}
                  </h2>
                </div>
                <div className="co-card-body">
                  <div className="co-bars">
                    {(kpi.mois || []).map((m, i) => (
                      <div className="co-bar-col" key={i}>
                        <div
                          className="co-bar"
                          style={{
                            height: `${Math.max(2, (Math.abs(m) / maxMois) * 100)}%`,
                          }}
                          title={`${fmtMontant(m)} F`}
                        />
                        <span className="co-bar-label">
                          {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <section className="co-card">
              <div className="co-card-head">
                <div className="co-tabs">
                  {ONGLETS.map(({ key, label, icon: I }) => {
                    const n =
                      key === "factures"
                        ? data.totalFactures
                        : key === "speciales"
                          ? data.commandesSpeciales.length
                          : (data[key] || []).length;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`co-tab ${onglet === key ? "active" : ""}`}
                        onClick={() => setOnglet(key)}
                      >
                        <I /> {label} ({fmtNombre(n)})
                      </button>
                    );
                  })}
                </div>
              </div>

              {onglet === "factures" &&
                (data.factures.length === 0 ? (
                  <div className="co-empty">Aucune facture pour ce client.</div>
                ) : (
                  <div className="co-table-wrap">
                    <table className="co-table">
                      <thead>
                        <tr>
                          <th>N°</th>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Objet</th>
                          <th className="num">Montant</th>
                          <th>Vendeur</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.factures.map((f) => (
                          <tr key={`${f.numfact}-${f.date}`}>
                            <td>{f.numfact}</td>
                            <td>{fmtDate(f.date)}</td>
                            <td>
                              <span
                                className={`co-chip ${
                                  f.typfact === "A"
                                    ? "co-chip-danger"
                                    : "co-chip-preparer"
                                }`}
                              >
                                {f.typfact === "A" ? "Avoir" : "Facture"}
                              </span>
                            </td>
                            <td>{f.texte || "—"}</td>
                            <td className="num">{fmtMontant(f.montant)}</td>
                            <td>
                              {f.parAutre ? (
                                <span
                                  className="co-chip co-chip-muted"
                                  title="Vente réalisée par un autre représentant"
                                >
                                  autre ({f.repres})
                                </span>
                              ) : (
                                <span className="co-chip co-chip-devis">moi</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

              {onglet === "proformas" && (
                <TableDocs docs={data.proformas} vide="Aucune proforma." />
              )}
              {onglet === "reservations" && (
                <TableDocs
                  docs={data.reservations}
                  vide="Aucune réservation en cours."
                />
              )}
              {onglet === "speciales" && (
                <TableDocs
                  docs={data.commandesSpeciales}
                  vide="Aucune commande spéciale."
                />
              )}
              {onglet === "preparer" && (
                <TableDocs
                  docs={data.aPreparer}
                  vide="Aucune commande à préparer."
                />
              )}
            </section>
          </>
        )}
      </div>
    </CommercialShell>
  );
};

export default CommercialClientScreen;
