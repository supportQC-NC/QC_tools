// src/screens/admin/AdminPerformanceDockScreen.jsx
//
// Performance du RÉAPPRO MAGASIN : combien d'ARTICLES le dock a
// réapprovisionnés chaque jour (une ligne de l'onglet DONNEES du fichier
// reapro_mag = un article). On ne parle jamais de « lignes » ici : l'unité
// que l'équipe compte, et sur laquelle elle est mesurée, est l'article.
//
// ⚠️ Tout le calcul (filtrage + moyenne) est fait par le serveur, pas ici :
// l'export Excel passe par le même service, les deux ne peuvent donc pas
// diverger. L'écran n'envoie que les critères.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Area,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import {
  HiRefresh,
  HiDownload,
  HiChartBar,
  HiOutlineFilter,
  HiX,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import {
  useGetPerformanceDockQuery,
  usePrendrePhotoReapproMutation,
  useRattraperHistoriqueReapproMutation,
} from "../../slices/performanceDockApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { BASE_URL } from "../../constants";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminPerformanceDockScreen.css";

// Palette validée sur la surface sombre de l'admin (#12121a) :
//  - volume = UNE seule teinte (série unique -> pas de couleur catégorielle) ;
//  - écart  = paire divergente vert/rouge, dont le SIGNE est porté par la
//    position (au-dessus / en-dessous de zéro) et pas seulement par la couleur
//    — vert et rouge sont proches en vision deutan (ΔE 7,1).
// ⚠️ L'unité mesurée est une CHARGE : le nombre d'articles qu'il a fallu aller
// réapprovisionner. Beaucoup d'articles = grosse journée à rattraper, donc
// ROUGE au-dessus de la moyenne et VERT en-dessous — l'inverse d'un indicateur
// de chiffre d'affaires (demande client du 18/09/2026).
const SERIE = "#3987e5"; // bleu, volume
const AU_DESSUS = "#e66767"; // rouge, écart positif = plus de charge
const EN_DESSOUS = "#0ca30c"; // vert, écart négatif = moins de charge
const MOYENNE = "#c9a227"; // repère moyenne, distinct des deux pôles
const GRILLE = "#24242e";
const AXE = "#8b949e";

// Tranches de ventes : série ORDONNÉE (aucune < faible < moyenne < forte), donc
// une rampe SÉQUENTIELLE d'une seule teinte — pas quatre couleurs catégorielles,
// qui suggéreraient des familles sans ordre. Rampe monotone en clarté, chaque
// palier au-dessus de 3:1 sur le fond admin (#12121a) ; l'identité est portée
// par le libellé écrit sur chaque tuile, jamais par la couleur seule.
const TRANCHE_COULEURS = {
  aucune: "#7fb2f0",
  faible: "#5a9bea",
  moyenne: "#3987e5",
  forte: "#2a6cbd",
};
// Du plus vendeur au moins vendeur : c'est l'ordre dans lequel on veut lire la
// charge — ce qui part toutes les semaines d'abord.
const ORDRE_TRANCHES = ["forte", "moyenne", "faible", "aucune"];
const LIB_TRANCHES = {
  forte: "≥ 1 vente / semaine",
  moyenne: "1 / mois à 1 / semaine",
  faible: "< 1 vente / mois",
  aucune: "aucune vente sur 12 mois",
};
const LIB_TRANCHES_COURT = {
  forte: "≥ 1 / sem.",
  moyenne: "1 / mois → 1 / sem.",
  faible: "< 1 / mois",
  aucune: "aucune vente",
};

const fNum = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");
const fSigne = (n) => (n >= 0 ? `+${fNum(n)}` : fNum(n));

const MOIS_COURT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

// Ordre d'affichage du filtre : la semaine commence le lundi, pas le dimanche
// (Date#getDay() renvoie 0 pour dimanche — on garde ses indices en valeur).
const JOURS_FILTRE = [
  { jour: 1, court: "L", long: "lundi" },
  { jour: 2, court: "M", long: "mardi" },
  { jour: 3, court: "M", long: "mercredi" },
  { jour: 4, court: "J", long: "jeudi" },
  { jour: 5, court: "V", long: "vendredi" },
  { jour: 6, court: "S", long: "samedi" },
  { jour: 0, court: "D", long: "dimanche" },
];

// ⚠️ Plus de seuils min/max sur le volume : filtrer les journées d'après la
// valeur qu'on mesure, puis les comparer à une moyenne calculée sur les
// survivantes, était circulaire — plus on serrait les seuils, plus tout
// paraissait « dans la moyenne ». Les filtres qui restent portent sur le CONTENU
// de la journée (rythme de vente, fournisseur), une question métier.
const CRITERES_PAR_DEFAUT = {
  debut: "",
  fin: "",
  jours: [], // vide = tous
  exclureZero: false,
  tranches: [], // vide = toutes
  fourn: "", // "" = tous
  baseMoyenne: "globale", // la moyenne historique reste l'étalon par défaut
};

