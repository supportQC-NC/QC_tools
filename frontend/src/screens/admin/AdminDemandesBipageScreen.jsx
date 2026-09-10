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
  useCreateDemandeBipageGroupeMutation,
  useCreateDemandeBipagePanierMutation,
  useLazyGetArticleBipageQuery,
  useDeleteDemandeBipageMutation,
} from "../../slices/demandeBipageApiSlice";
import { BASE_URL } from "../../constants";
// Même sélecteur que le générateur d'étiquettes : chez QC il y a des centaines
// de gisements et de groupes, une grille de puces est inutilisable.
import SelecteurMultiple from "../../components/common/SelecteurMultiple/SelecteurMultiple";
import "./AdminDemandesBipageScreen.css";

const PRIORITE_LABEL = { urgent: "Urgent", a_faire: "À faire", normal: "Normal" };
const STATUT_LABEL = {
  en_attente: "En attente",
  en_cours: "En cours",
  realisee: "Réalisée",
};
const SOURCE_LABEL = {
  proforma: "Proforma",
  gisement: "Gisement",
  groupe: "Groupe",
  manuel: "Manuelle",
  // ⚠️ Pas de « rayon vide » ici : chercher ce qui manque en rayon alors qu'il
  // reste du stock en réserve, c'est la question du RÉAPPRO (écran Listes de
  // réappro). Le bipage est libre — on compte ce qu'on veut, quel que soit le
  // stock.
  fournisseur: "Fournisseur",
};

// ⚠️ Les stocks viennent de champs DBF N(x.3) : beaucoup d'articles se vendent
// au mètre. On ne les arrondit jamais à l'unité.
const fmtQte = (v) =>
  Number.isFinite(Number(v))
    ? Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 })
    : "0";

// Libellés d'entrepôts par défaut, remplacés par ceux de la société
// (`mappingEntrepots`) dès qu'un article a été résolu.
const LABELS_DEFAUT = { S1: "Magasin", S2: "S2", S3: "S3", S4: "S4", S5: "S5" };

// ⚠️ Un article a DEUX emplacements : GISM1 = le rayon (MAGASIN), GISM2 = la
// réserve (DOCK). Le libellé de chacun vient du dictionnaire des rayons,
// interrogé à SON emplacement : chez QC le même code porte souvent deux noms
// différents (« D_2d » = « forêt métaux » au magasin, « VIS AUTO ZN » au dock).
const Gisement = ({ code, libelle }) =>
  code ? (
    <span className="db-gis">
      <span className="db-gis-code">{code}</span>
      {libelle && <span className="db-gis-lib">{libelle}</span>}
    </span>
  ) : (
    <span className="db-muted">—</span>
  );

// « Où est-il en stock ? » : les dépôts S2 à S5 qui portent quelque chose, avec
// le nom que la société leur donne. Un dépôt à zéro n'est pas listé — c'est la
// question posée (où aller le chercher), pas un inventaire.
const depotsAvecStock = (art, labels) =>
  ["S2", "S3", "S4", "S5"]
    .map((k) => ({ k, qte: Number(art?.[k.toLowerCase()] || 0) }))
    .filter((d) => d.qte !== 0)
    .map((d) => `${labels[d.k] || d.k} : ${fmtQte(d.qte)}`);

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit", month: "2-digit", year: "2-digit",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

const AdminDemandesBipageScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier) || "";

  const [source, setSource] = useState("gisement"); // gisement | groupe | proforma | manuel
  const [priorite, setPriorite] = useState("a_faire");
  const [commentaire, setCommentaire] = useState("");
  const [feedback, setFeedback] = useState(null); // {tone, message}
  const [filtre, setFiltre] = useState("tous"); // tous | en_attente | en_cours | realisee
  const [search, setSearch] = useState("");

  // Sources
  const [gism1List, setGism1List] = useState([]);
  const [gisSel, setGisSel] = useState(new Set());
  const [groupeList, setGroupeList] = useState([]);
  const [grpSel, setGrpSel] = useState(new Set());
  // Un groupe entier peut compter des milliers de références : par défaut on ne
  // retient que celles qui ont du stock, sinon la demande est inexploitable sur
  // un collecteur.
  const [avecStock, setAvecStock] = useState(true);
  const [proformas, setProformas] = useState([]);
  const [numpro, setNumpro] = useState("");
  const [nartInput, setNartInput] = useState("");
  const [panier, setPanier] = useState([]); // [{nart, design, gencod}]
  // Libellés d'entrepôts de la société (renvoyés avec chaque article résolu).
  const [stocksLabels, setStocksLabels] = useState(LABELS_DEFAUT);
  // Aperçu de l'article saisi, AVANT de l'ajouter au panier : l'utilisateur
  // voit la désignation et les stocks pendant qu'il tape.
  const [apercu, setApercu] = useState(null); // { art } | { introuvable: true }
  // Source « fournisseur » : on choisit un fournisseur, on voit TOUS ses
  // articles (rayon vide en tête) et on coche ce qu'on veut faire biper.
  const [fournListe, setFournListe] = useState([]);
  const [fournSel, setFournSel] = useState("");
  const [fournArts, setFournArts] = useState(null); // { total, renvoyes, rayonVide, articles }
  const [fournLoading, setFournLoading] = useState(false);
  const [fournSearch, setFournSearch] = useState("");
  const [faSel, setFaSel] = useState(new Set());
  const [faPrioSeul, setFaPrioSeul] = useState(false);

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
  const [creerGroupe, { isLoading: cGr }] = useCreateDemandeBipageGroupeMutation();
  const [creerPanier, { isLoading: cM }] = useCreateDemandeBipagePanierMutation();
  const [resolveArticle] = useLazyGetArticleBipageQuery();
  const [deleteDemande] = useDeleteDemandeBipageMutation();
  const creating = cP || cG || cGr || cM;

  const showMsg = (message, tone = "info") => {
    setFeedback({ message, tone });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Réinitialise à chaque changement de société.
  useEffect(() => {
    setGisSel(new Set());
    setGrpSel(new Set());
    setFournListe([]);
    setFournSel("");
    setFournArts(null);
    setFaSel(new Set());
    setPanier([]);
    setNumpro("");
    setNartInput("");
    setProformas([]);
    setGism1List([]);
    setGroupeList([]);
  }, [nomDossierDBF]);

  // Charge la liste des gisements (GISM1) et des proformas à préparer.
  const loadSources = useCallback(async () => {
    if (!nomDossierDBF) return;
    try {
      // Pas de `?vide=1` : une demande « Groupe VIDE » n'aurait pas de sens
      // pour l'agent (ce sont les articles auxquels l'ERP n'a attribué aucun
      // code, pas un rayon où aller).
      const [g, gr, p] = await Promise.all([
        fetch(`${BASE_URL}/api/articles/${nomDossierDBF}/gism1`, {
          credentials: "include",
        }).then((r) => (r.ok ? r.json() : null)),
        fetch(`${BASE_URL}/api/articles/${nomDossierDBF}/groupes`, {
          credentials: "include",
        }).then((r) => (r.ok ? r.json() : null)),
        fetch(`${BASE_URL}/api/preparations/a-preparer/${nomDossierDBF}`, {
          credentials: "include",
        }).then((r) => (r.ok ? r.json() : null)),
      ]);
      setGism1List(Array.isArray(g?.gism1) ? g.gism1 : []);
      setGroupeList(Array.isArray(gr?.groupes) ? gr.groupes : []);
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
  const basculer = (setter) => (code) =>
    setter((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const toggleGis = basculer(setGisSel);
  const toggleGrp = basculer(setGrpSel);
  const toggleFa = basculer(setFaSel);

  // Liste des fournisseurs (une fois par société, à l'ouverture de l'onglet).
  useEffect(() => {
    if (source !== "fournisseur" || !nomDossierDBF || fournListe.length) return;
    let vivant = true;
    fetch(`${BASE_URL}/api/demande-bipage/${nomDossierDBF}/fournisseurs`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (vivant) setFournListe(r?.fournisseurs || []);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [source, nomDossierDBF, fournListe.length]);

  // Articles du fournisseur choisi.
  useEffect(() => {
    if (!fournSel || !nomDossierDBF) {
      setFournArts(null);
      return undefined;
    }
    let vivant = true;
    setFournLoading(true);
    setFaSel(new Set());
    fetch(
      // tri=ventes : le bipage ne hiérarchise pas sur le stock.
      `${BASE_URL}/api/demande-bipage/${nomDossierDBF}/fournisseur/${encodeURIComponent(fournSel)}/articles?limit=1000&tri=ventes`,
      { credentials: "include" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (vivant) setFournArts(r || { total: 0, articles: [] });
      })
      .catch(() => {
        if (vivant) setFournArts({ total: 0, articles: [] });
      })
      .finally(() => {
        if (vivant) setFournLoading(false);
      });
    return () => {
      vivant = false;
    };
  }, [fournSel, nomDossierDBF]);

  const faFiltres = useMemo(() => {
    let arts = fournArts?.articles || [];
    if (faPrioSeul) arts = arts.filter((a) => a.prioritaire);
    const q = fournSearch.trim().toLowerCase();
    if (!q) return arts;
    return arts.filter((a) =>
      [a.nart, a.design, a.gisement, a.gencod]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [fournArts, fournSearch, faPrioSeul]);

  // Résolution temporisée pendant la frappe (350 ms) : inutile d'interroger le
  // serveur à chaque touche, et le cache article est déjà chaud.
  useEffect(() => {
    const code = nartInput.trim();
    if (source !== "manuel" || !code || !nomDossierDBF) {
      setApercu(null);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const art = await resolveArticle({ nomDossierDBF, nart: code }).unwrap();
        setApercu({ art });
        if (art?.stocksLabels) setStocksLabels(art.stocksLabels);
      } catch {
        setApercu({ introuvable: true });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [nartInput, source, nomDossierDBF, resolveArticle]);

  const addNart = async () => {
    const nart = nartInput.trim();
    if (!nart || !nomDossierDBF) return;
    try {
      const art = await resolveArticle({ nomDossierDBF, nart }).unwrap();
      if (art?.stocksLabels) setStocksLabels(art.stocksLabels);
      setPanier((prev) =>
        prev.some((p) => p.nart === art.nart) ? prev : [...prev, art],
      );
      setNartInput("");
      setApercu(null);
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
      } else if (source === "fournisseur") {
        if (faSel.size === 0)
          return showMsg("Sélectionnez au moins un article.", "error");
        const nomF =
          fournListe.find((f) => f.code === fournSel)?.nom || fournSel;
        res = await creerPanier({
          nomDossierDBF,
          articles: [...faSel].map((nart) => ({ nart, quantite: 0 })),
          priorite,
          commentaire,
          libelle: `${nomF} · ${faSel.size} article(s)`,
        }).unwrap();
      } else if (source === "groupe") {
        if (grpSel.size === 0) return showMsg("Sélectionnez au moins un groupe.", "error");
        res = await creerGroupe({
          nomDossierDBF,
          groupes: [...grpSel],
          avecStockSeulement: avecStock,
          priorite,
          commentaire,
        }).unwrap();
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
      // Un groupe sans aucun article à biper ne crée rien : le dire, sinon
      // « 0 demande créée » ressemble à une panne.
      const vid = res?.vides?.length
        ? ` (${res.vides.length} sans article à biper)`
        : "";
      // Le nombre d'ARTICLES compte autant que le nombre de demandes : un
      // groupe large peut en produire des milliers, autant le voir tout de
      // suite (la demande est supprimable d'un clic si c'est trop).
      const arts = res?.totalArticles
        ? ` — ${res.totalArticles.toLocaleString("fr-FR")} article(s) à biper`
        : "";
      showMsg(`${n} demande(s) créée(s)${ign}${vid}${arts}.`, "success");
      setGisSel(new Set());
      setGrpSel(new Set());
      setFaSel(new Set());
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
            {["gisement", "groupe", "fournisseur", "proforma", "manuel"].map(
              (s) => (
                <button
                  key={s}
                  className={`db-tab ${source === s ? "on" : ""}`}
                  onClick={() => setSource(s)}
                >
                  {SOURCE_LABEL[s]}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Source : GISEMENT */}
        {source === "gisement" && (
          <div className="db-source-body">
            <p className="db-hint">
              Sélectionnez un ou plusieurs gisements — <b>une demande par
              gisement</b>, pour que deux agents puissent se partager le travail.
            </p>
            <SelecteurMultiple
              key={`gis-${nomDossierDBF}`}
              items={gism1List}
              selected={[...gisSel]}
              onToggle={toggleGis}
              onClear={() => setGisSel(new Set())}
              placeholder="Rechercher et sélectionner un ou plusieurs gisements…"
            />
            {gisSel.size > 0 && (
              <span className="db-hint">
                {gisSel.size} gisement(s) sélectionné(s) → {gisSel.size} demande(s).
              </span>
            )}
          </div>
        )}

        {/* Source : GROUPE (famille d'articles) */}
        {source === "groupe" && (
          <div className="db-source-body">
            <p className="db-hint">
              Sélectionnez un ou plusieurs groupes d'articles — <b>une demande par
              groupe</b>, comme pour les gisements.
            </p>
            <SelecteurMultiple
              key={`grp-${nomDossierDBF}`}
              items={groupeList}
              selected={[...grpSel]}
              onToggle={toggleGrp}
              onClear={() => setGrpSel(new Set())}
              placeholder="Rechercher et sélectionner un ou plusieurs groupes…"
            />
            <label className="db-check">
              <input
                type="checkbox"
                checked={avecStock}
                onChange={(e) => setAvecStock(e.target.checked)}
              />
              <span>
                Seulement les articles en stock
                <em>
                  {" "}
                  — recommandé : un groupe entier compte souvent des milliers de
                  références jamais entrées en stock.
                </em>
              </span>
            </label>
            {grpSel.size > 0 && (
              <span className="db-hint">
                {grpSel.size} groupe(s) sélectionné(s) → {grpSel.size} demande(s).
                Le nombre d'articles réellement retenus est affiché après création.
              </span>
            )}
          </div>
        )}

        {/* Source : FOURNISSEUR (tous ses articles, rayon vide en tête) */}
        {source === "fournisseur" && (
          <div className="db-source-body">
            <p className="db-hint">
              Choisissez un fournisseur : tous ses articles s'affichent, ceux
              dont le <b>rayon est vide alors qu'il reste du stock en réserve</b>{" "}
              en tête (repère ★). Cochez ce que vous voulez faire biper.
            </p>

            <div className="db-manual-add">
              <select
                className="db-select"
                value={fournSel}
                onChange={(e) => setFournSel(e.target.value)}
              >
                <option value="">— Choisir un fournisseur —</option>
                {fournListe.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.nom || f.code} · {f.nbArticles} art.
                    {f.nbRayonVide ? ` · ${f.nbRayonVide} rayon vide` : ""}
                  </option>
                ))}
              </select>
              <input
                className="db-input"
                value={fournSearch}
                placeholder="Filtrer : code, désignation, gisement…"
                onChange={(e) => setFournSearch(e.target.value)}
                disabled={!fournSel}
              />
            </div>

            {fournSel && (
              <div className="db-manual-add">
                <label className="db-check">
                  <input
                    type="checkbox"
                    checked={faPrioSeul}
                    onChange={(e) => setFaPrioSeul(e.target.checked)}
                  />
                  <span>Seulement les articles à rayon vide</span>
                </label>
                <button
                  className="db-btn-sec"
                  onClick={() => setFaSel(new Set(faFiltres.map((a) => a.nart)))}
                  disabled={faFiltres.length === 0}
                >
                  Tout cocher ({faFiltres.length})
                </button>
                <button
                  className="db-btn-sec"
                  onClick={() => setFaSel(new Set())}
                  disabled={faSel.size === 0}
                >
                  Vider
                </button>
              </div>
            )}

            {fournLoading ? (
              <span className="db-muted">Chargement des articles…</span>
            ) : fournSel && fournArts ? (
              <>
                <p className="db-hint">
                  {fournArts.total} article(s) · {fournArts.rayonVide} à rayon
                  vide · {faSel.size} sélectionné(s)
                  {fournArts.renvoyes
                    ? ` · ${fournArts.renvoyes} article(s) renvoyé(s) vers un autre code, écarté(s)`
                    : ""}
                  {fournArts.total > (fournArts.affiches ?? 0)
                    ? ` · ${fournArts.affiches} affiché(s)`
                    : ""}
                </p>
                <div className="db-rv-table-wrap">
                  <table className="db-rv-table">
                    <thead>
                      <tr>
                        <th />
                        <th>Code</th>
                        <th>Désignation</th>
                        <th>Rayon (GISM1)</th>
                        <th>Dock (GISM2)</th>
                        <th className="db-num">Ventes 12 mois</th>
                        <th className="db-num">Magasin</th>
                        <th className="db-num">Réserve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faFiltres.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="db-muted">
                            Aucun article ne correspond.
                          </td>
                        </tr>
                      ) : (
                        faFiltres.map((a) => (
                          <tr
                            key={a.nart}
                            className={`${faSel.has(a.nart) ? "on" : ""} ${a.prioritaire ? "prio" : ""}`}
                            onClick={() => toggleFa(a.nart)}
                          >
                            <td>
                              <input
                                type="checkbox"
                                checked={faSel.has(a.nart)}
                                onChange={() => toggleFa(a.nart)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td>
                              {a.prioritaire && (
                                <span className="db-prio-mark" title="Rayon vide, stock en réserve">
                                  ★
                                </span>
                              )}
                              {a.nart}
                            </td>
                            <td>{a.design}</td>
                            <td>
                              <Gisement code={a.gism1} libelle={a.rayonMagasin} />
                            </td>
                            <td>
                              <Gisement code={a.gism2} libelle={a.rayonDock} />
                            </td>
                            <td className="db-num">{fmtQte(a.ventes12)}</td>
                            <td className={`db-num ${Number(a.s1) === 0 ? "db-zero" : ""}`}>
                              {fmtQte(a.s1)}
                            </td>
                            <td className="db-num">{fmtQte(a.stockReserves)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <span className="db-muted">
                Sélectionnez un fournisseur pour voir ses articles.
              </span>
            )}
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
            <p className="db-hint">
              Ajoutez des articles par NART, gencode ou référence fournisseur.
            </p>
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

            {/* Aperçu pendant la frappe : on ne s'engage pas à l'aveugle, on
                voit la désignation et OÙ l'article est en stock avant même de
                l'ajouter. */}
            {apercu?.introuvable && (
              <p className="db-apercu db-apercu-ko">
                Aucun article ne correspond à « {nartInput.trim()} ».
              </p>
            )}
            {apercu?.art && (
              <div className="db-apercu">
                <span className="mono">{apercu.art.nart}</span>
                <span className="db-apercu-des">{apercu.art.design}</span>
                <span
                  className={`db-stock ${Number(apercu.art.s1 || 0) === 0 ? "vide" : ""}`}
                >
                  {stocksLabels.S1} : {fmtQte(apercu.art.s1)}
                </span>
                {depotsAvecStock(apercu.art, stocksLabels).map((d) => (
                  <span key={d} className="db-stock db-stock-reserve">
                    {d}
                  </span>
                ))}
                {depotsAvecStock(apercu.art, stocksLabels).length === 0 && (
                  <span className="db-stock">Aucun stock en réserve</span>
                )}
                {apercu.art.fournNom && (
                  <span className="db-apercu-gis">{apercu.art.fournNom}</span>
                )}
                {apercu.art.gisement && (
                  <span className="db-apercu-gis">
                    rayon {apercu.art.gisement}
                  </span>
                )}
              </div>
            )}

            {panier.length > 0 && (
              <div className="db-panier">
                {panier.map((p) => (
                  <div key={p.nart} className="db-panier-item">
                    <span className="mono">{p.nart}</span>
                    <span className="db-panier-des">
                      {p.design}
                      <span className="db-panier-stocks">
                        <span
                          className={`db-stock ${Number(p.s1 || 0) === 0 ? "vide" : ""}`}
                        >
                          {stocksLabels.S1} : {fmtQte(p.s1)}
                        </span>
                        {depotsAvecStock(p, stocksLabels).map((d) => (
                          <span key={d} className="db-stock db-stock-reserve">
                            {d}
                          </span>
                        ))}
                        {(p.fournNom || p.gisement) && (
                          <span className="db-apercu-gis">
                            {[p.fournNom, p.gisement && `rayon ${p.gisement}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    </span>
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
