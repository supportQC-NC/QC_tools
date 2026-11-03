// src/screens/admin/AdminReapproMecalacScreen.jsx
//
// RÉAPPRO « MÉCALAC » — descendre au rayon (S1) ce qui dort dans un entrepôt.
//
// Parcours : on choisit l'entrepôt source (S2..S5, nommé dans la fiche
// société), on clique « Analyser », on retouche la liste proposée (quantités,
// suppressions, ajouts), puis on génère le fichier .dat dans collect_sec.
//
// L'écran est SANS ÉTAT côté serveur : la liste vit dans la page jusqu'à la
// génération. Quitter l'écran avant de générer perd le travail — c'est voulu
// (même parti pris que le réappro rayon du collecteur), et annoncé à l'écran.
//
// ⚠️ L'analyse n'est JAMAIS lancée au chargement : elle balaie tout le
// catalogue articles (90 000 fiches chez QC). C'est le bouton qui la déclenche.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiTruck,
  HiSearch,
  HiTrash,
  HiPlus,
  HiDownload,
  HiRefresh,
  HiCheckCircle,
  HiExclamationCircle,
  HiDocumentText,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetEntrepotsMecalacQuery,
  useAnalyserMecalacMutation,
  useResoudreArticleMecalacMutation,
  useGenererDatMecalacMutation,
} from "../../slices/reapproMecalacApiSlice";
import "./AdminReapproMecalacScreen.css";

// Quantités à 3 décimales : beaucoup d'articles se vendent au mètre, un arrondi
// à l'unité transformerait « 38,5 m » en « 38 ». Jamais de parseInt ici.
const parseQte = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
};

const fmtNb = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 1000) / 1000)
    .toLocaleString("fr-FR", { maximumFractionDigits: 3 });
};

// Miroir EXACT de la sanitisation du serveur (reapproMecalacController) : ce
// que l'écran annonce doit être le nom réellement écrit.
const sanitizeNom = (v) =>
  String(v || "").trim().replace(/[^a-zA-Z0-9_\- ]/g, "_");

const nomFichierApercu = (nomEntrepot, nomLibre) =>
  `stock.dat reappro_${sanitizeNom(nomEntrepot) || "?"}_${
    sanitizeNom(nomLibre) || "…"
  }`;