// Les dates viennent du nom de fichier (yyyy-mm-dd) ; si le nom ne suit pas la
// convention le service renvoie le nom brut — on l'affiche alors tel quel.
const enDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const enIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const fmtJour = (s) => {
  const d = enDate(s);
  return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : s;
};
const fmtJourLong = (s) => {
  const d = enDate(s);
  return d
    ? `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS_COURT[d.getMonth()]} ${d.getFullYear()}`
    : s;
};

// Échelle « zoomée » : avec des volumes qui tournent tous autour de 1 700, un axe
// qui part de 0 écrase les écarts et toutes les journées se ressemblent. On ne le
// fait QUE sur la courbe (une aire lit une position, pas une longueur) ; les
// barres d'écart, elles, restent ancrées à zéro.
const pasJoli = (amplitude) => {
  const base = Math.pow(10, Math.floor(Math.log10(Math.max(amplitude, 1))));
  const n = Math.max(amplitude, 1) / base;
  const mult = n <= 1.5 ? 1 : n <= 3 ? 2 : n <= 7 ? 5 : 10;
  return Math.max(1, (base * mult) / 2);
};
const domaineZoome = (valeurs) => {
  if (!valeurs.length) return [0, "auto"];
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const amplitude = max - min || Math.max(1, max * 0.1);
  const pas = pasJoli(amplitude);
  return [
    Math.max(0, Math.floor((min - amplitude * 0.4) / pas) * pas),
    Math.ceil((max + amplitude * 0.3) / pas) * pas,
  ];
};

// Barre d'écart : coin arrondi du côté opposé à la ligne de zéro uniquement.
const BarreEcart = ({ x, y, width, height, fill }) => {
  const w = Math.max(width, 1);
  const h = Math.abs(height);
  const r = Math.min(4, w / 2, h);
  const haut = height >= 0; // recharts : hauteur négative = barre sous le zéro
  const t = haut ? y : y + height;
  const chemin = haut
    ? `M${x},${t + h} L${x},${t + r} Q${x},${t} ${x + r},${t} L${x + w - r},${t} Q${x + w},${t} ${x + w},${t + r} L${x + w},${t + h} Z`
    : `M${x},${t} L${x},${t + h - r} Q${x},${t + h} ${x + r},${t + h} L${x + w - r},${t + h} Q${x + w},${t + h} ${x + w},${t + h - r} L${x + w},${t} Z`;
  return <path d={chemin} fill={fill} />;
};

const InfoBulle = ({ active, payload, label, moyenne }) => {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  const ecart = Math.round(p.articles - moyenne);
  const pct = moyenne ? (ecart / moyenne) * 100 : 0;
  return (
    <div className="pd-tooltip">
      <div className="pd-tt-date">{fmtJourLong(label)}</div>
      <div className="pd-tt-val">{fNum(p.articles)} articles</div>
      <div className={`pd-tt-diff ${ecart >= 0 ? "pos" : "neg"}`}>
        {fSigne(ecart)} vs moyenne ({pct >= 0 ? "+" : ""}
        {pct.toFixed(1)} %)
      </div>
    </div>
  );
};

const InfoBulleJour = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="pd-tooltip">
      <div className="pd-tt-date">
        {p.label.charAt(0).toUpperCase() + p.label.slice(1)} · {fNum(p.nbJours)}{" "}
        journée{p.nbJours > 1 ? "s" : ""}
      </div>
      <div className="pd-tt-val">{fNum(p.moyenneArrondie)} articles / jour</div>
      <div className={`pd-tt-diff ${p.ecart >= 0 ? "pos" : "neg"}`}>
        {fSigne(p.ecart)} vs moyenne
      </div>
    </div>
  );
};

const InfoBulleFournisseur = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const f = payload[0].payload;
  return (
    <div className="pd-tooltip">
      <div className="pd-tt-date">{f.nom || `(code ${f.code || "—"})`}</div>
      <div className="pd-tt-val">
        {fNum(f.moyenneArrondie)} articles / jour en moyenne
      </div>
      <div className="pd-tt-diff">
        {fNum(f.ventesMoyennes)} ventes 12 mois cumulées · présent{" "}
        {fNum(f.jours)} jour(s)
      </div>
    </div>
  );
};

const VUES = [
  { cle: "volume", libelle: "Volume" },
  { cle: "ecart", libelle: "Écart vs moyenne" },
  { cle: "fournisseurs", libelle: "Fournisseurs" },
  { cle: "semaine", libelle: "Jours de semaine" },
  { cle: "table", libelle: "Tableau" },
];

