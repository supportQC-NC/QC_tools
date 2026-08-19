// src/screens/user/VeilleScreen.jsx
//
// Module « Veille » : l'utilisateur décrit ce qu'il veut suivre, choisit le jour
// et l'heure, et reçoit chaque semaine un rapport d'actualités mis en page par
// l'IA. Le rapport s'ouvre dans un NOUVEL ONGLET (page HTML autonome servie par
// le backend).
//
// Tout est personnel : chaque utilisateur a ses propres veilles et ses propres
// rapports, personne d'autre ne les voit.
import React, { useEffect, useMemo, useState } from "react";
import {
  HiRss,
  HiPlus,
  HiTrash,
  HiRefresh,
  HiExternalLink,
  HiEye,
  HiClock,
  HiCog,
  HiSparkles,
  HiExclamation,
  HiCheckCircle,
  HiChevronDown,
  HiChevronUp,
  HiGlobeAlt,
} from "react-icons/hi";
import {
  useGetVeilleEtatQuery,
  useGetVeilleConfigsQuery,
  useCreateVeilleConfigMutation,
  useUpdateVeilleConfigMutation,
  useDeleteVeilleConfigMutation,
  useGenererVeilleMutation,
  useGetVeilleRapportsQuery,
  useDeleteVeilleRapportMutation,
} from "../../slices/veilleApiSlice";
import { VEILLE_URL } from "../../constants";
import "./VeilleScreen.css";

const JOURS_LBL = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

// Zones géographiques — la liste fait autorité côté serveur (GET /etat) ;
// celle-ci n'est qu'un repli le temps que la requête réponde.
const ZONES_REPLI = ["Nouvelle-Calédonie", "Pacifique", "France", "Monde entier"];

const fmtDateHeure = (v) =>
  v ? new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

// Champs du formulaire repris tels quels par le backend.
const CHAMPS_FORM = [
  "nom",
  "actif",
  "jour",
  "heure",
  "domaine",
  "zone",
  "thematiques",
  "activite",
  "topX",
  "style",
  "reference",
  "couleurs",
  "typoTexte",
  "typoTitres",
  "promptPersonnalise",
  "qualite",
];

const versFormulaire = (config) => {
  const out = {};
  for (const c of CHAMPS_FORM) out[c] = config?.[c];
  out.couleurs = [...(config?.couleurs || []), "", "", ""].slice(0, 3);
  return out;
};

