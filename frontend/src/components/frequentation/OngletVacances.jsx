// src/components/frequentation/OngletVacances.jsx
//
// Saisie manuelle des périodes de VACANCES SCOLAIRES (calendrier commun à la
// Nouvelle-Calédonie), utilisées par l'analyse de fréquentation pour mesurer
// leur impact sur le magasin.
import React, { useState } from "react";
import { HiPlus, HiTrash, HiPencil, HiX, HiCheck } from "react-icons/hi";
import {
  useGetVacancesQuery,
  useCreateVacancesMutation,
  useUpdateVacancesMutation,
  useDeleteVacancesMutation,
} from "../../slices/frequentationApiSlice";

const frDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
};

const VIDE = { libelle: "", dateDebut: "", dateFin: "", anneeScolaire: "", commentaire: "" };

const OngletVacances = () => {
  const { data: periodes = [], isFetching } = useGetVacancesQuery();
  const [creer, { isLoading: creation }] = useCreateVacancesMutation();
  const [modifier] = useUpdateVacancesMutation();
  const [supprimer] = useDeleteVacancesMutation();

  const [form, setForm] = useState(VIDE);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");

  const set = (champ) => (e) => setForm({ ...form, [champ]: e.target.value });

  const reinitialiser = () => {
    setForm(VIDE);
    setEditId(null);
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.libelle.trim() || !form.dateDebut || !form.dateFin) {
      setError("Libellé, date de début et date de fin sont obligatoires.");
      return;
    }
    try {
      if (editId) await modifier({ id: editId, ...form }).unwrap();
      else await creer(form).unwrap();
      reinitialiser();
    } catch (err) {
      setError(err?.data?.message || "Enregistrement impossible.");
    }
  };

  const editer = (p) => {
    setEditId(p._id);
    setForm({
      libelle: p.libelle,
      dateDebut: p.dateDebut,
      dateFin: p.dateFin,
      anneeScolaire: p.anneeScolaire || "",
      commentaire: p.commentaire || "",
    });
  };

  const retirer = async (p) => {
    setError("");
    try {
      await supprimer(p._id).unwrap();
      if (editId === p._id) reinitialiser();
    } catch (err) {
      setError(err?.data?.message || "Suppression impossible.");
    }
  };

  return (
    <div className="fq-onglet">
      <form className="fq-form" onSubmit={enregistrer}>
        <div className="fq-form-row">
          <div className="fq-field fq-grow">
            <label htmlFor="vac-libelle">Libellé</label>
            <input
              id="vac-libelle"
              type="text"
              placeholder="Vacances de juillet"
              value={form.libelle}
              onChange={set("libelle")}
            />
          </div>
          <div className="fq-field">
            <label htmlFor="vac-debut">Du</label>
            <input id="vac-debut" type="date" value={form.dateDebut} onChange={set("dateDebut")} />
          </div>
          <div className="fq-field">
            <label htmlFor="vac-fin">Au</label>
            <input id="vac-fin" type="date" value={form.dateFin} onChange={set("dateFin")} />
          </div>
          <div className="fq-field">
            <label htmlFor="vac-annee">Année scolaire</label>
            <input
              id="vac-annee"
              type="text"
              placeholder="2026"
              value={form.anneeScolaire}
              onChange={set("anneeScolaire")}
            />
          </div>
          <div className="fq-form-actions">
            <button type="submit" className="fq-btn fq-btn-primary" disabled={creation}>
              {editId ? <HiCheck /> : <HiPlus />}
              {editId ? "Enregistrer" : "Ajouter"}
            </button>
            {editId && (
              <button type="button" className="fq-btn" onClick={reinitialiser}>
                <HiX /> Annuler
              </button>
            )}
          </div>
        </div>
      </form>

      {error && <div className="fq-alert fq-alert-err">{error}</div>}

      <div className="fq-table-wrap">
        <table className="fq-table">
          <thead>
            <tr>
              <th>Libellé</th>
              <th>Du</th>
              <th>Au</th>
              <th>Année scolaire</th>
              <th className="fq-num">Jours</th>
              <th className="fq-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isFetching ? (
              <tr>
                <td colSpan={6} className="fq-td-info">
                  <span className="fq-spinner" /> Chargement…
                </td>
              </tr>
            ) : periodes.length === 0 ? (
              <tr>
                <td colSpan={6} className="fq-td-info">
                  Aucune période enregistrée. Saisissez les vacances scolaires de
                  l'année pour mesurer leur impact.
                </td>
              </tr>
            ) : (
              periodes.map((p) => {
                const nbJours =
                  Math.round(
                    (new Date(p.dateFin) - new Date(p.dateDebut)) / 86400000,
                  ) + 1;
                return (
                  <tr key={p._id}>
                    <td className="fq-strong">{p.libelle}</td>
                    <td>{frDate(p.dateDebut)}</td>
                    <td>{frDate(p.dateFin)}</td>
                    <td>{p.anneeScolaire || "—"}</td>
                    <td className="fq-num">{nbJours}</td>
                    <td className="fq-right">
                      <button
                        type="button"
                        className="fq-btn fq-btn-sm"
                        onClick={() => editer(p)}
                        title="Modifier"
                      >
                        <HiPencil />
                      </button>
                      <button
                        type="button"
                        className="fq-btn fq-btn-sm fq-btn-danger"
                        onClick={() => retirer(p)}
                        title="Supprimer"
                      >
                        <HiTrash />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OngletVacances;