const AdminPerformanceDockScreen = () => {
  // Société du sélecteur GLOBAL du header : la mesure se lit dans la fiche
  // article (S1..S5), elle n'a plus rien de propre à QC.
  const societe = useSelector(selectGlobalDossier);
  const [criteres, setCriteres] = useState(CRITERES_PAR_DEFAUT);
  const [vue, setVue] = useState("volume");
  const [erreurExport, setErreurExport] = useState("");
  const [exportEnCours, setExportEnCours] = useState(false);

  // Query string envoyée au serveur : on n'y met que ce qui s'écarte du défaut,
  // pour que la requête « sans critère » reste une seule entrée de cache.
  const params = useMemo(() => {
    const p = {};
    if (criteres.debut) p.debut = criteres.debut;
    if (criteres.fin) p.fin = criteres.fin;
    if (criteres.jours.length && criteres.jours.length < 7) {
      p.jours = [...criteres.jours].sort((a, b) => a - b).join(",");
    }
    if (criteres.exclureZero) p.exclureZero = "1";
    if (criteres.tranches.length && criteres.tranches.length < 4) {
      p.tranches = criteres.tranches.join(",");
    }
    if (criteres.fourn) p.fourn = criteres.fourn;
    if (criteres.baseMoyenne === "selection") p.baseMoyenne = "selection";
    return p;
  }, [criteres]);

  // Les seuils se saisissent au clavier : sans ce délai, chaque frappe partait
  // en requête.
  const [paramsEnvoyes, setParamsEnvoyes] = useState(params);
  useEffect(() => {
    const t = setTimeout(() => setParamsEnvoyes(params), 300);
    return () => clearTimeout(t);
  }, [params]);

  const { data, isLoading, isFetching, error } = useGetPerformanceDockQuery(
    { societe, ...paramsEnvoyes },
    { skip: !societe },
  );
  const [prendrePhoto, { isLoading: photoEnCours }] =
    usePrendrePhotoReapproMutation();
  const [rattraper, { isLoading: rattrapageEnCours }] =
    useRattraperHistoriqueReapproMutation();
  const [infoAction, setInfoAction] = useState("");

  // Un changement de critère change la clé de cache : `data` repasse à undefined
  // le temps de la réponse et l'écran clignoterait. On garde le dernier rapport
  // affiché pendant le recalcul.
  const dernier = useRef(null);
  const derniereSociete = useRef(societe);
  if (derniereSociete.current !== societe) {
    // Changer de société ne doit pas laisser le rapport de la précédente à
    // l'écran : ce sont des chiffres, on les croirait.
    dernier.current = null;
    derniereSociete.current = societe;
  }
  if (data) dernier.current = data;
  const rapport = data || dernier.current;

  const rows = useMemo(() => rapport?.rows || [], [rapport]);
  const stats = rapport?.stats;
  const globales = rapport?.statsGlobales;
  const moyenne = rapport?.moyenne || 0;
  const bornes = rapport?.bornes || { premiere: "", derniere: "" };
  const ecartees = rapport?.ecartees || [];
  const fournisseurs = useMemo(
    () => rapport?.parFournisseur || [],
    [rapport],
  );
  const tranchesMoy = rapport?.tranchesMoyennes || null;
  const contexte = rapport?.dernier || null;
  const surSelection = criteres.baseMoyenne === "selection";

  const filtreActif =
    Boolean(criteres.debut) ||
    Boolean(criteres.fin) ||
    (criteres.jours.length > 0 && criteres.jours.length < 7) ||
    criteres.exclureZero ||
    (criteres.tranches.length > 0 && criteres.tranches.length < 4) ||
    Boolean(criteres.fourn) ||
    surSelection;

  const majCritere = (patch) => setCriteres((c) => ({ ...c, ...patch }));

  const basculerJour = (jour) =>
    setCriteres((c) => ({
      ...c,
      jours: c.jours.includes(jour)
        ? c.jours.filter((j) => j !== jour)
        : [...c.jours, jour],
    }));

  // Raccourcis de période : calés sur la DERNIÈRE journée disponible et non sur
  // aujourd'hui — les fichiers reapro_mag peuvent avoir plusieurs jours de
  // retard, « 30 derniers jours » sortirait sinon à moitié vide.
  const periodeRapide = (nbJours) => {
    const fin = enDate(bornes.derniere);
    if (!fin) return;
    if (!nbJours) {
      majCritere({ debut: "", fin: "" });
      return;
    }
    const debut = new Date(fin);
    debut.setDate(debut.getDate() - (nbJours - 1));
    const premiere = enDate(bornes.premiere);
    majCritere({
      debut: enIso(premiere && debut < premiere ? premiere : debut),
      fin: enIso(fin),
    });
  };

  const basculerTranche = (cle) =>
    setCriteres((c) => ({
      ...c,
      tranches: c.tranches.includes(cle)
        ? c.tranches.filter((t) => t !== cle)
        : [...c.tranches, cle],
    }));

  // Relevé du jour à la demande : le planificateur le prend à 18:00, ce bouton
  // sert à amorcer une société ou à revoir le chiffre après une correction.
  const handlePhoto = async () => {
    setInfoAction("");
    setErreurExport("");
    try {
      const r = await prendrePhoto(societe).unwrap();
      setInfoAction(r.message || "Photo enregistrée.");
    } catch (e) {
      setErreurExport(e?.data?.message || "Échec de la photo du jour.");
    }
  };

  // Rattrapage : rejoue les journées déjà archivées dans reapro_mag avec la
  // MÊME règle, pour que la série ne démarre pas vide.
  const handleRattrapage = async () => {
    setInfoAction("");
    setErreurExport("");
    try {
      const r = await rattraper({ societe }).unwrap();
      setInfoAction(r.message || "Rattrapage terminé.");
      if (!r.ok) setErreurExport(r.message || "");
    } catch (e) {
      setErreurExport(e?.data?.message || "Échec du rattrapage.");
    }
  };

  // Export serveur (ExcelJS) : mise en forme complète, mêmes critères que
  // l'écran. L'ancien export navigateur (SheetJS) ne savait pas styler.
  const handleExport = async () => {
    setErreurExport("");
    setExportEnCours(true);
    try {
      const qs = new URLSearchParams(paramsEnvoyes).toString();
      const res = await fetch(
        `${BASE_URL}/api/performance-dock/${societe}/excel${qs ? `?${qs}` : ""}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        let msg = `Échec de l'export (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        criteres.debut || criteres.fin
          ? `reappro_magasin_${societe}_${criteres.debut || bornes.premiere}_${
              criteres.fin || bornes.derniere
            }.xlsx`
          : `reappro_magasin_${societe}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setErreurExport(e.message || "Erreur lors de l'export.");
    } finally {
      setExportEnCours(false);
    }
  };

  // Repères max / min / dernier jour de la sélection.
  const { domaine, reperes, dernierJour } = useMemo(() => {
    const valeurs = rows.map((r) => r.articles);
    let iMax = -1;
    let iMin = -1;
    rows.forEach((r, i) => {
      if (iMax < 0 || r.articles > rows[iMax].articles) iMax = i;
      if (iMin < 0 || r.articles < rows[iMin].articles) iMin = i;
    });
    return {
      domaine: domaineZoome(valeurs),
      reperes: { max: rows[iMax] || null, min: rows[iMin] || null },
      dernierJour: rows.length ? rows[rows.length - 1] : null,
    };
  }, [rows]);

  // Au-delà d'un mois de données, une étiquette sur deux suffit.
  const pasEtiquettes = rows.length > 31 ? Math.ceil(rows.length / 20) : 0;
  const loading = isLoading || (isFetching && !rapport);

  const axeX = (
    <XAxis
      dataKey="date"
      tickFormatter={fmtJour}
      tick={{ fill: AXE, fontSize: 11 }}
      tickLine={false}
      axisLine={{ stroke: GRILLE }}
      interval={pasEtiquettes || "preserveStartEnd"}
      minTickGap={8}
      height={28}
    />
  );

  const panneauFiltres = (
    <div className="pd-filtres">
      <div className="pd-filtres-titre">
        <HiOutlineFilter /> Critères
        {filtreActif && (
          <button
            type="button"
            className="pd-reset"
            onClick={() => setCriteres(CRITERES_PAR_DEFAUT)}
          >
            <HiX /> Réinitialiser
          </button>
        )}
      </div>

      <div className="pd-filtres-grille">
        <div className="pd-filtre">
          <label>Période</label>
          <div className="pd-dates">
            <input
              type="date"
              value={criteres.debut}
              min={bornes.premiere || undefined}
              max={bornes.derniere || undefined}
              onChange={(e) => majCritere({ debut: e.target.value })}
            />
            <span>→</span>
            <input
              type="date"
              value={criteres.fin}
              min={bornes.premiere || undefined}
              max={bornes.derniere || undefined}
              onChange={(e) => majCritere({ fin: e.target.value })}
            />
          </div>
          <div className="pd-raccourcis">
            {[
              { l: "7 j", n: 7 },
              { l: "30 j", n: 30 },
              { l: "90 j", n: 90 },
              { l: "Tout", n: 0 },
            ].map((r) => (
              <button key={r.l} type="button" onClick={() => periodeRapide(r.n)}>
                {r.l}
              </button>
            ))}
          </div>
        </div>

        <div className="pd-filtre">
          <label>Jours de la semaine</label>
          <div className="pd-jours">
            {JOURS_FILTRE.map((j) => {
              const actif = !criteres.jours.length || criteres.jours.includes(j.jour);
              return (
                <button
                  key={j.long}
                  type="button"
                  title={j.long}
                  aria-pressed={actif}
                  className={actif ? "actif" : ""}
                  onClick={() => basculerJour(j.jour)}
                >
                  {j.court}
                </button>
              );
            })}
          </div>
          <small>Aucun jour coché = tous les jours.</small>
        </div>

        <div className="pd-filtre">
          <label>Rythme de vente des articles</label>
          <div className="pd-tranches-filtre">
            {ORDRE_TRANCHES.map((cle) => {
              const actif =
                !criteres.tranches.length || criteres.tranches.includes(cle);
              return (
                <button
                  key={cle}
                  type="button"
                  aria-pressed={actif}
                  className={actif ? "actif" : ""}
                  onClick={() => basculerTranche(cle)}
                >
                  <i style={{ background: TRANCHE_COULEURS[cle] }} />
                  {LIB_TRANCHES[cle]}
                </button>
              );
            })}
          </div>
          <small>
            Aucune coche = tous les articles. Un article à réapprovisionner qui
            ne se vend pas n'a pas le poids d'un article qui part chaque semaine.
          </small>
          <label className="pd-check">
            <input
              type="checkbox"
              checked={criteres.exclureZero}
              onChange={(e) => majCritere({ exclureZero: e.target.checked })}
            />
            Ignorer les journées sans activité (0 article)
          </label>
        </div>

        <div className="pd-filtre">
          <label>Fournisseur</label>
          <select
            value={criteres.fourn}
            onChange={(e) => majCritere({ fourn: e.target.value })}
          >
            <option value="">Tous les fournisseurs</option>
            {fournisseurs.map((f) => (
              <option key={f.code} value={f.code}>
                {f.nom || `(code ${f.code || "—"})`} · {fNum(f.moyenneArrondie)}{" "}
                art./jour
              </option>
            ))}
          </select>
          <small>
            {criteres.fourn
              ? "La courbe ne compte plus que les articles de ce fournisseur ; le filtre par rythme de vente est alors ignoré."
              : "Restreindre la courbe à un seul fournisseur."}
          </small>
        </div>

        <div className="pd-filtre">
          <label>Base de la moyenne</label>
          <div className="pd-base">
            <button
              type="button"
              className={!surSelection ? "actif" : ""}
              onClick={() => majCritere({ baseMoyenne: "globale" })}
            >
              Toutes les journées
            </button>
            <button
              type="button"
              className={surSelection ? "actif" : ""}
              onClick={() => majCritere({ baseMoyenne: "selection" })}
            >
              Journées filtrées
            </button>
          </div>
          <small>
            {surSelection
              ? `Moyenne recalculée sur les ${fNum(stats?.nbJours || 0)} journées retenues (référence : ${fNum(globales?.moyenne || 0)}).`
              : "Moyenne de référence, calculée sur tout l'historique disponible."}
          </small>
        </div>
      </div>

      {filtreActif && (
        <div className="pd-filtres-resume">
          {fNum(stats?.nbJours || 0)} journée(s) retenue(s) sur{" "}
          {fNum(globales?.nbJours || 0)}
          {ecartees.length > 0 && <> · {fNum(ecartees.length)} écartée(s)</>}
        </div>
      )}
    </div>
  );

  return (
    <div className="admin-performance-dock">
      <div className="pd-header">
        <h1>
          <HiChartBar /> Performance réappro magasin
        </h1>
        <div className="pd-actions">
          <button
            className="pd-btn"
            onClick={handlePhoto}
            disabled={!societe || photoEnCours || isFetching}
            title="Relit les fiches articles maintenant et met à jour le relevé d'aujourd'hui. Le relevé est pris tout seul chaque soir à 18:00."
          >
            <HiRefresh className={photoEnCours ? "spin" : ""} /> Recompter
            aujourd'hui
          </button>
          <button
            className="pd-btn"
            onClick={handleRattrapage}
            disabled={!societe || rattrapageEnCours}
            title="Recalcule les journées d'avant la mise en service, à partir des rapports reapro_mag déjà archivés, avec la même règle de comptage."
          >
            {rattrapageEnCours ? "Calcul…" : "Récupérer les jours passés"}
          </button>
          <button
            className="pd-btn primary"
            onClick={handleExport}
            disabled={!rows.length || exportEnCours}
          >
            <HiDownload /> {exportEnCours ? "Génération…" : "Excel"}
          </button>
        </div>
      </div>

      <p className="pd-subtitle">
        Nombre d'<strong>articles à réapprovisionner</strong> par jour — rien en
        rayon (<strong>S1 = 0</strong>) alors qu'il reste du stock dans un autre
        dépôt (<strong>S2 à S5 &gt; 0</strong>). Même règle que la liste
        « rayon vide » de l'écran Listes de réappro.
        {rapport?.societeNom ? ` · ${rapport.societeNom}` : ""}
      </p>

      {/* Sans cette phrase, personne ne peut deviner que le graphique est une
          suite de relevés quotidiens et non un calcul refait à chaque
          ouverture — ni pourquoi il existe un bouton pour en refaire un. */}
      {societe && (
        <p className="pd-explication">
          Le stock ne garde aucune trace du passé : la fiche article ne dit que
          l'état d'aujourd'hui. Pour construire une courbe, l'application
          <strong> compte les articles concernés automatiquement chaque soir à
          18 h, après la fermeture</strong>, et conserve le résultat. Chaque
          point du graphique est donc l'état de fin de journée : ce qui restait
          à descendre le soir même.
          {contexte
            ? ` Dernier relevé : ${fmtJourLong(contexte.date)} — ${fNum(
                contexte.total,
              )} articles.`
            : " Aucun relevé pour l'instant."}
        </p>
      )}

      {infoAction && <div className="pd-info">{infoAction}</div>}

      {!societe ? (
        <div className="pd-empty">
          Choisissez une société dans le sélecteur du bandeau.
        </div>
      ) : loading ? (
        <div className="pd-loading">
          <Loader />
          <p>Lecture des photos quotidiennes…</p>
        </div>
      ) : error ? (
        <div className="pd-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : (
        <>
          {panneauFiltres}
          {erreurExport && <div className="pd-error compact">{erreurExport}</div>}
          {isFetching && <div className="pd-refreshing">Recalcul…</div>}

          {rows.length === 0 ? (
            <div className="pd-empty">
              {globales?.nbJours
                ? "Aucune journée ne correspond aux critères."
                : rapport?.message || "Aucune donnée."}
            </div>
          ) : (
            <>
              <div className="pd-kpis">
                <div className="pd-kpi avg">
                  <span className="v">{fNum(moyenne)}</span>
                  <span className="l">
                    Moyenne / jour{" "}
                    <b>{surSelection ? "(sélection)" : "(référence)"}</b>
                  </span>
                </div>
                <div className="pd-kpi">
                  <span className="v">{fNum(stats.mediane)}</span>
                  <span className="l">Médiane / jour</span>
                </div>
                {dernierJour && (
                  <div className="pd-kpi">
                    <span className="v">{fNum(dernierJour.articles)}</span>
                    <span className="l">
                      Dernier jour ({fmtJour(dernierJour.date)}){" "}
                      <b className={dernierJour.ecart >= 0 ? "pos" : "neg"}>
                        {fSigne(dernierJour.ecart)}
                      </b>
                    </span>
                  </div>
                )}
                <div className="pd-kpi haut">
                  <span className="v">{fNum(stats.max)}</span>
                  <span className="l">
                    Maximum {reperes.max ? `(${fmtJour(reperes.max.date)})` : ""}
                  </span>
                </div>
                <div className="pd-kpi bas">
                  <span className="v">{fNum(stats.min)}</span>
                  <span className="l">
                    Minimum {reperes.min ? `(${fmtJour(reperes.min.date)})` : ""}
                  </span>
                </div>
                {/* ⚠️ Plus de « total d'articles sur la période » : additionner
                    des photos compterait dix fois le même article resté dix
                    jours en rayon vide (chez QC, 96 % de la liste est identique
                    d'un jour sur l'autre). Ce qui a du sens, c'est le contexte
                    du dernier jour connu. */}
                {contexte && (
                  <div className="pd-kpi">
                    <span className="v">{fNum(contexte.sansGisement)}</span>
                    <span className="l">
                      Sans emplacement <b>({fmtJour(contexte.date)})</b>
                    </span>
                  </div>
                )}
                {contexte && (
                  <div className="pd-kpi">
                    <span className="v">{fNum(contexte.sansStock)}</span>
                    <span className="l">
                      Rayon vide <b>sans stock nulle part</b>
                    </span>
                  </div>
                )}
                <div className="pd-kpi">
                  <span className="v">{fNum(stats.nbJours)}</span>
                  <span className="l">Journées retenues</span>
                </div>
              </div>

              {/* Qualité de la charge. Des tuiles et non un empilement : la
                  série est ordonnée, chaque palier porte son libellé écrit, et
                  l'identité ne repose donc jamais sur la couleur seule. */}
              {tranchesMoy && !criteres.fourn && (
                <div className="pd-tranches">
                  <div className="pd-tranches-titre">
                    Sur une journée type, ces articles se vendent :
                  </div>
                  <div className="pd-tranches-tuiles">
                    {ORDRE_TRANCHES.map((cle) => {
                      const n = tranchesMoy[cle] || 0;
                      const tot = ORDRE_TRANCHES.reduce(
                        (t, k) => t + (tranchesMoy[k] || 0),
                        0,
                      );
                      return (
                        <div
                          key={cle}
                          className="pd-tranche"
                          style={{ borderTopColor: TRANCHE_COULEURS[cle] }}
                        >
                          <span
                            className="v"
                            style={{ color: TRANCHE_COULEURS[cle] }}
                          >
                            {fNum(n)}
                          </span>
                          <span className="l">{LIB_TRANCHES_COURT[cle]}</span>
                          <span className="p">
                            {tot ? ((n / tot) * 100).toFixed(0) : 0} %
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="pd-note">
                    Moyennes par jour. Un article à réapprovisionner qui ne se
                    vend pas est du stock qui dort ; un article qui part chaque
                    semaine et qui manque en rayon est une vente perdue.
                  </p>
                </div>
              )}

              <div className="pd-vues" role="tablist" aria-label="Affichage">
                {VUES.map((v) => (
                  <button
                    key={v.cle}
                    role="tab"
                    aria-selected={vue === v.cle}
                    className={`pd-vue ${vue === v.cle ? "active" : ""}`}
                    onClick={() => setVue(v.cle)}
                  >
                    {v.libelle}
                  </button>
                ))}
              </div>

              <div className="pd-chart-wrap">
                {vue === "volume" && (
                  <>
                    <ResponsiveContainer width="100%" height={420}>
                      <ComposedChart
                        data={rows}
                        margin={{ top: 24, right: 28, left: 0, bottom: 4 }}
                        accessibilityLayer
                      >
                        <defs>
                          <linearGradient id="pdAire" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={SERIE} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={SERIE} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={GRILLE} vertical={false} />
                        {axeX}
                        <YAxis
                          domain={domaine}
                          tick={{ fill: AXE, fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => v.toLocaleString("fr-FR")}
                          width={58}
                        />
                        <Tooltip
                          cursor={{ stroke: AXE, strokeWidth: 1 }}
                          content={<InfoBulle moyenne={moyenne} />}
                        />
                        <ReferenceLine
                          y={moyenne}
                          stroke={MOYENNE}
                          strokeWidth={1.5}
                          strokeDasharray="6 4"
                          label={{
                            value: `Moyenne ${fNum(moyenne)} art./j`,
                            position: "insideTopRight",
                            fill: MOYENNE,
                            fontSize: 11,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="articles"
                          stroke={SERIE}
                          strokeWidth={2}
                          fill="url(#pdAire)"
                          dot={{ r: 3, fill: SERIE, stroke: "none" }}
                          activeDot={{ r: 5, stroke: "#12121a", strokeWidth: 2 }}
                        />
                        {/* Étiquettes directes sur les deux journées qui comptent,
                            plutôt qu'un nombre sur chaque point. */}
                        {reperes.max && (
                          <ReferenceDot
                            x={reperes.max.date}
                            y={reperes.max.articles}
                            r={5}
                            fill={AU_DESSUS}
                            stroke="#12121a"
                            strokeWidth={2}
                            label={{
                              value: `▲ ${fNum(reperes.max.articles)}`,
                              position: "top",
                              fill: AU_DESSUS,
                              fontSize: 11,
                            }}
                          />
                        )}
                        {reperes.min && (
                          <ReferenceDot
                            x={reperes.min.date}
                            y={reperes.min.articles}
                            r={5}
                            fill={EN_DESSOUS}
                            stroke="#12121a"
                            strokeWidth={2}
                            label={{
                              value: `▼ ${fNum(reperes.min.articles)}`,
                              position: "bottom",
                              fill: EN_DESSOUS,
                              fontSize: 11,
                            }}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                    <p className="pd-note">
                      Échelle resserrée autour des valeurs pour rendre les écarts
                      lisibles — l'axe ne part pas de zéro. Pour comparer en valeur
                      absolue, voir l'onglet « Écart vs moyenne ».
                    </p>
                  </>
                )}

                {vue === "ecart" && (
                  <>
                    <ResponsiveContainer width="100%" height={420}>
                      <BarChart
                        data={rows}
                        margin={{ top: 24, right: 28, left: 0, bottom: 4 }}
                        barCategoryGap="22%"
                        accessibilityLayer
                      >
                        <CartesianGrid stroke={GRILLE} vertical={false} />
                        {axeX}
                        <YAxis
                          tick={{ fill: AXE, fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => fSigne(v)}
                          width={58}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          content={<InfoBulle moyenne={moyenne} />}
                        />
                        <ReferenceLine
                          y={0}
                          stroke={MOYENNE}
                          strokeWidth={1.5}
                          label={{
                            value: `Moyenne ${fNum(moyenne)} art./j`,
                            position: "insideTopRight",
                            fill: MOYENNE,
                            fontSize: 11,
                          }}
                        />
                        <Bar dataKey="ecart" shape={<BarreEcart />} maxBarSize={44}>
                          {rows.map((r) => (
                            <Cell
                              key={r.date}
                              fill={r.ecart >= 0 ? AU_DESSUS : EN_DESSOUS}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="pd-legend">
                      <span>
                        <i className="dot" style={{ background: AU_DESSUS }} /> Au‑dessus de
                        la moyenne
                      </span>
                      <span>
                        <i className="dot" style={{ background: EN_DESSOUS }} /> En‑dessous
                        de la moyenne
                      </span>
                    </div>
                  </>
                )}

                {vue === "fournisseurs" && (
                  <>
                    {fournisseurs.length === 0 ? (
                      <div className="pd-empty">
                        Aucun fournisseur sur la période retenue.
                      </div>
                    ) : (
                      <>
                        <ResponsiveContainer
                          width="100%"
                          height={Math.max(
                            260,
                            40 * Math.min(fournisseurs.length, 15) + 40,
                          )}
                        >
                          <BarChart
                            data={fournisseurs.slice(0, 15)}
                            layout="vertical"
                            margin={{ top: 8, right: 56, left: 8, bottom: 8 }}
                            accessibilityLayer
                          >
                            <CartesianGrid stroke={GRILLE} horizontal={false} />
                            <XAxis
                              type="number"
                              tick={{ fill: AXE, fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              type="category"
                              dataKey="nom"
                              tick={{ fill: AXE, fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              width={190}
                              tickFormatter={(v) =>
                                v && v.length > 26 ? `${v.slice(0, 25)}…` : v || "(inconnu)"
                              }
                            />
                            <Tooltip
                              cursor={{ fill: "rgba(255,255,255,0.04)" }}
                              content={<InfoBulleFournisseur />}
                            />
                            {/* Série UNIQUE : une seule teinte, pas de légende
                                — le titre de la vue la nomme déjà. */}
                            <Bar
                              dataKey="moyenneArrondie"
                              fill={SERIE}
                              radius={[0, 4, 4, 0]}
                              maxBarSize={22}
                              label={{
                                position: "right",
                                fill: AXE,
                                fontSize: 11,
                                formatter: (v) => fNum(v),
                              }}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                        <p className="pd-note">
                          Articles à réapprovisionner par <strong>journée
                          type</strong> — une moyenne, pas un cumul : le même
                          article resté dix jours en rayon vide serait sinon
                          compté dix fois. 15 premiers fournisseurs sur{" "}
                          {fNum(fournisseurs.length)} ; l'export Excel les porte
                          tous. Cliquer un fournisseur dans le filtre restreint
                          toute la courbe à ses articles.
                        </p>
                      </>
                    )}
                  </>
                )}

                {vue === "semaine" && (
                  <>
                    <ResponsiveContainer width="100%" height={380}>
                      <BarChart
                        data={rapport.parJourSemaine || []}
                        margin={{ top: 24, right: 28, left: 0, bottom: 4 }}
                        barCategoryGap="28%"
                        accessibilityLayer
                      >
                        <CartesianGrid stroke={GRILLE} vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: AXE, fontSize: 11 }}
                          tickLine={false}
                          axisLine={{ stroke: GRILLE }}
                          height={28}
                        />
                        <YAxis
                          tick={{ fill: AXE, fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => v.toLocaleString("fr-FR")}
                          width={58}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          content={<InfoBulleJour />}
                        />
                        <ReferenceLine
                          y={moyenne}
                          stroke={MOYENNE}
                          strokeWidth={1.5}
                          strokeDasharray="6 4"
                          label={{
                            value: `Moyenne ${fNum(moyenne)} art./j`,
                            position: "insideTopRight",
                            fill: MOYENNE,
                            fontSize: 11,
                          }}
                        />
                        <Bar dataKey="moyenneArrondie" radius={[4, 4, 0, 0]} maxBarSize={64}>
                          {(rapport.parJourSemaine || []).map((j) => (
                            <Cell
                              key={j.jour}
                              fill={j.ecart >= 0 ? AU_DESSUS : EN_DESSOUS}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <p className="pd-note">
                      Moyenne d'articles réapprovisionnés par jour de la semaine,
                      sur les journées retenues — dit quel jour porte réellement la
                      charge du dock.
                    </p>
                  </>
                )}

                {vue === "table" && (
                  <div className="pd-table-wrap">
                    <table className="pd-table">
                      <thead>
                        <tr>
                          <th>Jour</th>
                          <th className="num">Articles réappro.</th>
                          <th className="num">Écart vs moyenne</th>
                          <th className="num">%</th>
                          {/* ⚠️ Plus de colonne « Cumul » : additionner des
                              photos successives compterait plusieurs fois le
                              même article. On montre à la place ce qui manque
                              pour agir. */}
                          <th className="num">Sans emplacement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.date}>
                            <td>{fmtJourLong(r.date)}</td>
                            <td className="num">{fNum(r.articles)}</td>
                            <td className={`num ${r.ecart >= 0 ? "pos" : "neg"}`}>
                              {fSigne(r.ecart)}
                            </td>
                            <td className={`num ${r.ecart >= 0 ? "pos" : "neg"}`}>
                              {moyenne
                                ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)} %`
                                : "—"}
                            </td>
                            <td className="num">{fNum(r.sansGisement)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Moyenne · {fNum(stats.nbJours)} journées</td>
                          <td className="num">{fNum(moyenne)}</td>
                          <td className="num">—</td>
                          <td className="num">—</td>
                          <td className="num">—</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Aucun filtrage silencieux : ce qui a été écarté est dit. */}
              {ecartees.length > 0 && (
                <details className="pd-ecartees">
                  <summary>
                    {fNum(ecartees.length)} journée(s) écartée(s) par les critères
                  </summary>
                  <ul>
                    {ecartees.map((e) => (
                      <li key={e.date}>
                        <span>{fmtJourLong(e.date)}</span>
                        <b>{fNum(e.articles)} articles</b>
                        <em>{e.motif}</em>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default AdminPerformanceDockScreen;
