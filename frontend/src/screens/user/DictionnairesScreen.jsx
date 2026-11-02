// src/screens/user/DictionnairesScreen.jsx
//
// MODULE DICTIONNAIRES — répertoires du personnel de TOUTES les sociétés
// (décision client du 02/11/2026 : aucun scoping société, chaque utilisateur
// ayant le module voit tous les répertoires). Version applicative du
// répertoire papier affiché en magasin : une entrée par personne (nom,
// service, poste interne, tél. extérieur, portable, email) + en-tête standard.
//
// Consultation groupée par service, PDF téléchargeable (reproduction du
// papier), édition en place pour qui a le droit « écriture » (le backend
// refuse sinon). La société se choisit par onglets — PAS le sélecteur global,
// puisque le module est transverse.

import React, { useEffect, useMemo, useState } from "react";
import {
  useGetRepertoiresQuery,
  useUpdateRepertoireMutation,
} from "../../slices/repertoirePersonnelApiSlice";
import { BASE_URL } from "../../constants";
import "./DictionnairesScreen.css";

const CHAMPS = [
  { key: "nom", label: "Nom", large: true },
  { key: "service", label: "Service", large: true },
  { key: "poste", label: "Poste" },
  { key: "telExterieur", label: "Tél. ext." },
  { key: "portable", label: "Portable" },
  { key: "email", label: "Email", large: true },
];

const ligneVide = () => ({
  nom: "",
  service: "",
  poste: "",
  telExterieur: "",
  portable: "",
  email: "",
});

const fmtMaj = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

