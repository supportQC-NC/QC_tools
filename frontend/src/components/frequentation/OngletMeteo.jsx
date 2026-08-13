// src/components/frequentation/OngletMeteo.jsx
//
// Météo quotidienne servant à l'analyse : état de la collecte automatique
// (job de 23:40, heure de Nouméa), rattrapage d'historique à la demande, et
// correction manuelle d'une journée (la ligne est alors verrouillée).
import React, { useState } from "react";
import {
  HiRefresh,
  HiLockClosed,
  HiLockOpen,
  HiPencil,
  HiCheck,
  HiX,
} from "react-icons/hi";
import {
  useGetMeteoQuery,
  useCollecterMeteoMutation,
  useUpdateMeteoJourMutation,
  useDeverrouillerMeteoJourMutation,
} from "../../slices/frequentationApiSlice";

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const frDate = (v) => {
  if (!v) return "—";
  const [y, m, d] = String(v).split("-");
  return `${d}/${m}/${y}`;
};

const CAT_LABELS = { beau: "Beau", mitige: "Mitigé", pluvieux: "Pluvieux" };

const OngletMeteo = ({ lieuDefaut = "noumea" }) => {
  const ilYa60j = new Date();
  ilYa60j.setDate(ilYa60j.getDate() - 60);

  const [lieu, setLieu] = useState(lieuDefaut);
  const [du, setDu] = useState(iso(ilYa60j));
  const [au, setAu] = useState(iso(new Date()));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editDate, setEditDate] = useState(null);
  const [form, setForm] = useState({});

  const { data, isFetching } = useGetMeteoQuery({ lieu, du, au });
  const [collecter, { isLoading: collecte }] = useCollecterMeteoMutation();
  const [majJour] = useUpdateMeteoJourMutation();
  const [deverrouiller] = useDeverrouillerMeteoJourMutation();

  const jours = data?.jours || [];
  const lieux = data?.lieux || [];

  const lancerCollecte = async () => {
    setError("");
    setMessage("");
    try {
      const r = await collecter({ lieu, du, au }).unwrap();
      setMessage(
        `${r.label} : ${r.enregistres} jour(s) enregistré(s) du ${frDate(r.du)} au ${frDate(
          r.au,
        )}${r.ignores ? ` — ${r.ignores} jour(s) verrouillé(s) conservé(s)` : ""}.`,
      );
    } catch (e) {
      setError(e?.data?.message || "Collecte impossible.");
    }
  };

  const editer = (j) => {
    setEditDate(j.date);
    setForm({
      pluieMm: j.pluieMm ?? 0,
      soleilHeures: j.soleilHeures ?? 0,
      pluieHeures: j.pluieHeures ?? 0,
      libelle: j.libelle || "",
      categorie: j.categorie || "beau",
    });
  };

  const enregistrer = async (date) => {
    setError("");
    try {
      await majJour({ lieu, date, ...form }).unwrap();
      setEditDate(null);
    } catch (e) {
      setError(e?.data?.message || "Enregistrement impossible.");
    }
  };

  return (
    <div className="fq-onglet">
      <div className="fq-form">
        <div className="fq-form-row">
          <div className="fq-field">
            <label htmlFor="me-lieu">Lieu</label>
            <select id="me-lieu" value={lieu} onChange={(e) => setLieu(e.target.value)}>
              {(lieux.length ? lieux : [{ slug: lieu, label: lieu }]).map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="fq-field">
            <label htmlFor="me-du">Du</label>
            <input id="me-du" type="date" value={du} onChange={(e) => setDu(e.target.value)} />
          </div>
          <div className="fq-field">
            <label htmlFor="me-au">Au</label>
            <input id="me-au" type="date" value={au} onChange={(e) => setAu(e.target.value)} />
          </div>
          <div className="fq-form-actions">
            <button
              type="button"
              className="fq-btn fq-btn-primary"
              onClick={lancerCollecte}
              disabled={collecte}
            >
              <HiRefresh className={collecte ? "fq-spin" : ""} />
              {collecte ? "Collecte…" : "Collecter cette période"}
            </button>
          </div>
        </div>
        <p className="fq-form-note">
          Collecte automatique chaque nuit à 23:40 (heure de Nouméa), une fois
          la journée terminée. « Collecter cette période » sert à rattraper de
          l'historique — <strong>le jour en cours n'est jamais enregistré</strong> :
          tant que la journée n'est pas finie, la valeur disponible est une
          prévision (annoncer 7 mm un matin de grand soleil, c'est la pluie
          attendue le soir). Les 3 derniers jours sont marqués « provisoire »
          jusqu'à consolidation. Une valeur corrigée à la main est verrouillée :
          la collecte ne l'écrase plus.
        </p>
      </div>

      {message && <div className="fq-alert fq-alert-ok">{message}</div>}
      {error && <div className="fq-alert fq-alert-err">{error}</div>}

      <div className="fq-table-wrap">
        <table className="fq-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Temps</th>
              <th className="fq-num">Pluie (mm)</th>
              <th className="fq-num">Soleil (h)</th>
              <th className="fq-num">T° min</th>
              <th className="fq-num">T° max</th>
              <th>Catégorie</th>
              <th>Source</th>
              <th className="fq-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isFetching ? (
              <tr>
                <td colSpan={9} className="fq-td-info">
                  <span className="fq-spinner" /> Chargement…
                </td>
              </tr>
            ) : jours.length === 0 ? (
              <tr>
                <td colSpan={9} className="fq-td-info">
                  Aucun relevé sur cette période — lancez une collecte.
                </td>
              </tr>
            ) : (
              jours.map((j) =>
                editDate === j.date ? (
                  <tr key={j.date} className="fq-row-edit">
                    <td>{frDate(j.date)}</td>
                    <td>
                      <input
                        type="text"
                        value={form.libelle}
                        onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                      />
                    </td>
                    <td className="fq-num">
                      <input
                        type="number"
                        step="0.1"
                        value={form.pluieMm}
                        onChange={(e) => setForm({ ...form, pluieMm: e.target.value })}
                      />
                    </td>
                    <td className="fq-num">
                      <input
                        type="number"
                        step="0.1"
                        value={form.soleilHeures}
                        onChange={(e) =>
                          setForm({ ...form, soleilHeures: e.target.value })
                        }
                      />
                    </td>
                    <td colSpan={2} className="fq-muted">
                      (inchangées)
                    </td>
                    <td>
                      <select
                        value={form.categorie}
                        onChange={(e) => setForm({ ...form, categorie: e.target.value })}
                      >
                        {Object.entries(CAT_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>manuel</td>
                    <td className="fq-right">
                      <button
                        type="button"
                        className="fq-btn fq-btn-sm fq-btn-primary"
                        onClick={() => enregistrer(j.date)}
                      >
                        <HiCheck />
                      </button>
                      <button
                        type="button"
                        className="fq-btn fq-btn-sm"
                        onClick={() => setEditDate(null)}
                      >
                        <HiX />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={j.date}>
                    <td className="fq-strong">{frDate(j.date)}</td>
                    <td>{j.libelle || "—"}</td>
                    <td className="fq-num">{j.pluieMm}</td>
                    <td className="fq-num">{j.soleilHeures}</td>
                    <td className="fq-num">{j.tMin ?? "—"}</td>
                    <td className="fq-num">{j.tMax ?? "—"}</td>
                    <td>
                      <span className={`fq-chip fq-chip-${j.categorie}`}>
                        {CAT_LABELS[j.categorie] || j.categorie}
                      </span>
                    </td>
                    <td className="fq-muted">
                      {j.verrouille ? (
                        <span title={`Corrigé par ${j.modifiePar || "—"}`}>
                          <HiLockClosed /> manuel
                        </span>
                      ) : (
                        <>
                          {j.source}
                          {j.provisoire && (
                            <span
                              className="fq-chip fq-chip-provisoire"
                              title="Valeur publiée par le modèle, pas encore consolidée : la collecte nocturne la réajustera."
                            >
                              provisoire
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="fq-right">
                      <button
                        type="button"
                        className="fq-btn fq-btn-sm"
                        onClick={() => editer(j)}
                        title="Corriger cette journée"
                      >
                        <HiPencil />
                      </button>
                      {j.verrouille && (
                        <button
                          type="button"
                          className="fq-btn fq-btn-sm"
                          onClick={() => deverrouiller({ lieu, date: j.date })}
                          title="Déverrouiller (la collecte reprend la main)"
                        >
                          <HiLockOpen />
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OngletMeteo;