const AdminReapproMecalacScreen = () => {
  const entrepriseId = useSelector(selectGlobalEntrepriseId) || "";
  const { data: entreprises } = useGetMyEntreprisesQuery();
  const entrepriseObj = entreprises?.find((e) => e._id === entrepriseId);

  const [depot, setDepot] = useState("");
  const [fourn, setFourn] = useState("");
  const [lignes, setLignes] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [resume, setResume] = useState(null); // { total, tronque, renvoyes }
  const [search, setSearch] = useState("");
  const [nom, setNom] = useState("");
  const [ajoutCode, setAjoutCode] = useState("");
  const [ajoutQte, setAjoutQte] = useState("");
  const [feedback, setFeedback] = useState(null); // { tone, message }
  const [dernierFichier, setDernierFichier] = useState(null);

  const ajoutRef = useRef(null);

  const { data: entrepotsData, isFetching: chargeEntrepots } =
    useGetEntrepotsMecalacQuery(entrepriseId, { skip: !entrepriseId });

  const [analyser, { isLoading: analyse }] = useAnalyserMecalacMutation();
  const [resoudre, { isLoading: resolution }] =
    useResoudreArticleMecalacMutation();
  const [generer, { isLoading: generation }] = useGenererDatMecalacMutation();

  const entrepots = entrepotsData?.entrepots || [];
  const entrepotSel = entrepots.find((e) => e.key === depot) || null;
  const nomEntrepot = entrepotSel?.nom || depot;

  // Changement de société : tout repart de zéro.
  useEffect(() => {
    setDepot("");
    setLignes([]);
    setFournisseurs([]);
    setResume(null);
    setSearch("");
    setNom("");
    setFeedback(null);
    setDernierFichier(null);
  }, [entrepriseId]);

  const lignesFiltrees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lignes;
    return lignes.filter((l) =>
      [l.nart, l.design, l.gencod, l.refer, l.fournNom, l.gism1, l.rayonMagasin]
        .some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [lignes, search]);

  const totaux = useMemo(() => {
    const retenues = lignes.filter((l) => parseQte(l.quantite) > 0);
    return {
      lignes: retenues.length,
      ignorees: lignes.length - retenues.length,
      unites: retenues.reduce((s, l) => s + parseQte(l.quantite), 0),
    };
  }, [lignes]);

  // ── Analyse ───────────────────────────────────────────────────────────────
  const lancerAnalyse = async () => {
    if (!depot) return;
    setFeedback(null);
    setDernierFichier(null);
    try {
      const res = await analyser({ entrepriseId, depot, fourn }).unwrap();
      setLignes(
        (res.articles || []).map((a, i) => ({
          ...a,
          cle: `${a.nart}-${i}`,
          quantite: a.qteProposee,
          manuel: false,
        })),
      );
      setFournisseurs(res.fournisseurs || []);
      setResume({
        total: res.total,
        tronque: res.tronque,
        renvoyes: res.renvoyes,
      });
      setFeedback({
        tone: res.articles?.length ? "success" : "warning",
        message: res.articles?.length
          ? `${res.total} article(s) à réapprovisionner depuis ${res.nom}.${
              res.tronque
                ? ` Seuls les ${res.articles.length} premiers (meilleures ventes) sont affichés.`
                : ""
            }`
          : `Aucun article à descendre depuis ${res.nom} : tout ce qui y est en stock est déjà présent en rayon.`,
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err?.data?.message || "L'analyse a échoué.",
      });
    }
  };

  // Changer d'entrepôt invalide la liste : les quantités proposées et les
  // stocks affichés sont ceux de l'entrepôt analysé.
  const changerDepot = (key) => {
    if (key === depot) return;
    setDepot(key);
    setFourn("");
    setLignes([]);
    setFournisseurs([]);
    setResume(null);
    setFeedback(
      lignes.length
        ? {
            tone: "warning",
            message:
              "Entrepôt changé : la liste précédente a été vidée. Cliquez « Analyser ».",
          }
        : null,
    );
  };

  // ── Édition des lignes ────────────────────────────────────────────────────
  const majQuantite = (cle, valeur) => {
    setLignes((prev) =>
      prev.map((l) => (l.cle === cle ? { ...l, quantite: valeur } : l)),
    );
  };

  const supprimerLigne = (cle) => {
    setLignes((prev) => prev.filter((l) => l.cle !== cle));
  };

  const viderListe = () => {
    setLignes([]);
    setResume(null);
    setFeedback(null);
  };

  const ajouterArticle = async () => {
    const code = ajoutCode.trim();
    if (!code || !depot) return;
    setFeedback(null);
    try {
      const a = await resoudre({ entrepriseId, code, depot }).unwrap();
      const qte = parseQte(ajoutQte) || a.qteProposee || 1;
      setLignes((prev) => {
        // Déjà dans la liste : on additionne plutôt que de créer un doublon,
        // Stock XL relisant chaque ligne telle quelle.
        const existante = prev.find((l) => l.nart === a.nart);
        if (existante) {
          return prev.map((l) =>
            l.nart === a.nart
              ? { ...l, quantite: parseQte(l.quantite) + qte }
              : l,
          );
        }
        return [
          { ...a, cle: `${a.nart}-manuel-${Date.now()}`, quantite: qte, manuel: true },
          ...prev,
        ];
      });
      setAjoutCode("");
      setAjoutQte("");
      if (ajoutRef.current) ajoutRef.current.focus();
      setFeedback({
        tone: a.horsRegle ? "warning" : "success",
        message: a.renvoi
          ? `${a.nart} ajouté (le code ${a.renvoi} renvoie vers cette fiche).`
          : a.horsRegle
            ? `${a.nart} ajouté — attention : il est déjà en rayon (S1 ${fmtNb(a.s1)}) ou absent de ${nomEntrepot}.`
            : `${a.nart} ajouté.`,
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err?.data?.message || "Article introuvable.",
      });
    }
  };

  // ── Génération du fichier ─────────────────────────────────────────────────
  const genererFichier = async () => {
    if (!depot || !nom.trim() || totaux.lignes === 0) return;
    setFeedback(null);
    try {
      const res = await generer({
        entrepriseId,
        depot,
        nom: nom.trim(),
        lignes: lignes
          .map((l) => ({ nart: l.nart, quantite: parseQte(l.quantite) }))
          .filter((l) => l.quantite > 0),
      }).unwrap();
      setDernierFichier(res.fichier);
      setFeedback({
        tone: "success",
        message: `${res.fichier.nom} — ${res.fichier.lignes} ligne(s) écrite(s).`,
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err?.data?.message || "La génération du fichier a échoué.",
      });
    }
  };

  const peutGenerer =
    !!depot && !!nom.trim() && totaux.lignes > 0 && !generation;

  return (
    <div className="rmec">
      <div className="rmec-header">
        <h1>
          <HiTruck /> Réappro Mécalac
        </h1>
        <span className="rmec-societe">
          {entrepriseObj
            ? `${entrepriseObj.trigramme} — ${entrepriseObj.nomComplet}`
            : ""}
        </span>
      </div>

      {!entrepriseId ? (
        <div className="rmec-placeholder">
          <HiTruck />
          <p>
            Sélectionnez une société dans l'en-tête pour préparer un réappro.
          </p>
        </div>
      ) : (
        <>
          {/* ── 1. Entrepôt source ────────────────────────────────────── */}
          <div className="rmec-card">
            <div className="rmec-card-head">
              <h2>1 · Entrepôt source</h2>
              <span className="rmec-hint">
                Les articles seront descendus vers le rayon ({entrepotsData?.magasin || "Magasin"}, S1).
              </span>
            </div>

            {chargeEntrepots ? (
              <div className="rmec-loading">Lecture des entrepôts…</div>
            ) : (
              <div className="rmec-depots">
                {entrepots.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    className={`rmec-depot ${depot === e.key ? "on" : ""}`}
                    onClick={() => changerDepot(e.key)}
                  >
                    <span className="rmec-depot-nom">{e.nom}</span>
                    <span className="rmec-depot-code">{e.key}</span>
                    <span className="rmec-depot-stats">
                      {e.aReappro.toLocaleString("fr-FR")} à descendre ·{" "}
                      {e.articlesEnStock.toLocaleString("fr-FR")} en stock
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="rmec-row">
              <label className="rmec-field">
                <span>Fournisseur (facultatif)</span>
                <select
                  className="rmec-select"
                  value={fourn}
                  onChange={(e) => setFourn(e.target.value)}
                  disabled={!fournisseurs.length}
                  title={
                    fournisseurs.length
                      ? "Relancez l'analyse pour appliquer le filtre"
                      : "Disponible après une première analyse"
                  }
                >
                  <option value="">Tous les fournisseurs</option>
                  {fournisseurs.map((f) => (
                    <option key={f.code || "(sans)"} value={f.code}>
                      {(f.nom || f.code || "(sans fournisseur)") + ` (${f.nb})`}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="btn-primary"
                onClick={lancerAnalyse}
                disabled={!depot || analyse}
              >
                <HiRefresh /> {analyse ? "Analyse en cours…" : "Analyser"}
              </button>

              {resume && (
                <span className="rmec-resume">
                  {resume.total.toLocaleString("fr-FR")} article(s)
                  {resume.renvoyes
                    ? ` · ${resume.renvoyes} fiche(s) renvoyée(s) écartée(s)`
                    : ""}
                </span>
              )}
            </div>

            <p className="rmec-regle">
              Sont retenus les articles <strong>absents du rayon</strong> (S1 = 0)
              qui ont encore du stock dans l'entrepôt choisi. Quantité proposée :
              environ un mois de ventes, sans dépasser le stock de l'entrepôt.
              Articles techniques, fiches renvoyées et emplacements hors rayon
              sont écartés.
            </p>
          </div>

          {feedback && (
            <div className={`rmec-feedback ${feedback.tone}`}>
              {feedback.tone === "success" ? (
                <HiCheckCircle />
              ) : (
                <HiExclamationCircle />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* ── 2. Liste à ajuster ────────────────────────────────────── */}
          {lignes.length > 0 && (
            <div className="rmec-card">
              <div className="rmec-card-head">
                <h2>2 · Articles à réapprovisionner</h2>
                <span className="rmec-hint">
                  {totaux.lignes} ligne(s) retenue(s) · {fmtNb(totaux.unites)}{" "}
                  unité(s)
                  {totaux.ignorees
                    ? ` · ${totaux.ignorees} ligne(s) à 0 (non écrite(s))`
                    : ""}
                </span>
              </div>

              <div className="rmec-toolbar">
                <div className="rmec-search">
                  <HiSearch />
                  <input
                    type="text"
                    placeholder="Filtrer (code, désignation, fournisseur, rayon)…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="rmec-compte">
                  {lignesFiltrees.length} / {lignes.length} affichée(s)
                </span>
                <button className="btn-danger" onClick={viderListe}>
                  <HiTrash /> Vider la liste
                </button>
              </div>

              <div className="rmec-table-wrap">
                <table className="rmec-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Désignation</th>
                      <th>Fournisseur</th>
                      <th>Rayon (GISM1)</th>
                      <th className="num">Rayon S1</th>
                      <th className="num">Stock {nomEntrepot}</th>
                      <th className="num" title="Ventes des 12 derniers mois">
                        Ventes 12 m
                      </th>
                      <th className="num" title="Vente moyenne mensuelle">
                        Vte/mois
                      </th>
                      <th className="num">Quantité</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lignesFiltrees.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="rmec-vide">
                          Aucune ligne ne correspond au filtre.
                        </td>
                      </tr>
                    ) : (
                      lignesFiltrees.map((l) => {
                        const q = parseQte(l.quantite);
                        return (
                          <tr
                            key={l.cle}
                            className={`${l.manuel ? "manuelle" : ""} ${
                              q <= 0 ? "ignoree" : ""
                            }`.trim()}
                          >
                            <td className="mono">
                              {l.nart}
                              {l.manuel && (
                                <span className="rmec-badge">ajouté</span>
                              )}
                            </td>
                            <td>{l.design}</td>
                            <td>{l.fournNom || l.fourn || "—"}</td>
                            <td>
                              {l.gism1 ? (
                                <>
                                  <span className="rmec-gis">{l.gism1}</span>
                                  {l.rayonMagasin && (
                                    <span className="rmec-gis-lib">
                                      {l.rayonMagasin}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="rmec-sans">sans gisement</span>
                              )}
                            </td>
                            <td className="num">{fmtNb(l.s1)}</td>
                            <td className="num">{fmtNb(l.stockDepot)}</td>
                            <td className="num">{fmtNb(l.ventes12)}</td>
                            <td className="num">{fmtNb(l.vteMoyMois)}</td>
                            <td className="num">
                              <input
                                className="rmec-qte"
                                type="number"
                                step="any"
                                min="0"
                                value={l.quantite ?? ""}
                                onChange={(e) =>
                                  majQuantite(l.cle, e.target.value)
                                }
                              />
                            </td>
                            <td className="num">
                              <button
                                className="rmec-del"
                                onClick={() => supprimerLigne(l.cle)}
                                title="Retirer cette ligne"
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

              {/* Ajout manuel */}
              <div className="rmec-ajout">
                <span className="rmec-ajout-titre">
                  <HiPlus /> Ajouter un article
                </span>
                <input
                  ref={ajoutRef}
                  type="text"
                  className="rmec-input"
                  placeholder="Code-barres, code article ou référence…"
                  value={ajoutCode}
                  onChange={(e) => setAjoutCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      ajouterArticle();
                    }
                  }}
                />
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="rmec-input rmec-input-qte"
                  placeholder="Qté"
                  value={ajoutQte}
                  onChange={(e) => setAjoutQte(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      ajouterArticle();
                    }
                  }}
                />
                <button
                  className="btn-secondary"
                  onClick={ajouterArticle}
                  disabled={!ajoutCode.trim() || resolution}
                >
                  {resolution ? "Recherche…" : "Ajouter"}
                </button>
                <span className="rmec-hint">
                  Quantité vide = celle proposée par la règle.
                </span>
              </div>
            </div>
          )}

          {/* ── 3. Génération ─────────────────────────────────────────── */}
          {lignes.length > 0 && (
            <div className="rmec-card">
              <div className="rmec-card-head">
                <h2>3 · Générer le fichier</h2>
                <span className="rmec-hint">
                  Déposé dans collect_sec, au format Stock XL.
                </span>
              </div>

              <div className="rmec-row">
                <label className="rmec-field rmec-grow">
                  <span>Nom du réappro</span>
                  <input
                    type="text"
                    className="rmec-input"
                    placeholder="ex : 04-11 matin"
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </label>
                <button
                  className="btn-primary"
                  onClick={genererFichier}
                  disabled={!peutGenerer}
                  title={
                    totaux.lignes === 0
                      ? "Aucune ligne avec une quantité"
                      : !nom.trim()
                        ? "Donnez un nom au réappro"
                        : undefined
                  }
                >
                  <HiDownload />{" "}
                  {generation ? "Génération…" : "Générer le fichier"}
                </button>
              </div>

              <div className="rmec-apercu">
                <HiDocumentText />
                <code>{nomFichierApercu(nomEntrepot, nom)}</code>
                <span className="rmec-hint">
                  {totaux.lignes} ligne(s) · {fmtNb(totaux.unites)} unité(s)
                </span>
              </div>

              {dernierFichier && (
                <div className="rmec-feedback success">
                  <HiCheckCircle />
                  <span>
                    Fichier écrit :{" "}
                    <code>{dernierFichier.chemin || dernierFichier.nom}</code>
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AdminReapproMecalacScreen;