const DictionnairesScreen = () => {
  const { data: societes = [], isLoading, error } = useGetRepertoiresQuery();
  const [updateRepertoire, { isLoading: enregistrement }] =
    useUpdateRepertoireMutation();

  const [entrepriseId, setEntrepriseId] = useState("");
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState(null); // { standard, note, entrees }
  const [message, setMessage] = useState(null);

  // Première société par défaut.
  useEffect(() => {
    if (!entrepriseId && societes.length > 0) {
      setEntrepriseId(societes[0].entreprise._id);
    }
  }, [societes, entrepriseId]);

  const courant = useMemo(
    () => societes.find((s) => s.entreprise._id === entrepriseId) || null,
    [societes, entrepriseId],
  );
  const repertoire = courant?.repertoire;

  // Regroupement par service, ordre d'apparition.
  const sections = useMemo(() => {
    const out = [];
    const map = new Map();
    for (const e of repertoire?.entrees || []) {
      const s = (e.service || "Autres").trim() || "Autres";
      if (!map.has(s)) {
        map.set(s, []);
        out.push(s);
      }
      map.get(s).push(e);
    }
    return out.map((s) => ({ service: s, entrees: map.get(s) }));
  }, [repertoire]);

  const ouvrirEdition = () => {
    setBrouillon({
      standard: repertoire?.standard || "",
      note: repertoire?.note || "",
      entrees: (repertoire?.entrees || []).map((e) => ({ ...e })),
    });
    setEdition(true);
    setMessage(null);
  };

  const changerLigne = (i, key, value) =>
    setBrouillon((b) => {
      const entrees = b.entrees.map((e, j) => (j === i ? { ...e, [key]: value } : e));
      return { ...b, entrees };
    });

  const enregistrer = async () => {
    try {
      await updateRepertoire({
        entrepriseId,
        standard: brouillon.standard,
        note: brouillon.note,
        entrees: brouillon.entrees.map((e, i) => ({ ...e, ordre: i })),
      }).unwrap();
      setEdition(false);
      setMessage("Répertoire enregistré.");
    } catch (e) {
      setMessage(e?.data?.message || "Enregistrement refusé.");
    }
    setTimeout(() => setMessage(null), 4000);
  };

  const telechargerPdf = () =>
    window.open(
      `${BASE_URL}/api/repertoire-personnel/${entrepriseId}/pdf?download=1`,
      "_blank",
    );

  return (
    <div className="dict-screen">
      <div className="dict-entete">
        <div>
          <h1 className="dict-titre">Dictionnaires — Répertoire du personnel</h1>
          <p className="dict-sous-titre">
            Postes, lignes directes et emails, toutes sociétés confondues.
          </p>
        </div>
        <div className="dict-actions">
          {!edition && repertoire?.entrees?.length > 0 && (
            <button type="button" className="dict-btn primary" onClick={telechargerPdf}>
              ⬇ Télécharger le PDF
            </button>
          )}
          {!edition ? (
            <button type="button" className="dict-btn" onClick={ouvrirEdition}>
              ✎ Modifier
            </button>
          ) : (
            <>
              <button
                type="button"
                className="dict-btn primary"
                onClick={enregistrer}
                disabled={enregistrement}
              >
                {enregistrement ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button type="button" className="dict-btn" onClick={() => setEdition(false)}>
                Annuler
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="dict-erreur">
          {error?.data?.message || "Répertoires indisponibles."}
        </p>
      )}
      {isLoading && <p className="dict-info">Chargement…</p>}
      {message && <p className="dict-message">{message}</p>}

      {/* Onglets sociétés */}
      <div className="dict-onglets">
        {societes.map((s) => (
          <button
            key={s.entreprise._id}
            type="button"
            className={`dict-onglet ${s.entreprise._id === entrepriseId ? "on" : ""}`}
            onClick={() => {
              setEntrepriseId(s.entreprise._id);
              setEdition(false);
              setMessage(null);
            }}
          >
            {s.entreprise.trigramme}
            {!s.repertoire && <span className="dict-onglet-vide"> · vide</span>}
          </button>
        ))}
      </div>

      {courant && !edition && (
        <>
          {(repertoire?.standard || repertoire?.note) && (
            <div className="dict-standard">
              {repertoire?.standard && (
                <div>
                  <strong>STANDARD :</strong> {repertoire.standard}
                </div>
              )}
              {repertoire?.note && <div>{repertoire.note}</div>}
            </div>
          )}

          {sections.length === 0 ? (
            <p className="dict-info">
              Aucun répertoire renseigné pour {courant.entreprise.trigramme} —
              « Modifier » pour le créer.
            </p>
          ) : (
            sections.map((sec) => (
              <div key={sec.service} className="dict-section">
                <h3 className="dict-section-titre">{sec.service}</h3>
                <div className="dict-table-wrap">
                  <table className="dict-table">
                    <thead>
                      <tr>
                        <th className="gauche">Nom</th>
                        <th>Poste</th>
                        <th>Tél. ext.</th>
                        <th>Portable</th>
                        <th className="gauche">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.entrees.map((e, i) => (
                        <tr key={`${e.nom}-${i}`}>
                          <td className="gauche nom">{e.nom}</td>
                          <td>{e.poste || "—"}</td>
                          <td>{e.telExterieur || "—"}</td>
                          <td>{e.portable || "—"}</td>
                          <td className="gauche">
                            {e.email ? (
                              <a href={`mailto:${e.email}`}>{e.email}</a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}

          {repertoire?.majLe && (
            <p className="dict-maj">Mise à jour au {fmtMaj(repertoire.majLe)}.</p>
          )}
        </>
      )}

      {courant && edition && brouillon && (
        <div className="dict-editeur">
          <div className="dict-champs-entete">
            <label>
              Standard
              <input
                type="text"
                value={brouillon.standard}
                placeholder="ex : 27.47.22 - 27.27.00 (n°9)"
                onChange={(e) =>
                  setBrouillon((b) => ({ ...b, standard: e.target.value }))
                }
              />
            </label>
            <label>
              Note (permanence, email général…)
              <input
                type="text"
                value={brouillon.note}
                placeholder="ex : Permanence Midi et Samedi : n°64 · info@…"
                onChange={(e) =>
                  setBrouillon((b) => ({ ...b, note: e.target.value }))
                }
              />
            </label>
          </div>

          <div className="dict-table-wrap">
            <table className="dict-table edition">
              <thead>
                <tr>
                  {CHAMPS.map((c) => (
                    <th key={c.key} className="gauche">
                      {c.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {brouillon.entrees.map((e, i) => (
                  <tr key={i}>
                    {CHAMPS.map((c) => (
                      <td key={c.key} className={c.large ? "large" : ""}>
                        <input
                          type="text"
                          value={e[c.key] || ""}
                          onChange={(ev) => changerLigne(i, c.key, ev.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="dict-btn danger"
                        title="Retirer la ligne"
                        onClick={() =>
                          setBrouillon((b) => ({
                            ...b,
                            entrees: b.entrees.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="dict-btn"
            onClick={() =>
              setBrouillon((b) => ({ ...b, entrees: [...b.entrees, ligneVide()] }))
            }
          >
            + Ajouter une ligne
          </button>
          <p className="dict-info">
            Le « Service » regroupe les lignes à l'affichage et sur le PDF
            (Dock, Magasin, Commerciaux, Import, Support, Comptabilité…).
          </p>
        </div>
      )}
    </div>
  );
};

export default DictionnairesScreen;
