// src/components/frequentation/OngletEvenements.jsx
//
// Saisie manuelle des ÉVÉNEMENTS SPÉCIAUX (grève, blocage, cyclone, jour
// férié, opération commerciale…) qui expliquent les creux et les pics de
// fréquentation. Un événement peut viser toutes les sociétés ou seulement
// certaines (un blocage de route ne concerne pas tous les magasins).
import React, { useState } from "react";
import { HiPlus, HiTrash, HiPencil, HiX, HiCheck, HiCalendar } from "react-icons/hi";
import {
  useGetEvenementsQuery,
  useGetEvenementTypesQuery,
  useCreateEvenementMutation,
  useUpdateEvenementMutation,
  useDeleteEvenementMutation,
  useGenererFeriesMutation,
} from "../../slices/frequentationApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";

const frDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
};

const IMPACT_LABELS = {
  fermeture: "Fermeture",
  perturbation: "Perturbation",
  hausse: "Hausse d'activité",
  aucun: "Aucun",
};

const VIDE = {
  libelle: "",
  type: "greve",
  dateDebut: "",
  dateFin: "",
  heureDebut: "",
  heureFin: "",
  impact: "perturbation",
  exclure: false,
  entreprises: [],
  commentaire: "",
};

const OngletEvenements = () => {
  const { data: evenements = [], isFetching } = useGetEvenementsQuery();
  const { data: refs } = useGetEvenementTypesQuery();
  const { data: entreprises = [] } = useGetMyEntreprisesQuery();
  const [creer, { isLoading: creation }] = useCreateEvenementMutation();
  const [modifier] = useUpdateEvenementMutation();
  const [supprimer] = useDeleteEvenementMutation();
  const [genererFeries, { isLoading: generationFeries }] = useGenererFeriesMutation();

  const [form, setForm] = useState(VIDE);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [anneeFeries, setAnneeFeries] = useState(new Date().getFullYear());

  const types = refs?.types || [];
  const impacts = refs?.impacts || [];

  const set = (champ) => (e) => setForm({ ...form, [champ]: e.target.value });

  const basculerEntreprise = (id) => {
    const deja = form.entreprises.includes(id);
    setForm({
      ...form,
      entreprises: deja
        ? form.entreprises.filter((x) => x !== id)
        : [...form.entreprises, id],
    });
  };

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

  const editer = (ev) => {
    setEditId(ev._id);
    setForm({
      libelle: ev.libelle,
      type: ev.type,
      dateDebut: ev.dateDebut,
      dateFin: ev.dateFin,
      heureDebut: ev.heureDebut || "",
      heureFin: ev.heureFin || "",
      impact: ev.impact,
      exclure: !!ev.exclure,
      entreprises: (ev.entreprises || []).map((x) => x._id || x),
      commentaire: ev.commentaire || "",
    });
  };

  const retirer = async (ev) => {
    setError("");
    try {
      await supprimer(ev._id).unwrap();
      if (editId === ev._id) reinitialiser();
    } catch (err) {
      setError(err?.data?.message || "Suppression impossible.");
    }
  };

  const ajouterFeries = async () => {
    setError("");
    setMessage("");
    try {
      const r = await genererFeries({ annee: Number(anneeFeries) }).unwrap();
      setMessage(
        `Jours fériés ${r.annee} : ${r.crees} ajouté(s)` +
          (r.existants ? `, ${r.existants} déjà présent(s).` : "."),
      );
    } catch (err) {
      setError(err?.data?.message || "Génération des jours fériés impossible.");
    }
  };

  return (
    <div className="fq-onglet">
      <div className="fq-form fq-form-inline">
        <div className="fq-field">
          <label htmlFor="ev-annee">Jours fériés (Nouvelle-Calédonie)</label>
          <div className="fq-inline">
            <input
              id="ev-annee"
              type="number"
              min="2000"
              max="2100"
              value={anneeFeries}
              onChange={(e) => setAnneeFeries(e.target.value)}
            />
            <button
              type="button"
              className="fq-btn"
              onClick={ajouterFeries}
              disabled={generationFeries}
            >
              <HiCalendar />
              {generationFeries ? "Ajout…" : "Ajouter les jours fériés de l'année"}
            </button>
          </div>
        </div>
        <p className="fq-form-note">
          Ajoute les 12 fériés légaux de l'année (dont Pâques, Ascension,
          Pentecôte et la Fête de la Citoyenneté), sans doublon. Chacun reste
          modifiable ou supprimable ci-dessous.
        </p>
      </div>

      {message && <div className="fq-alert fq-alert-ok">{message}</div>}

      <form className="fq-form" onSubmit={enregistrer}>
        <div className="fq-form-row">
          <div className="fq-field fq-grow">
            <label htmlFor="ev-libelle">Libellé</label>
            <input
              id="ev-libelle"
              type="text"
              placeholder="Blocage RT1 / Cyclone Nikita…"
              value={form.libelle}
              onChange={set("libelle")}
            />
          </div>
          <div className="fq-field">
            <label htmlFor="ev-type">Type</label>
            <select id="ev-type" value={form.type} onChange={set("type")}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="fq-field">
            <label htmlFor="ev-debut">Du</label>
            <input id="ev-debut" type="date" value={form.dateDebut} onChange={set("dateDebut")} />
          </div>
          <div className="fq-field">
            <label htmlFor="ev-fin">Au</label>
            <input id="ev-fin" type="date" value={form.dateFin} onChange={set("dateFin")} />
          </div>
          <div className="fq-field">
            <label htmlFor="ev-hdeb">De (h)</label>
            <input
              id="ev-hdeb"
              type="time"
              value={form.heureDebut}
              onChange={set("heureDebut")}
              title="Laisser vide pour des journées entières"
            />
          </div>
          <div className="fq-field">
            <label htmlFor="ev-hfin">À (h)</label>
            <input
              id="ev-hfin"
              type="time"
              value={form.heureFin}
              onChange={set("heureFin")}
              title="Laisser vide pour des journées entières"
            />
          </div>
          <div className="fq-field">
            <label htmlFor="ev-impact">Effet attendu</label>
            <select id="ev-impact" value={form.impact} onChange={set("impact")}>
              {impacts.map((i) => (
                <option key={i} value={i}>
                  {IMPACT_LABELS[i] || i}
                </option>
              ))}
            </select>
          </div>
          <label className="fq-check" title="Les ventes de cette fenêtre sortent des moyennes, des tranches horaires et de la carte de chaleur. Elles restent comptées dans le récapitulatif de l'événement.">
            <input
              type="checkbox"
              checked={form.exclure}
              onChange={(e) => setForm({ ...form, exclure: e.target.checked })}
            />
            <span>Exclure de l'analyse</span>
          </label>
        </div>

        <div className="fq-form-row">
          <div className="fq-field fq-grow">
            <label>Sociétés concernées (aucune cochée = toutes)</label>
            <div className="fq-chips">
              {entreprises.map((e) => (
                <button
                  key={e._id}
                  type="button"
                  className={`fq-chip-btn ${
                    form.entreprises.includes(e._id) ? "fq-chip-on" : ""
                  }`}
                  onClick={() => basculerEntreprise(e._id)}
                >
                  {e.trigramme || e.nomComplet}
                </button>
              ))}
            </div>
          </div>
          <div className="fq-field fq-grow">
            <label htmlFor="ev-com">Commentaire</label>
            <input
              id="ev-com"
              type="text"
              value={form.commentaire}
              onChange={set("commentaire")}
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
              <th>Type</th>
              <th>Du</th>
              <th>Au</th>
              <th>Horaire</th>
              <th>Effet</th>
              <th>Analyse</th>
              <th>Sociétés</th>
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
            ) : evenements.length === 0 ? (
              <tr>
                <td colSpan={9} className="fq-td-info">
                  Aucun événement enregistré (grève, blocage, cyclone…).
                </td>
              </tr>
            ) : (
              evenements.map((ev) => (
                <tr key={ev._id}>
                  <td className="fq-strong">{ev.libelle}</td>
                  <td>
                    <span className={`fq-chip fq-chip-${ev.type}`}>
                      {types.find((t) => t.value === ev.type)?.label || ev.type}
                    </span>
                  </td>
                  <td>{frDate(ev.dateDebut)}</td>
                  <td>{frDate(ev.dateFin)}</td>
                  <td className="fq-muted">
                    {ev.heureDebut || ev.heureFin
                      ? `${ev.heureDebut || "00:00"} → ${ev.heureFin || "23:59"}`
                      : "journée entière"}
                  </td>
                  <td>{IMPACT_LABELS[ev.impact] || ev.impact}</td>
                  <td>
                    {ev.exclure ? (
                      <span className="fq-chip fq-chip-exclu">exclu</span>
                    ) : (
                      <span className="fq-muted">inclus</span>
                    )}
                  </td>
                  <td>
                    {(ev.entreprises || []).length === 0
                      ? "Toutes"
                      : ev.entreprises
                          .map((e) => e.trigramme || e.nomComplet || "?")
                          .join(", ")}
                  </td>
                  <td className="fq-right">
                    <button
                      type="button"
                      className="fq-btn fq-btn-sm"
                      onClick={() => editer(ev)}
                      title="Modifier"
                    >
                      <HiPencil />
                    </button>
                    <button
                      type="button"
                      className="fq-btn fq-btn-sm fq-btn-danger"
                      onClick={() => retirer(ev)}
                      title="Supprimer"
                    >
                      <HiTrash />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OngletEvenements;
