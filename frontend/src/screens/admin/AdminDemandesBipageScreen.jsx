// src/screens/admin/AdminDemandesBipageScreen.jsx
//
// Gestion des DEMANDES DE BIPAGE : création (depuis une proforma, un gisement,
// ou une sélection manuelle) + suivi (en attente / en cours / réalisées).
// Les demandes actives sont envoyées aux collecteurs (app mobile, module Bipage).
import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  HiClipboardList,
  HiRefresh,
  HiTrash,
  HiPlus,
  HiCheckCircle,
  HiExclamationCircle,
  HiSearch,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetDemandesBipageQuery,
  useCreateDemandeBipageProformaMutation,
  useCreateDemandeBipageGisementMutation,
  useCreateDemandeBipagePanierMutation,
  useLazyGetArticleBipageQuery,
  useDeleteDemandeBipageMutation,
} from "../../slices/demandeBipageApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminDemandesBipageScreen.css";

const PRIORITE_LABEL = { urgent: "Urgent", a_faire: "À faire", normal: "Normal" };
const STATUT_LABEL = {
  en_attente: "En attente",
  en_cours: "En cours",
  realisee: "Réalisée",
};
const SOURCE_LABEL = { proforma: "Proforma", gisement: "Gisement", manuel: "Manuelle" };

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit", month: "2-digit", year: "2-digit",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

const AdminDemandesBipageScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier) || "";

  const [source, setSource] = useState("gisement"); // gisement | proforma | manuel
  const [priorite, setPriorite] = useState("a_faire");
  const [commentaire, setCommentaire] = useState("");
  const [feedback, setFeedback] = useState(null); // {tone, message}
  const [filtre, setFiltre] = useState("tous"); // tous | en_attente | en_cours | realisee
  const [search, setSearch] = useState("");

  // Sources
  const [gism1List, setGism1List] = useState([]);
  const [gisSel, setGisSel] = useState(new Set());
  const [proformas, setProformas] = useState([]);
  const [numpro, setNumpro] = useState("");
  const [nartInput, setNartInput] = useState("");
  const [panier, setPanier] = useState([]); // [{nart, design, gencod}]

  const {
    data: demandes = [],
    isFetching,
    refetch,
  } = useGetDemandesBipageQuery(
    { nomDossierDBF },
    { skip: !nomDossierDBF, refetchOnMountOrArgChange: true },
  );

  const [creerProforma, { isLoading: cP }] = useCreateDemandeBipageProformaMutation();
  const [creerGisement, { isLoading: cG }] = useCreateDemandeBipageGisementMutation();
  const [creerPanier, { isLoading: cM }] = useCreateDemandeBipagePanierMutation();
  const [resolveArticle] = useLazyGetArticleBipageQuery();
  const [deleteDemande] = useDeleteDemandeBipageMutation();
  const creating = cP || cG || cM;

  const showMsg = (message, tone = "info") => {
    setFeedback({ message, tone });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Réinitialise à chaque changement de société.
  useEffect(() => {
    setGisSel(new Set());
    setPanier([]);
    setNumpro("");
    setNartInput("");
    setProformas([]);
    setGism1List([]);
  }, [nomDossierDBF]);

  // Charge la liste des gisements (GISM1) et des proformas à préparer.
  const loadSources = useCallback(async () => {
    if (!nomDossierDBF) return;
    try {
      const [g, p] = await Promise.all([
        fetch(`${BASE_URL}/api/articles/${nomDossierDBF}/gism1`, {
          credentials: "include",
        }).then((r) => (r.ok ? r.json() : null)),
        fetch(`${BASE_URL}/api/preparations/a-preparer/${nomDossierDBF}`, {
          credentials: "include",
        }).then((r) => (r.ok ? r.json() : null)),
      ]);
      setGism1List(Array.isArray(g?.gism1) ? g.gism1 : []);
      const prof = p?.proformas || p?.items || p?.data || (Array.isArray(p) ? p : []);
      setProformas(Array.isArray(prof) ? prof : []);
    } catch {
      /* silencieux */
    }
  }, [nomDossierDBF]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // ── Filtrage / compteurs du suivi ───────────────────────────────────────────
  const compteurs = useMemo(() => {
    const c = { en_attente: 0, en_cours: 0, realisee: 0 };
    for (const d of demandes) if (c[d.statut] !== undefined) c[d.statut] += 1;
    return c;
  }, [demandes]);

  const demandesFiltrees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return demandes.filter((d) => {
      if (filtre !== "tous" && d.statut !== filtre) return false;
      if (!q) return true;
      return [d.libelle, d.sourceRef, d.source, d.createdByNom].some((v) =>
        (v || "").toLowerCase().includes(q),
      );
    });
  }, [demandes, filtre, search]);

  // ── Actions création ────────────────────────────────────────────────────────
  const toggleGis = (code) =>
    setGisSel((prev) => {
      const n = new Set(prev);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });

  const addNart = async () => {
    const nart = nartInput.trim();
    if (!nart || !nomDossierDBF) return;
    try {
      const art = await resolveArticle({ nomDossierDBF, nart }).unwrap();
      setPanier((prev) =>
        prev.some((p) => p.nart === art.nart)
          ? prev
          : [...prev, { nart: art.nart, design: art.design, gencod: art.gencod }],
      );
      setNartInput("");
    } catch {
      showMsg(`NART « ${nart} » introuvable.`, "error");
    }
  };

  const valider = async () => {
    if (!nomDossierDBF) return;
    try {
      let res;
      if (source === "proforma") {
        if (!numpro.trim()) return showMsg("Choisissez une proforma.", "error");
        res = await creerProforma({ nomDossierDBF, numpro: numpro.trim(), priorite, commentaire }).unwrap();
      } else if (source === "gisement") {
        if (gisSel.size === 0) return showMsg("Sélectionnez au moins un gisement.", "error");
        res = await creerGisement({ nomDossierDBF, gisements: [...gisSel], priorite, commentaire }).unwrap();
      } else {
        if (panier.length === 0) return showMsg("Ajoutez au moins un article.", "error");
        res = await creerPanier({
          nomDossierDBF,
          articles: panier.map((p) => ({ nart: p.nart, quantite: 0 })),
          priorite,
          commentaire,
        }).unwrap();
      }
      const n = res?.crees ?? 0;
      const ign = res?.ignores?.length ? ` (${res.ignores.length} déjà en demande)` : "";
      showMsg(`${n} demande(s) créée(s)${ign}.`, "success");
      setGisSel(new Set());
      setPanier([]);
      setNumpro("");
      setCommentaire("");
      refetch();
    } catch (e) {
      showMsg(e?.data?.message || "Création échouée.", "error");
    }
  };

  const supprimer = async (id) => {
    try {
      await deleteDemande(id).unwrap();
      refetch();
    } catch {
      showMsg("Suppression échouée.", "error");
    }
  };

  if (!nomDossierDBF) {
    return (
      <div className="db-screen">
        <div className="db-placeholder">
          <HiClipboardList />
          <p>Sélectionnez une société dans l'en-tête pour gérer les demandes de bipage.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="db-screen">
      <div className="db-header">
        <h1><HiClipboardList /> Bipages — demandes</h1>
        <button className="db-btn-icon" onClick={refetch} title="Rafraîchir">
          <HiRefresh />
        </button>
      </div>

      {feedback && (
        <div className={`db-feedback ${feedback.tone}`}>
          {feedback.tone === "error" ? <HiExclamationCircle /> : <HiCheckCircle />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* ── Création ─────────────────────────────────────────── */}
      <div className="db-card">
        <div className="db-card-head">
          <h2>Nouvelle demande de bipage</h2>
          <div className="db-source-tabs">
            {["gisement", "proforma", "manuel"].map((s) => (
              <button
                key={s}
                className={`db-tab ${source === s ? "on" : ""}`}
                onClick={() => setSource(s)}
              >
                {SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Source : GISEMENT */}
        {source === "gisement" && (
          <div className="db-source-body">
            <p className="db-hint">Sélectionnez un ou plusieurs gisements (une demande par gisement).</p>
            <div className="db-gis-grid">
              {gism1List.length === 0 ? (
                <span className="db-muted">Aucun gisement chargé.</span>
              ) : (
                gism1List.map((g) => (
                  <button
                    key={g.code}
                    className={`db-gis-chip ${gisSel.has(g.code) ? "on" : ""}`}
                    onClick={() => toggleGis(g.code)}
                  >
                    {g.code} <span className="db-gis-count">{g.count}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Source : PROFORMA */}
        {source === "proforma" && (
          <div className="db-source-body">
            <p className="db-hint">Choisissez une proforma à préparer (ses articles seront à biper).</p>
            <select className="db-select" value={numpro} onChange={(e) => setNumpro(e.target.value)}>
              <option value="">— Choisir une proforma —</option>
              {proformas.map((p) => (
                <option key={p.numfact} value={p.numfact}>
                  {p.numfact} · {p.clientNom || p.clientCode || ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Source : MANUEL */}
        {source === "manuel" && (
          <div className="db-source-body">
            <p className="db-hint">Ajoutez des articles par NART.</p>
            <div className="db-manual-add">
              <input
                className="db-input"
                value={nartInput}
                placeholder="NART…"
                onChange={(e) => setNartInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addNart()}
              />
              <button className="db-btn" onClick={addNart}><HiPlus /> Ajouter</button>
            </div>
            {panier.length > 0 && (
              <div className="db-panier">
                {panier.map((p) => (
                  <div key={p.nart} className="db-panier-item">
                    <span className="mono">{p.nart}</span>
                    <span className="db-panier-des">{p.design}</span>
                    <button className="db-del" onClick={() => setPanier((prev) => prev.filter((x) => x.nart !== p.nart))}>
                      <HiTrash />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Priorité + commentaire + valider */}
        <div className="db-create-footer">
          <label className="db-field">
            Priorité
            <select className="db-select" value={priorite} onChange={(e) => setPriorite(e.target.value)}>
              <option value="urgent">Urgent</option>
              <option value="a_faire">À faire</option>
              <option value="normal">Normal</option>
            </select>
          </label>
          <input
            className="db-input db-comment"
            value={commentaire}
            placeholder="Commentaire (optionnel)"
            onChange={(e) => setCommentaire(e.target.value)}
          />
          <button className="db-btn db-btn-primary" onClick={valider} disabled={creating}>
            {creating ? "Création…" : "Valider la demande"}
          </button>
        </div>
      </div>

      {/* ── Suivi ───────────────────────────────────────────── */}
      <div className="db-card">
        <div className="db-toolbar">
          <div className="db-chips">
            <button className={`db-chip ${filtre === "tous" ? "on" : ""}`} onClick={() => setFiltre("tous")}>
              Toutes ({demandes.length})
            </button>
            {["en_attente", "en_cours", "realisee"].map((s) => (
              <button
                key={s}
                className={`db-chip db-chip-${s} ${filtre === s ? "on" : ""}`}
                onClick={() => setFiltre(s)}
              >
                {STATUT_LABEL[s]} ({compteurs[s]})
              </button>
            ))}
          </div>
          <div className="db-search">
            <HiSearch />
            <input
              value={search}
              placeholder="Rechercher…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="db-table-wrap">
          <table className="db-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Libellé</th>
                <th className="num">Articles</th>
                <th>Priorité</th>
                <th>Statut</th>
                <th>Créé par</th>
                <th>Réalisé par</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {demandesFiltrees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="db-empty">
                    {isFetching ? "Chargement…" : "Aucune demande."}
                  </td>
                </tr>
              ) : (
                demandesFiltrees.map((d) => (
                  <tr key={d._id}>
                    <td><span className="db-source-tag">{SOURCE_LABEL[d.source] || d.source}</span></td>
                    <td className="strong">{d.libelle || d.sourceRef || "—"}</td>
                    <td className="num">{d.nbArticles}</td>
                    <td><span className={`db-prio db-prio-${d.priorite}`}>{PRIORITE_LABEL[d.priorite] || d.priorite}</span></td>
                    <td><span className={`db-statut db-statut-${d.statut}`}>{STATUT_LABEL[d.statut] || d.statut}</span></td>
                    <td>{d.createdByNom || "—"} <span className="db-date">{fmtDate(d.createdAt)}</span></td>
                    <td>{d.realisedByNom ? <>{d.realisedByNom} <span className="db-date">{fmtDate(d.realisedAt)}</span></> : "—"}</td>
                    <td>
                      {d.statut !== "realisee" && (
                        <button className="db-del" title="Supprimer" onClick={() => supprimer(d._id)}>
                          <HiTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDemandesBipageScreen;