const VeilleScreen = () => {
  const { data: etat } = useGetVeilleEtatQuery();
  const { data: configs = [], isLoading: chargementConfigs } =
    useGetVeilleConfigsQuery();

  const [creer, { isLoading: creation }] = useCreateVeilleConfigMutation();
  const [maj, { isLoading: sauvegarde }] = useUpdateVeilleConfigMutation();
  const [supprimer] = useDeleteVeilleConfigMutation();
  const [generer, { isLoading: lancement }] = useGenererVeilleMutation();

  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [avance, setAvance] = useState(false);

  const selected = useMemo(
    () => configs.find((c) => c._id === selectedId) || null,
    [configs, selectedId],
  );

  // Sélection par défaut : la première veille.
  useEffect(() => {
    if (!selectedId && configs.length) setSelectedId(configs[0]._id);
  }, [configs, selectedId]);

  // Le formulaire suit la veille sélectionnée (et repart propre à chaque
  // changement de sélection).
  useEffect(() => {
    setForm(selected ? versFormulaire(selected) : null);
    setMsg(null);
  }, [selected]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setCouleur = (i, v) =>
    setForm((f) => {
      const couleurs = [...f.couleurs];
      couleurs[i] = v;
      return { ...f, couleurs };
    });

  const handleCreer = async () => {
    try {
      const doc = await creer({}).unwrap();
      setSelectedId(doc._id);
      setMsg({ type: "ok", text: "Veille créée — personnalisez-la puis enregistrez." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Création impossible." });
    }
  };

  const handleEnregistrer = async () => {
    try {
      await maj({ id: selectedId, ...form }).unwrap();
      setMsg({ type: "ok", text: "Veille enregistrée." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Enregistrement impossible." });
    }
  };

  const handleSupprimer = async () => {
    if (
      !window.confirm(
        `Supprimer la veille « ${selected?.nom} » et tous ses rapports ?\n\nCette action est irréversible.`,
      )
    )
      return;
    try {
      await supprimer(selectedId).unwrap();
      setSelectedId(null);
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Suppression impossible." });
    }
  };

  const handleGenerer = async () => {
    try {
      const r = await generer(selectedId).unwrap();
      setMsg({ type: "ok", text: r.message });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Génération impossible." });
    }
  };

  return (
    <div className="vei-wrap">
      <div className="vei-head">
        <h1>
          <HiRss /> Veille
        </h1>
        <div className="vei-sub">
          Un récap d'actualités mis en page par l'IA, livré chaque semaine.
        </div>
      </div>

      {etat && !etat.iaConfiguree && (
        <div className="vei-msg err">
          <HiExclamation /> <b>Module indisponible :</b> la clé <code>OPENAI_API_KEY</code>{" "}
          est absente du fichier <code>.env</code> du serveur. Ajoutez-la puis
          redémarrez le backend.
        </div>
      )}
      {etat && etat.iaConfiguree && !etat.rechercheWebConfiguree && (
        <div className="vei-msg warn">
          <HiExclamation /> <b>Recherche web non configurée</b> (
          <code>TAVILY_API_KEY</code> absente du <code>.env</code>). Les rapports
          seront rédigés sans sources d'actualité vérifiées — ajoutez la clé pour
          une vraie veille.
        </div>
      )}

      <div className="vei-layout">
        {/* ── Colonne gauche : mes veilles ───────────────────────────────── */}
        <aside className="vei-side">
          <div className="vei-side-head">
            <span>Mes veilles</span>
            <button className="vei-btn primary sm" onClick={handleCreer} disabled={creation}>
              <HiPlus /> Nouvelle
            </button>
          </div>
          {chargementConfigs ? (
            <div className="vei-empty">Chargement…</div>
          ) : configs.length === 0 ? (
            <div className="vei-empty">
              Aucune veille. Créez-en une pour commencer.
            </div>
          ) : (
            <ul className="vei-list">
              {configs.map((c) => (
                <li key={c._id}>
                  <button
                    className={`vei-item ${c._id === selectedId ? "actif" : ""}`}
                    onClick={() => setSelectedId(c._id)}
                  >
                    <span className="vei-item-nom">{c.nom}</span>
                    <span className="vei-item-meta">
                      <HiClock /> {JOURS_LBL[c.jour]} {c.heure}
                      {!c.actif && <span className="vei-badge off">en pause</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Colonne droite : réglages + rapports ───────────────────────── */}
        <main className="vei-main">
          {!form ? (
            <div className="vei-empty grand">
              Sélectionnez une veille à gauche, ou créez-en une.
            </div>
          ) : (
            <>
              {msg && <div className={`vei-msg ${msg.type}`}>{msg.text}</div>}

              <section className="vei-card">
                <h2>
                  <HiCog /> Réglages
                </h2>

                <div className="vei-grid">
                  <div className="vei-field large">
                    <label>Nom de la veille</label>
                    <input
                      value={form.nom || ""}
                      onChange={(e) => set({ nom: e.target.value })}
                    />
                  </div>
                  <div className="vei-field">
                    <label>Jour d'envoi</label>
                    <select
                      value={form.jour}
                      onChange={(e) => set({ jour: parseInt(e.target.value, 10) })}
                    >
                      {JOURS_LBL.map((j, i) => (
                        <option key={j} value={i}>
                          {j}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="vei-field">
                    <label>Heure (Nouméa)</label>
                    <input
                      type="time"
                      value={form.heure || "08:00"}
                      onChange={(e) => set({ heure: e.target.value })}
                    />
                  </div>
                  <div className="vei-field">
                    <label>État</label>
                    <label className="vei-switch">
                      <input
                        type="checkbox"
                        checked={!!form.actif}
                        onChange={(e) => set({ actif: e.target.checked })}
                      />
                      {form.actif ? "Active" : "En pause"}
                    </label>
                  </div>
                </div>

                <div className="vei-grid">
                  <div className="vei-field large">
                    <label>Domaine suivi</label>
                    <input
                      value={form.domaine || ""}
                      onChange={(e) => set({ domaine: e.target.value })}
                      placeholder="ex : la quincaillerie et le bricolage"
                    />
                  </div>
                  <div className="vei-field large">
                    <label>
                      <HiGlobeAlt /> Zone géographique
                    </label>
                    <select
                      value={form.zone || ZONES_REPLI[0]}
                      onChange={(e) => set({ zone: e.target.value })}
                    >
                      {(etat?.zones || ZONES_REPLI).map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                    <div className="vei-hint">
                      Cadre la recherche d'actualités et le texte du rapport.
                    </div>
                  </div>
                </div>

                <div className="vei-field">
                  <label>Thématiques à couvrir — une par ligne</label>
                  <textarea
                    rows={6}
                    value={form.thematiques || ""}
                    onChange={(e) => set({ thematiques: e.target.value })}
                    placeholder={"Marché et concurrence\nNouveaux produits\nRéglementation"}
                  />
                  <div className="vei-hint">
                    Une recherche d'actualités est lancée pour chaque thématique
                    (8 maximum).
                  </div>
                </div>

                <div className="vei-grid">
                  <div className="vei-field large">
                    <label>Votre activité (pour les idées d'action)</label>
                    <input
                      value={form.activite || ""}
                      onChange={(e) => set({ activite: e.target.value })}
                      placeholder="ex : un groupe de quincailleries en Nouvelle-Calédonie"
                    />
                  </div>
                  <div className="vei-field">
                    <label>« Top X à retenir »</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={form.topX || 5}
                      onChange={(e) => set({ topX: e.target.value })}
                    />
                  </div>
                </div>
              </section>

              <section className="vei-card">
                <h2>
                  <HiSparkles /> Apparence du rapport
                </h2>
                <div className="vei-grid">
                  <div className="vei-field large">
                    <label>Style du design</label>
                    <input
                      value={form.style || ""}
                      onChange={(e) => set({ style: e.target.value })}
                      placeholder="ex : sobre et premium / ludique et coloré / minimaliste"
                    />
                  </div>
                  <div className="vei-field large">
                    <label>Référence visuelle</label>
                    <input
                      value={form.reference || ""}
                      onChange={(e) => set({ reference: e.target.value })}
                      placeholder="ex : magazine, newsletter premium, dashboard"
                    />
                  </div>
                </div>

                <div className="vei-field">
                  <label>Palette de couleurs</label>
                  <div className="vei-couleurs">
                    {[0, 1, 2].map((i) => (
                      <div className="vei-couleur" key={i}>
                        <input
                          type="color"
                          value={/^#[0-9a-f]{6}$/i.test(form.couleurs[i] || "")
                            ? form.couleurs[i]
                            : "#000000"}
                          onChange={(e) => setCouleur(i, e.target.value.toUpperCase())}
                        />
                        <input
                          className="vei-hex"
                          value={form.couleurs[i] || ""}
                          onChange={(e) => setCouleur(i, e.target.value)}
                          placeholder="#RRGGBB"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="vei-grid">
                  <div className="vei-field large">
                    <label>Typo des textes</label>
                    <input
                      value={form.typoTexte || ""}
                      onChange={(e) => set({ typoTexte: e.target.value })}
                      placeholder="ex : Inter"
                    />
                  </div>
                  <div className="vei-field large">
                    <label>Typo des titres</label>
                    <input
                      value={form.typoTitres || ""}
                      onChange={(e) => set({ typoTitres: e.target.value })}
                      placeholder="ex : Playfair Display"
                    />
                  </div>
                </div>
                <div className="vei-hint">
                  Indiquez des polices Google Fonts : elles seront chargées
                  automatiquement dans la page.
                </div>
              </section>

              <section className="vei-card">
                <button className="vei-toggle" onClick={() => setAvance((a) => !a)}>
                  {avance ? <HiChevronUp /> : <HiChevronDown />} Options avancées
                </button>
                {avance && (
                  <div className="vei-avance">
                    <div className="vei-field">
                      <label>Qualité de rédaction</label>
                      <select
                        value={form.qualite || "standard"}
                        onChange={(e) => set({ qualite: e.target.value })}
                      >
                        <option value="standard">Standard (rapide, économique)</option>
                        <option value="qualite">Supérieure (plus lent, plus cher)</option>
                      </select>
                    </div>
                    <div className="vei-field">
                      <label>Trame du prompt (laisser vide = trame par défaut)</label>
                      <textarea
                        rows={14}
                        className="vei-mono"
                        value={form.promptPersonnalise || ""}
                        onChange={(e) => set({ promptPersonnalise: e.target.value })}
                        placeholder={etat?.trame || ""}
                      />
                      <div className="vei-hint">
                        Les champs entre accolades sont remplacés par vos réglages :{" "}
                        {(etat?.champs || []).map((c) => `{{${c.cle}}}`).join(", ")}.
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <div className="vei-actions">
                <button
                  className="vei-btn primary"
                  onClick={handleEnregistrer}
                  disabled={sauvegarde}
                >
                  Enregistrer
                </button>
                <button
                  className="vei-btn"
                  onClick={handleGenerer}
                  disabled={lancement || !etat?.iaConfiguree}
                  title="Produire un rapport tout de suite, sans attendre la prochaine échéance"
                >
                  <HiSparkles /> Générer maintenant
                </button>
                <div className="vei-spacer" />
                <span className="vei-next">
                  Prochaine génération : <b>{fmtDateHeure(selected?.prochainRunAt)}</b>
                </span>
                <button className="vei-btn danger" onClick={handleSupprimer}>
                  <HiTrash /> Supprimer
                </button>
              </div>

              <RapportsSection configId={selectedId} />
            </>
          )}
        </main>
      </div>
    </div>
  );
};

// ── Liste des rapports d'une veille ─────────────────────────────────────────
const RapportsSection = ({ configId }) => {
  const [supprimer] = useDeleteVeilleRapportMutation();
  const { data: rapports = [], isFetching, refetch } = useGetVeilleRapportsQuery(
    { configId },
    // Une génération dure souvent plus d'une minute : tant qu'un rapport est
    // « en cours », on rafraîchit tout seul pour ne pas laisser l'utilisateur
    // cliquer sur Rafraîchir en boucle.
    { pollingInterval: 15000, skip: !configId },
  );

  const ouvrir = (id) =>
    window.open(`${VEILLE_URL}/rapports/${id}/html`, "_blank", "noopener");

  const handleSupprimer = async (id) => {
    if (!window.confirm("Supprimer ce rapport ?")) return;
    await supprimer(id);
  };

  return (
    <section className="vei-card">
      <h2>
        <HiEye /> Rapports
        <button className="vei-btn sm vei-pushed" onClick={() => refetch()} disabled={isFetching}>
          <HiRefresh /> Rafraîchir
        </button>
      </h2>

      {rapports.length === 0 ? (
        <div className="vei-empty">
          Aucun rapport pour l'instant. Le premier sera produit à la prochaine
          échéance — ou tout de suite avec « Générer maintenant ».
        </div>
      ) : (
        <div className="vei-tablewrap">
          <table className="vei-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Titre</th>
                <th>Statut</th>
                <th>Sources</th>
                <th>Déclenché</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rapports.map((r) => (
                <tr key={r._id}>
                  <td>{fmtDateHeure(r.createdAt)}</td>
                  <td className="wrap">
                    {r.titre || "—"}
                    {r.sansRechercheWeb && r.statut === "termine" && (
                      <span className="vei-badge warn" title="Aucune source web récupérée">
                        sans sources
                      </span>
                    )}
                  </td>
                  <td>
                    {r.statut === "termine" ? (
                      <span className="vei-badge ok">
                        <HiCheckCircle /> prêt
                      </span>
                    ) : r.statut === "en_cours" ? (
                      <span className="vei-badge encours">en cours…</span>
                    ) : (
                      <span className="vei-badge err" title={r.erreur}>
                        erreur
                      </span>
                    )}
                  </td>
                  <td>{(r.sources || []).length}</td>
                  <td>{r.declencheur === "manuel" ? "manuel" : "auto"}</td>
                  <td className="vei-row-actions">
                    <button
                      className="vei-btn primary sm"
                      disabled={r.statut !== "termine"}
                      onClick={() => ouvrir(r._id)}
                      title="Ouvrir le rapport dans un nouvel onglet"
                    >
                      <HiExternalLink /> Ouvrir
                    </button>
                    <button
                      className="vei-btn sm"
                      onClick={() => handleSupprimer(r._id)}
                      title="Supprimer"
                    >
                      <HiTrash />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rapports.some((r) => r.statut === "erreur") && (
        <div className="vei-hint">
          Un rapport en erreur affiche la cause en infobulle sur son statut.
        </div>
      )}
    </section>
  );
};

export default VeilleScreen;
