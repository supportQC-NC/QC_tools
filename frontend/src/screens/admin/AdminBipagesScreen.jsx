// src/screens/admin/AdminBipagesScreen.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiClipboardList,
  HiDownload,
  HiDocumentReport,
  HiTable,
  HiRefresh,
  HiSearch,
  HiTrash,
  HiInformationCircle,
  HiPencilAlt,
  HiPlusCircle,
  HiPlus,
  HiX,
} from "react-icons/hi";
import {
  useGetBipagesQuery,
  useUpdateBipageMutation,
  useAjouterLigneBipageMutation,
  useRecommencerZoneMutation,
  useSetStockFigeMutation,
  useGetEcartsBipageQuery,
  useSetEcartQteZoneMutation,
  usePurgerCorrectionsEcartsMutation,
  getBipagesCsvUrl,
} from "../../slices/bipageApiSlice";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { BASE_URL } from "../../constants";
import "./AdminBipagesScreen.css";

/**
 * Trois points animés, affichés le temps que le serveur re-résolve un article
 * après un changement de NART. Sans ça, l'ancienne désignation reste à l'écran
 * pendant l'aller-retour et on croit que la saisie n'a rien fait.
 */
const PointsChargement = () => (
  <span className="cell-loading" aria-label="Recherche de l'article…">
    <i />
    <i />
    <i />
  </span>
);

/**
 * Texte d'infobulle d'une ligne corrigée : ce qui a changé, et par qui.
 * Les valeurs d'origine sont figées à la PREMIÈRE correction côté serveur, donc
 * ce résumé compare toujours à ce que l'agent avait réellement compté, même
 * après plusieurs passes de correction.
 */
const resumeCorrection = (l) => {
  const bouts = [];
  if (l.nartOrigine != null && l.nartOrigine !== l.nart) {
    bouts.push(`NART ${l.nartOrigine || "(vide)"} → ${l.nart || "(vide)"}`);
  }
  if (l.qteScanOrigine != null && Number(l.qteScanOrigine) !== Number(l.qteScan)) {
    bouts.push(`Qté ${l.qteScanOrigine} → ${l.qteScan}`);
  }
  const quoi = bouts.length ? bouts.join(" · ") : "Ligne corrigée";
  const qui = l.modifieParNom ? ` — ${l.modifieParNom}` : "";
  return `${quoi}${qui}`;
};

/**
 * Cellule « Code bipé » : CE QUE L'AGENT A FAIT, sans interprétation — le
 * code-barres s'il a douché une étiquette, le NART s'il l'a saisi à la main.
 *
 * C'est la seule prise quand une ligne est fausse : un code d'un autre
 * article, un zéro de tête manquant ou un renvoi GENDOUBL suivi se voient
 * ici, et nulle part ailleurs. Les lignes bipées avant l'ajout du champ
 * `codeScanne` n'ont que `eanArticle` (le code de la fiche) : on l'affiche
 * en repli, signalé par l'infobulle pour ne pas le faire passer pour une
 * trace fiable du terrain.
 */
const CelluleCodeBipe = ({ ligne }) => {
  const scanne = (ligne.codeScanne || "").trim();
  if (scanne) {
    return (
      <span
        className="code-scanne"
        title={
          ligne.source === "manuel"
            ? "Saisi à la main depuis cet écran"
            : "Code réellement bipé par le collecteur"
        }
      >
        {scanne}
      </span>
    );
  }
  const repli = (ligne.eanArticle || "").trim();
  if (!repli) return "—";
  return (
    <span
      className="code-scanne code-scanne-repli"
      title="Bipage antérieur à l'enregistrement du code bipé : valeur reconstituée depuis la fiche, ce n'est pas forcément ce qui a été douché."
    >
      {repli}
    </span>
  );
};

/**
 * Cellule « Gencode » : le code-barres du CATALOGUE, obtenu par RÉSOLUTION du
 * code bipé (NART, ou renvoi GENDOUBL suivi vers la fiche active).
 *
 * Il n'y a plus de repli sur le code bipé : celui-ci a sa propre colonne,
 * juste avant. Afficher ici un code qui ne vient pas du catalogue reviendrait
 * à dupliquer la colonne précédente en laissant croire que l'article a été
 * retrouvé. « — » dit la vérité : aucun gencode connu pour cette ligne.
 */
const CelluleGencode = ({ ligne }) => {
  if (ligne.gencod) return ligne.gencod;
  return (
    <span
      className="code-absent"
      title={
        ligne.found
          ? "L'article du catalogue n'a pas de code-barres"
          : "Aucun article du catalogue ne porte ce code"
      }
    >
      —
    </span>
  );
};

// ── Formatage du mode « Calcul des écarts » ─────────────────────────────────
// Quantités à 3 décimales max (articles au mètre), montants XPF entiers —
// mêmes règles que le document imprimé (fmtQteDoc / fmtNum côté serveur).
const fmtQteE = (n) =>
  Number.isFinite(Number(n))
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(
        Number(n),
      )
    : "—";
const fmtXpfE = (n) =>
  new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0));
const signeEcart = (n) => (n > 0 ? "ecart-pos" : n < 0 ? "ecart-neg" : "ecart-zero");

const AdminBipagesScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const [type, setType] = useState("");
  const [zone, setZone] = useState("");
  const [searchInput, setSearchInput] = useState("");
  // Provenance : "" (tout) | ajoutees | modifiees | touchees.
  // Répond à la question de fin d'inventaire : « qu'est-ce qui n'est pas brut
  // de collecteur ? » — c'est ce qu'un contrôleur veut relire en priorité.
  const [marque, setMarque] = useState("");
  // Sur-comptage : somme bipée par article (toutes zones) > stock théorique.
  const [surstock, setSurstock] = useState(false);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  // Feuille d'écarts : mêmes réglages que l'écran Inventaire proforma, le
  // document produit étant le même (générateur commun côté serveur).
  const [groupBy, setGroupBy] = useState("famille"); // famille | fournisseur
  const [seuil, setSeuil] = useState(""); // seuil |écart| en XPF
  const [perimetre, setPerimetre] = useState("comptes"); // comptes | stock
  // Tri DANS les groupes (document ET mode écarts) : NART ou désignation.
  const [ordre, setOrdre] = useState("nart"); // nart | design
  // Filtre par TYPE D'ANOMALIE, appliqué côté serveur : écran, sous-totaux et
  // document imprimé disent la même chose.
  // "" | manquant | excedent | multizone | inconnu
  const [anomalie, setAnomalie] = useState("");
  // Mode « Calcul des écarts » : le tableau des lignes laisse place à la
  // feuille d'écarts elle-même (mêmes filtres, mêmes groupes que le document),
  // relisible et corrigible AVANT impression.
  const [modeEcarts, setModeEcarts] = useState(false);
  const [ecartsLoading, setEcartsLoading] = useState("");
  // Bulle d'aide du périmètre : la distinction « comptés / stock complet »
  // change complètement le document, elle mérite mieux qu'une infobulle native.
  const [aidePerimetre, setAidePerimetre] = useState(false);

  // Ajout manuel d'une ligne. Ouvert seulement quand l'écran est filtré sur UN
  // emplacement ET UNE zone : la ligne héritera de ce couple, l'utilisateur ne
  // le saisit pas (voir `peutAjouter` plus bas).
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [ajoutNart, setAjoutNart] = useState("");
  const [ajoutQte, setAjoutQte] = useState("");
  const [ajoutObs, setAjoutObs] = useState("");
  const [ajoutErreur, setAjoutErreur] = useState("");

  const dirty = useRef(new Set());
  // Lignes dont le NART vient d'être modifié : leur désignation et leur
  // code-barres sont re-résolus par le serveur, on l'affiche pendant l'attente.
  const nartModifie = useRef(new Set());
  const [enResolution, setEnResolution] = useState(() => new Set());

  // debounce de la recherche
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // La bulle d'aide se ferme au clic ailleurs et à Échap, comme tout popover.
  useEffect(() => {
    if (!aidePerimetre) return undefined;
    const fermer = (e) => {
      if (!e.target.closest?.(".ecarts-aide")) setAidePerimetre(false);
    };
    const parEchap = (e) => {
      if (e.key === "Escape") setAidePerimetre(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", parEchap);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", parEchap);
    };
  }, [aidePerimetre]);

  // efface le message d'info après quelques secondes
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const { data, isLoading, isFetching, error: queryError, refetch } =
    useGetBipagesQuery(
      {
        entrepriseId: selectedEntreprise,
        zone,
        type,
        search,
        marque,
        surstock: surstock ? "1" : "",
      },
      { skip: !selectedEntreprise },
    );

  // Feuille d'écarts en JSON (mode « Calcul des écarts ») : mêmes réglages et
  // mêmes filtres que le document imprimé — ce qu'on voit est ce qu'on imprime.
  const {
    data: ecartsData,
    isFetching: ecartsFetching,
    error: ecartsError,
  } = useGetEcartsBipageQuery(
    {
      entrepriseId: selectedEntreprise,
      groupBy,
      seuil,
      perimetre,
      ordre,
      anomalie,
      zone,
      type,
      search,
      marque,
    },
    { skip: !selectedEntreprise || !modeEcarts },
  );
  const [setEcartQteZone] = useSetEcartQteZoneMutation();
  const [purgerCorrections, { isLoading: purgeEnCours }] =
    usePurgerCorrectionsEcartsMutation();

  const [updateBipage] = useUpdateBipageMutation();
  const [ajouterLigne, { isLoading: ajoutEnCours }] =
    useAjouterLigneBipageMutation();
  const [recommencerZone, { isLoading: recommencing }] =
    useRecommencerZoneMutation();
  const [setStockFige, { isLoading: figeEnCours }] = useSetStockFigeMutation();

  // ── Intégration Stock XL : dépôt cible (S1..S5) par emplacement. ──
  const DEPOTS = ["S1", "S2", "S3", "S4", "S5"];
  const [mapDepots, setMapDepots] = useState({});
  // Noms des entrepôts (fiche société, onglet Entrepôts) : affichés PARTOUT à
  // la place des codes bruts S1..S5 — « MECALAC » plutôt que « S3 ».
  const nomsEntrepots = data?.nomsEntrepots || {};
  const nomDepot = (d) => {
    const nom = String(nomsEntrepots[d] || "").trim();
    return nom && nom.toUpperCase() !== d ? `${nom} (${d})` : d;
  };
  // Libellé d'un EMPLACEMENT de zone : S3/S4/S5 prennent leur nom d'entrepôt,
  // MAGASIN/DOCK et les autres types restent tels quels.
  const nomEmplacement = (t) => {
    const up = String(t || "").toUpperCase();
    if (/^S[1-5]$/.test(up)) return nomDepot(up);
    return t || "Sans emplacement";
  };
  // La barre Intégration liste les EMPLACEMENTS DE LA SOCIÉTÉ — ceux du
  // DICTIONNAIRE DES RAYONS, renvoyés par le serveur dans `types`, plus ceux
  // réellement présents dans les lignes. Ce ne sont PAS les dépôts S1..S5 de
  // la fiche article : ceux-là sont la CIBLE du mapping (la colonne de droite),
  // pas la liste des zones. Les lister à gauche laissait croire que « S3 » était
  // un emplacement de rangement, et masquait les vrais types (RESERVE, QUAI…).
  // MAGASIN et DOCK restent proposés même absents du dictionnaire : ils ont un
  // dépôt par défaut (S1 / S2) et un emplacement sans ligne ne produit
  // simplement aucun fichier.
  const typesIntegration = (() => {
    const vus = new Set();
    const liste = [];
    for (const t of [...(data?.types || []), "MAGASIN", "DOCK"]) {
      const up = String(t || "").trim().toUpperCase();
      if (!up || vus.has(up)) continue;
      vus.add(up);
      liste.push(t);
    }
    return liste;
  })();
  // Défauts métier : MAGASIN → S1, DOCK → S2, et un emplacement spécial
  // S3/S4/S5 (zones importées par proforma) part dans SON dépôt.
  const depotPour = (t) => {
    if (mapDepots[t]) return mapDepots[t];
    const up = String(t).toUpperCase();
    if (up === "DOCK") return "S2";
    if (DEPOTS.includes(up)) return up;
    return "S1";
  };
  const genererIntegration = () => {
    // Le mapping envoyé couvre TOUS les emplacements affichés (même sans
    // ligne : sans effet côté serveur, mais les choix de l'utilisateur
    // partent toujours).
    const mapping = typesIntegration
      .map((t) => `${(t || "SANS_EMPLACEMENT").toUpperCase()}:${depotPour(t)}`)
      .join(",");
    window.open(
      `/api/bipages/${selectedEntreprise}/integration-dat?mapping=${encodeURIComponent(mapping)}`,
      "_blank",
    );
  };

  // Figer / défiger / reprendre le stock (photo de la base article pour les
  // écarts). Depuis le 16/11/2026, défiger CONSERVE la photo : on repasse au
  // stock live, et « Reprendre » réactive la photo telle quelle (figer reprend
  // toujours une photo NEUVE). Un `at` non nul avec `actif: false` = photo
  // conservée disponible.
  const stockFige = data?.session?.stockFige;
  const datePhotoFige = stockFige?.at
    ? new Date(stockFige.at).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
  const changerStockFige = async (mode) => {
    const confirmations = {
      figer: stockFige?.at
        ? `Figer le stock (NOUVELLE photo) ?\n\nLe stock de TOUS les articles est photographié maintenant et REMPLACE la photo du ${datePhotoFige}. La feuille d'écarts comparera les comptages à cette nouvelle photo.`
        : "Figer le stock ?\n\nLe stock de TOUS les articles est photographié maintenant : la feuille d'écarts comparera les comptages à cette photo, même si des ventes ou réceptions modifient le stock réel pendant l'inventaire.",
      defiger:
        "Défiger le stock ?\n\nLa feuille d'écarts repart du stock réel (live). La photo est CONSERVÉE : « Reprendre le stock figé » la réactivera telle quelle, et « Figer » en prendra une nouvelle.",
      reprendre: `Reprendre le stock figé ?\n\nLa feuille d'écarts comparera de nouveau les comptages à la photo conservée du ${datePhotoFige} (aucune nouvelle photo n'est prise).`,
    };
    // eslint-disable-next-line no-alert
    if (!window.confirm(confirmations[mode])) return;
    try {
      const res = await setStockFige({
        entrepriseId: selectedEntreprise,
        mode,
      }).unwrap();
      setMsg(res?.message || "État du stock figé mis à jour.");
    } catch (e) {
      alert(e?.data?.message || "Échec du changement d'état du stock figé");
    }
  };

  const [lignes, setLignes] = useState([]);
  useEffect(() => {
    setLignes(data?.lignes || []);
    dirty.current = new Set();
  }, [data]);

  const active = data?.active;
  const types = data?.types || [];
  const zonesMeta = data?.zonesMeta || [];

  // Options de zones filtrées par le type sélectionné (codes distincts).
  const zoneOptions = [
    ...new Set(
      (type ? zonesMeta.filter((z) => z.type === type) : zonesMeta).map(
        (z) => z.code,
      ),
    ),
  ];

  const onTypeChange = (e) => {
    setType(e.target.value);
    setZone(""); // une zone choisie peut ne plus appartenir au nouveau type
  };

  const updateLocal = (id, field, value) => {
    dirty.current.add(id);
    // Seul le NART entraîne une re-résolution côté serveur : changer la
    // quantité ou l'observation ne doit pas faire clignoter les colonnes.
    if (field === "nart") nartModifie.current.add(id);
    setLignes((prev) =>
      prev.map((l) => (l._id === id ? { ...l, [field]: value } : l)),
    );
  };

  const marquerResolution = (id, actif) =>
    setEnResolution((prev) => {
      const n = new Set(prev);
      if (actif) n.add(id);
      else n.delete(id);
      return n;
    });

  const saveLine = async (id) => {
    if (!dirty.current.has(id)) return;
    dirty.current.delete(id);
    const ligne = lignes.find((l) => l._id === id);
    if (!ligne) return;
    // Le NART a changé : désignation et code-barres vont être re-résolus dans
    // le catalogue. On le montre plutôt que de laisser l'ancienne valeur à
    // l'écran, qui donnerait l'impression que rien ne s'est passé.
    const resout = nartModifie.current.delete(id);
    if (resout) marquerResolution(id, true);
    try {
      const res = await updateBipage({
        entrepriseId: selectedEntreprise,
        id,
        body: {
          qteScan: ligne.qteScan,
          nart: ligne.nart,
          observation: ligne.observation,
        },
      }).unwrap();
      setLignes((prev) => prev.map((l) => (l._id === id ? res : l)));
    } catch {
      /* on garde la saisie locale ; l'admin peut réessayer */
    } finally {
      if (resout) marquerResolution(id, false);
    }
  };

  const onCellKeyDown = (e) => {
    if (e.key === "Enter") e.target.blur();
  };

  // ── Ajout manuel ─────────────────────────────────────────────────────────
  // Règle métier : on n'ajoute une ligne QUE dans une zone déjà filtrée, avec
  // son emplacement. Le couple (zone, emplacement) identifie la fiche rayon —
  // un même code existe en MAGASIN et en DOCK — et le laisser saisir à la main
  // reviendrait à autoriser des lignes rattachées à une zone inexistante.
  const peutAjouter = !!(type && zone);

  const fermerAjout = () => {
    setAjoutOuvert(false);
    setAjoutNart("");
    setAjoutQte("");
    setAjoutObs("");
    setAjoutErreur("");
  };

  const validerAjout = async () => {
    setAjoutErreur("");
    const nart = ajoutNart.trim();
    const qte = Number(ajoutQte);
    if (!nart) {
      setAjoutErreur("Saisissez le NART de l'article.");
      return;
    }
    if (!Number.isFinite(qte) || qte === 0) {
      setAjoutErreur("Saisissez une quantité différente de 0.");
      return;
    }
    try {
      await ajouterLigne({
        entrepriseId: selectedEntreprise,
        body: {
          zoneCode: zone,
          zoneType: type,
          nart,
          qteScan: qte,
          observation: ajoutObs.trim(),
        },
      }).unwrap();
      fermerAjout();
      setMsg(`Ligne ajoutée dans ${zone} (${type}).`);
    } catch (err) {
      setAjoutErreur(
        err?.data?.message || "Ajout impossible. Vérifiez la saisie.",
      );
    }
  };

  // Feuille d'écarts (PDF ou Excel). Même document que « Inventaire proforma » :
  // c'est le même générateur côté serveur, seule la source du comptage change.
  const exporterEcarts = async (format) => {
    if (!selectedEntreprise) return;
    setEcartsLoading(format);
    try {
      const params = new URLSearchParams();
      params.set("groupBy", groupBy);
      params.set("format", format);
      params.set("perimetre", perimetre);
      params.set("ordre", ordre);
      if (anomalie) params.set("anomalie", anomalie);
      if (seuil) params.set("seuil", seuil);
      // Les filtres de l'écran cadrent le document : on exporte ce qu'on voit.
      if (zone) params.set("zone", zone);
      if (type) params.set("type", type);
      if (search) params.set("search", search);
      if (marque) params.set("marque", marque);

      const url = `${BASE_URL}/api/bipages/${selectedEntreprise}/ecarts?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let m = `Génération échouée (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) m = j.message;
        } catch {
          /* réponse non JSON */
        }
        throw new Error(m);
      }
      const blob = await res.blob();
      let filename = format === "xlsx" ? "ecarts.xlsx" : "ecarts.pdf";
      const cd = res.headers.get("Content-Disposition");
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^"\n;]+)"?/i);
        if (m && m[1]) filename = decodeURIComponent(m[1]);
      }
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setMsg(e.message || "Génération impossible");
    } finally {
      setEcartsLoading("");
    }
  };

  // Correction d'une quantité PAR GISEMENT depuis le mode écarts : le total du
  // couple (article, gisement) devient la valeur saisie — la différence est
  // appliquée à la ligne la plus récente côté serveur, avec la traçabilité
  // d'une correction. Le refetch (invalidation « Bipage ») recale la feuille.
  const corrigerQteZone = async (row, z, valeur) => {
    const qte = Number(String(valeur ?? "").replace(",", "."));
    if (!Number.isFinite(qte) || qte === Number(z.qte)) return;
    try {
      await setEcartQteZone({
        entrepriseId: selectedEntreprise,
        cle: row.cle,
        zoneCode: z.code,
        zoneType: z.type || "",
        qte,
      }).unwrap();
      setMsg(
        `${row.nart} — gisement ${z.code}${z.type ? ` (${z.type})` : ""} : quantité corrigée à ${qte}.`,
      );
    } catch (e) {
      alert(e?.data?.message || "Correction impossible");
    }
  };

  // Purge de l'affichage « corrigé » : les lignes corrigées (gardées visibles
  // même sous le seuil) redeviennent soumises aux filtres normaux. La trace de
  // correction (repère crayon du mode lignes, valeurs d'origine) est conservée.
  const purgerAffichageCorrections = async () => {
    if (
      !window.confirm(
        "Purger l'affichage des corrections ?\n\nLes lignes corrigées ne seront plus forcées sur la feuille : celles repassées sous le seuil disparaîtront. La trace des corrections (mode lignes, valeurs d'origine) est conservée.",
      )
    )
      return;
    try {
      const r = await purgerCorrections({
        entrepriseId: selectedEntreprise,
        zone,
        type,
        search,
        marque,
      }).unwrap();
      setMsg(
        r.purgees
          ? `${r.purgees} correction(s) purgée(s) de la feuille d'écarts.`
          : "Aucune correction à purger avec ces filtres.",
      );
    } catch (e) {
      alert(e?.data?.message || "Purge impossible");
    }
  };

  // Export CSV authentifié : fetch avec cookie (credentials) → blob → download.
  // (window.open ne transmet pas correctement la requête API et casse en dev.)
  const exportCsv = async () => {
    if (!selectedEntreprise) return;
    setExporting(true);
    try {
      const url = `${BASE_URL}${getBipagesCsvUrl(selectedEntreprise, {
        zone,
        type,
        search,
        marque,
      })}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Export échoué (${res.status})`);

      const blob = await res.blob();

      // Nom de fichier depuis l'en-tête, sinon défaut.
      let filename = "bipages.csv";
      const cd = res.headers.get("Content-Disposition");
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^"\n;]+)"?/i);
        if (m && m[1]) filename = decodeURIComponent(m[1]);
      }

      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      alert(e.message || "Export impossible");
    } finally {
      setExporting(false);
    }
  };

  const handleRecommencer = async () => {
    if (!zone) return;
    const ok = window.confirm(
      `Recommencer la zone « ${zone} » ?\n\n` +
        `Tous les bipages de cette zone seront supprimés (lignes, statut ` +
        `imprimé, et fichiers .DAT/PDF archivés sur le partage réseau). ` +
        `La zone pourra ensuite être re-bipée.\n\nAction irréversible.`,
    );
    if (!ok) return;
    try {
      const r = await recommencerZone({
        entrepriseId: selectedEntreprise,
        zoneCode: zone,
      }).unwrap();
      setMsg(r?.message || "Zone réinitialisée.");
      if (r?.avertissements?.length) {
        setMsg(
          `${r.message} (⚠ ${r.avertissements.length} fichier(s) non supprimé(s))`,
        );
      }
      setZone("");
      refetch();
    } catch (e) {
      alert(e?.data?.message || "Échec du recommencement de la zone");
    }
  };

  return (
    <div className="admin-bipages">
      <div className="admin-bipages-header">
        <h1>
          <HiClipboardList /> Détail des bipages
        </h1>
        <div className="admin-bipages-actions">
          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!selectedEntreprise}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="admin-bipages-placeholder">
          <HiClipboardList />
          <p>Sélectionnez une entreprise pour voir le détail des bipages.</p>
        </div>
      ) : isLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : queryError ? (
        /* Une requête en ÉCHEC (serveur arrêté, droit manquant…) n'est PAS
           « aucun inventaire actif » : afficher la vraie cause, sinon on
           cherche le problème du mauvais côté. */
        <div className="admin-bipages-placeholder">
          <HiClipboardList />
          <p>
            Impossible de joindre le serveur :{" "}
            {queryError?.data?.message ||
              queryError?.error ||
              `erreur ${queryError?.status || "inconnue"}`}
          </p>
          <button className="btn-secondary" onClick={refetch}>
            <HiRefresh /> Réessayer
          </button>
        </div>
      ) : !active ? (
        <div className="admin-bipages-placeholder">
          <HiClipboardList />
          <p>
            Aucun inventaire actif. Initialisez-en un depuis l'écran
            « Progression d'inventaire ».
          </p>
        </div>
      ) : (
        <>
          {/* Feuilles d'écarts — en tête d'écran : c'est la sortie qu'on vient
              chercher ici en fin de comptage. Réglages identiques à l'écran
              Inventaire proforma, documents identiques. */}
          <div className="ecarts-bar">
            <span className="ecarts-titre">
              <HiDocumentReport /> Feuille d'écarts
            </span>

            <label>
              Regrouper par
              <select
                className="filter-select"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                <option value="famille">Famille (2 1ers car. NART)</option>
                <option value="fournisseur">Fournisseur</option>
              </select>
            </label>

            <label>
              Trier par
              <select
                className="filter-select"
                value={ordre}
                onChange={(e) => setOrdre(e.target.value)}
                title="Ordre des articles À L'INTÉRIEUR de chaque groupe, à l'écran comme sur le document"
              >
                <option value="nart">NART</option>
                <option value="design">Désignation (A→Z)</option>
              </select>
            </label>

            <label>
              Anomalie
              <select
                className="filter-select"
                value={anomalie}
                onChange={(e) => setAnomalie(e.target.value)}
                title="Ne garder qu'un type d'anomalie — à l'écran comme sur le document imprimé (sous-totaux recalculés sur la sélection)"
              >
                <option value="">Toutes</option>
                <option value="manquant">Manquants (diff &lt; 0)</option>
                <option value="excedent">Excédents (diff &gt; 0)</option>
                <option value="multizone">Multi-zones (D)</option>
                <option value="inconnu">Articles inconnus</option>
              </select>
            </label>

            <label>
              Seuil écart (XPF)
              <input
                type="number"
                min="0"
                step="1"
                className="ecarts-seuil"
                value={seuil}
                onChange={(e) => setSeuil(e.target.value)}
                placeholder="0"
                title="Les articles dont l'écart en valeur absolue est inférieur ou égal au seuil sont exclus du document."
              />
            </label>

            <label>
              <span className="ecarts-label-aide">
                Périmètre
                <span className="ecarts-aide">
                  <button
                    type="button"
                    className="ecarts-aide-btn"
                    onClick={(e) => {
                      // Le bouton vit dans un <label> : sans ça, le clic
                      // déclencherait aussi l'ouverture du <select> associé.
                      e.preventDefault();
                      e.stopPropagation();
                      setAidePerimetre((o) => !o);
                    }}
                    aria-expanded={aidePerimetre}
                    aria-label="À quoi sert le périmètre ?"
                    title="À quoi sert le périmètre ?"
                  >
                    <HiInformationCircle />
                  </button>
                  {aidePerimetre && (
                    <div
                      className="ecarts-aide-bulle"
                      role="tooltip"
                      onClick={(e) => e.preventDefault()}
                    >
                      <b>Quels articles entrent dans le document ?</b>
                      <p>
                        <b>Articles comptés</b> — seulement ceux qui ont été
                        bipés. Un article en stock que personne n'a compté
                        n'apparaît pas.
                      </p>
                      <p>
                        <b>Stock complet</b> — les articles comptés <i>plus</i>{" "}
                        tous ceux dont l'ERP dit qu'il reste du stock. Ceux qui
                        n'ont jamais été comptés sortent avec une quantité de 0
                        et un écart négatif égal à tout leur stock.
                      </p>
                      <p className="ecarts-aide-regle">
                        <b>Pendant l'inventaire</b>, gardez « Articles comptés » :
                        les rayons pas encore faits rempliraient le document
                        d'écarts négatifs qui ne veulent rien dire.{" "}
                        <b>Une fois tous les rayons comptés</b>, passez à « Stock
                        complet » : ce qui ressort à 0 a été oublié, ou a
                        réellement disparu.
                      </p>
                    </div>
                  )}
                </span>
              </span>
              <select
                className="filter-select"
                value={perimetre}
                onChange={(e) => setPerimetre(e.target.value)}
              >
                <option value="comptes">Articles comptés</option>
                <option value="stock">Stock complet</option>
              </select>
            </label>

            <div className="ecarts-actions">
              {/* Mode « Calcul des écarts » : la feuille s'affiche À L'ÉCRAN
                  (mêmes groupes, mêmes filtres que le document), relisible et
                  corrigible gisement par gisement avant d'imprimer. */}
              <button
                className={modeEcarts ? "btn-primary mode-ecarts-actif" : "btn-secondary"}
                onClick={() => setModeEcarts((v) => !v)}
                title={
                  modeEcarts
                    ? "Revenir au tableau des lignes bipées"
                    : "Afficher la feuille d'écarts à l'écran, pour la relire et la corriger avant impression"
                }
              >
                <HiTable />{" "}
                {modeEcarts ? "Retour aux lignes" : "Calcul des écarts"}
              </button>
              <button
                className="btn-primary"
                onClick={() => exporterEcarts("pdf")}
                disabled={!!ecartsLoading}
                title="Feuille d'écarts (PDF paysage)"
              >
                <HiDocumentReport />{" "}
                {ecartsLoading === "pdf" ? "Génération…" : "PDF"}
              </button>
              <button
                className="btn-primary"
                onClick={() => exporterEcarts("xlsx")}
                disabled={!!ecartsLoading}
                title="Feuille d'écarts (classeur Excel)"
              >
                <HiTable />{" "}
                {ecartsLoading === "xlsx" ? "Génération…" : "Excel"}
              </button>
              {/* Les lignes corrigées restent affichées même sous le seuil
                  (repère C) ; ce bouton lève ce forçage — portée = les filtres
                  courants de l'écran. La trace de correction est conservée. */}
              {modeEcarts && (
                <button
                  className="btn-secondary"
                  onClick={purgerAffichageCorrections}
                  disabled={purgeEnCours}
                  title="Les lignes corrigées (repère C) ne seront plus forcées sur la feuille : celles sous le seuil disparaîtront. La trace des corrections est conservée (mode lignes)."
                >
                  <HiTrash />{" "}
                  {purgeEnCours ? "Purge…" : "Purger les corrections"}
                </button>
              )}
              {/* Stock figé : la feuille d'écarts compare à la PHOTO du stock
                  prise au gel (colonne STOCK FIGÉ + colonne STOCK LIVE
                  indicative), pas au stock réel qui bouge pendant
                  l'inventaire. Défiger CONSERVE la photo (retour au live) ;
                  « Reprendre » la réactive telle quelle ; « Figer » prend
                  toujours une photo neuve. */}
              {stockFige?.actif ? (
                <button
                  className="btn-danger"
                  onClick={() => changerStockFige("defiger")}
                  disabled={figeEnCours}
                  title="Défiger : les écarts repartent du stock réel (live). La photo est conservée et pourra être reprise."
                >
                  {figeEnCours ? "En cours…" : "Défiger le stock"}
                </button>
              ) : (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => changerStockFige("figer")}
                    disabled={figeEnCours}
                    title={
                      stockFige?.at
                        ? "Figer : prend une NOUVELLE photo du stock actuel (remplace la photo conservée)"
                        : "Figer : photographie le stock actuel, les écarts compareront à cette photo"
                    }
                  >
                    {figeEnCours
                      ? "En cours…"
                      : stockFige?.at
                        ? "Figer le stock (nouvelle photo)"
                        : "Figer le stock"}
                  </button>
                  {stockFige?.at && (
                    <button
                      className="btn-secondary"
                      onClick={() => changerStockFige("reprendre")}
                      disabled={figeEnCours}
                      title={`Reprendre : les écarts comparent de nouveau à la photo conservée du ${datePhotoFige} (aucune nouvelle photo)`}
                    >
                      {figeEnCours
                        ? "En cours…"
                        : `Reprendre le stock figé (${datePhotoFige})`}
                    </button>
                  )}
                </>
              )}
              {stockFige?.at && (
                <span
                  className="ecarts-fige-info"
                  title={
                    stockFige.actif
                      ? "Tout le catalogue est couvert par la photo : les articles sans stock au moment du gel y valent 0. Les documents d'écarts portent aussi le stock live, à titre indicatif."
                      : "Photo conservée mais NON utilisée : les écarts comparent au stock réel (live). « Reprendre le stock figé » la réactive."
                  }
                >
                  Photo du {datePhotoFige}
                  {stockFige.actif ? "" : " (conservée, écarts sur le stock live)"}
                  {" — "}
                  {stockFige.nbCatalogue
                    ? `${new Intl.NumberFormat("fr-FR").format(stockFige.nbCatalogue)} articles couverts, dont ${new Intl.NumberFormat("fr-FR").format(stockFige.nbArticles)} en stock`
                    : `${new Intl.NumberFormat("fr-FR").format(stockFige.nbArticles)} articles en stock photographiés`}
                </span>
              )}
            </div>

            <span className="ecarts-hint">
              Les filtres ci-dessous (emplacement, zone, provenance, recherche)
              cadrent aussi le document.
            </span>
          </div>

          {/* ── Fichiers .dat d'intégration Stock XL ──
              Un fichier par DÉPÔT (S1..S5) : tous les bipages de la session,
              sommés par article (une ligne par article et par dépôt). Chaque
              emplacement est associé au dépôt où intégrer son comptage. */}
          <div className="ecarts-bar integration-bar">
            <span className="ecarts-titre">
              <HiDownload /> Intégration Stock XL
            </span>
            {typesIntegration.map((t) => (
              <label key={t || "(sans)"}>
                {nomEmplacement(t)} →
                <select
                  className="filter-select"
                  value={depotPour(t)}
                  onChange={(e) =>
                    setMapDepots((prev) => ({ ...prev, [t]: e.target.value }))
                  }
                  title={`Dépôt Stock XL où intégrer le comptage de l'emplacement ${nomEmplacement(t)}`}
                >
                  {DEPOTS.map((d) => (
                    <option key={d} value={d}>
                      {nomDepot(d)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              className="btn-primary"
              onClick={genererIntegration}
              disabled={!types.length}
              title="Télécharge un ZIP : un fichier stock.dat <dépôt>_inventaire_<date> par dépôt, une ligne par article (quantités sommées sur toutes les zones)"
            >
              <HiDownload /> Générer les .dat (ZIP)
            </button>
            <span className="ecarts-hint">
              Un fichier par dépôt, nommé «&nbsp;stock.dat
              S1_inventaire_&lt;date&gt;&nbsp;» ; un article compté dans
              plusieurs rayons est sommé (une seule ligne). Copie aussi déposée
              sur le FTP (dossier integration de l'inventaire).
            </span>
          </div>

          <div className="bipages-toolbar">
            <select
              className="filter-select"
              value={type}
              onChange={onTypeChange}
            >
              <option value="">Tous les types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {nomEmplacement(t)}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            >
              <option value="">Toutes les zones</option>
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>

            {/* Provenance de la ligne. « Ajoutées + modifiées » est la vue
                de contrôle : tout ce qui ne vient pas brut du collecteur. */}
            <select
              className="filter-select"
              value={marque}
              onChange={(e) => setMarque(e.target.value)}
              title="Ne montrer que les lignes touchées à la main"
            >
              <option value="">Toutes les lignes</option>
              <option value="ajoutees">Ajoutées à la main</option>
              <option value="modifiees">Modifiées</option>
              <option value="touchees">Ajoutées + modifiées</option>
            </select>

            {/* Sur-comptage : articles dont la SOMME bipée (toutes zones de la
                session confondues) dépasse le stock théorique — figé si la
                photo est active, réel sinon. */}
            <label
              className="surstock-filtre"
              title="N'afficher que les articles dont le total bipé (toutes zones confondues) dépasse le stock théorique (photo figée si active)"
            >
              <input
                type="checkbox"
                checked={surstock}
                onChange={(e) => setSurstock(e.target.checked)}
              />
              Qté bipée &gt; stock
            </label>

            <div className="search-box">
              <HiSearch />
              <input
                type="text"
                placeholder="Rechercher NART ou GENCODE…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            <span className="bipages-count">
              {modeEcarts
                ? `${(ecartsData?.groupes || []).reduce(
                    (s, g) => s + g.rows.length,
                    0,
                  )} article(s) en écart${ecartsFetching ? " …" : ""}`
                : `${lignes.length} ligne${lignes.length > 1 ? "s" : ""}${
                    isFetching ? " …" : ""
                  }`}
            </span>

            <button
              className="btn-danger"
              onClick={handleRecommencer}
              disabled={!zone || recommencing}
              title={
                zone
                  ? `Recommencer la zone ${zone}`
                  : "Sélectionnez une zone pour la recommencer"
              }
            >
              <HiTrash /> {recommencing ? "…" : "Recommencer la zone"}
            </button>

            <button
              className="btn-primary"
              onClick={exportCsv}
              disabled={lignes.length === 0 || exporting}
            >
              <HiDownload /> {exporting ? "Export…" : "Export CSV"}
            </button>
          </div>

          {/* L'intégration d'un comptage fait hors collecteur (Excel ou
              proforma) a déménagé dans « Progression inventaire » : on y
              choisit la zone AVANT d'importer, au lieu de la deviner dans le
              nom du fichier ou l'observation. Cet écran reste celui de la
              consultation et de la correction des lignes. */}

          {msg ? <div className="bipages-msg">{msg}</div> : null}

          {/* ── Ajout manuel d'une ligne ──────────────────────────────────
              Le bouton n'apparaît QUE si l'écran est filtré sur un
              emplacement ET une zone : la ligne créée appartiendra à ce
              couple, que l'utilisateur ne saisit donc jamais. Quand le filtre
              n'est pas assez précis, on explique ce qu'il manque plutôt que
              d'afficher un bouton inerte. */}
          {!modeEcarts && (
          <div className="ajout-bar">
            {peutAjouter ? (
              !ajoutOuvert && (
                <button
                  className="btn-secondary"
                  onClick={() => setAjoutOuvert(true)}
                >
                  <HiPlus /> Ajouter une ligne dans {zone} ({type})
                </button>
              )
            ) : (
              <span className="ajout-hint">
                <HiInformationCircle /> Pour ajouter une ligne à la main,
                filtrez d'abord sur un <b>emplacement</b> et une <b>zone</b> :
                la ligne leur sera rattachée.
              </span>
            )}
          </div>
          )}

          {!modeEcarts && peutAjouter && ajoutOuvert && (
            <div className="ajout-form">
              <div className="ajout-form-head">
                <span className="ajout-cible">
                  Nouvelle ligne — <b>{zone}</b> · {type}
                </span>
                <button
                  className="ajout-close"
                  onClick={fermerAjout}
                  title="Annuler"
                  aria-label="Annuler l'ajout"
                >
                  <HiX />
                </button>
              </div>
              <div className="ajout-champs">
                <label>
                  <span>NART</span>
                  <input
                    type="text"
                    value={ajoutNart}
                    onChange={(e) => setAjoutNart(e.target.value)}
                    placeholder="Code article"
                    autoFocus
                  />
                </label>
                <label>
                  <span>Quantité</span>
                  <input
                    type="number"
                    value={ajoutQte}
                    onChange={(e) => setAjoutQte(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="ajout-obs">
                  <span>Observation</span>
                  <input
                    type="text"
                    value={ajoutObs}
                    onChange={(e) => setAjoutObs(e.target.value)}
                    placeholder="Facultatif"
                  />
                </label>
                <button
                  className="btn-primary"
                  onClick={validerAjout}
                  disabled={ajoutEnCours}
                >
                  {ajoutEnCours ? "Ajout…" : "Ajouter"}
                </button>
              </div>
              {/* La désignation n'est pas demandée : elle est résolue par le
                  serveur depuis le NART, comme lors d'une correction. Un NART
                  inconnu donne « Article non trouvé » — la ligne est créée
                  quand même, pour ne pas perdre un comptage. */}
              {ajoutErreur ? (
                <div className="ajout-erreur">{ajoutErreur}</div>
              ) : null}
            </div>
          )}

          {modeEcarts ? (
            /* ── Mode « Calcul des écarts » : la feuille à l'écran ──────────
               Mêmes groupes, mêmes totaux et mêmes filtres que le PDF/Excel.
               Sous chaque article : ses gisements bipés avec la quantité de
               chacun — modifiable (corrigée sur la ligne la plus récente du
               gisement), pour ajuster la feuille AVANT de l'imprimer. */
            <div className="admin-bipages-table-container">
              {ecartsFetching && !ecartsData ? (
                <div className="admin-loading">Calcul des écarts…</div>
              ) : ecartsError ? (
                <div className="ecarts-vide">
                  {ecartsError?.data?.message ||
                    "Impossible de calculer les écarts."}
                </div>
              ) : (
                (() => {
                  const groupes = ecartsData?.groupes || [];
                  const avecLive = !!ecartsData?.stockFige?.actif;
                  const nbCols = avecLive ? 12 : 11;
                  return (
                    <table className="admin-table ecarts-table">
                      <thead>
                        <tr>
                          <th>NART</th>
                          <th title="D = compté dans plusieurs zones · XX = quantité excédentaire (qté > stock) · C = corrigée (reste affichée même sous le seuil)">
                            ATT
                          </th>
                          <th>Désignation</th>
                          <th>Référence</th>
                          <th>Gencode</th>
                          <th>Fourn.</th>
                          <th>Fournisseur</th>
                          <th
                            className="num-cell"
                            title={
                              avecLive
                                ? "Photo du stock au gel — la RÉFÉRENCE du calcul d'écart"
                                : "Stock théorique (ERP)"
                            }
                          >
                            {avecLive ? "Stock figé" : "Stock"}
                          </th>
                          {avecLive && (
                            <th
                              className="num-cell"
                              title="Stock réel actuel (continue de bouger avec les ventes) — indicatif, pas la référence du calcul"
                            >
                              Stock live
                            </th>
                          )}
                          <th className="num-cell">Qté bipée</th>
                          <th className="num-cell">Diff</th>
                          <th className="num-cell">Diff (XPF)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupes.length === 0 ? (
                          <tr>
                            <td colSpan={nbCols} className="no-data">
                              Aucun article au-dessus du seuil avec ces filtres.
                            </td>
                          </tr>
                        ) : (
                          <>
                            {groupes.map((g) => (
                              <React.Fragment key={g.key}>
                                <tr className="ecart-groupe">
                                  <td colSpan={nbCols}>
                                    {ecartsData.groupLabel} {g.key}
                                    {g.nom ? ` — ${g.nom}` : ""} ({g.rows.length})
                                  </td>
                                </tr>
                                {g.rows.map((r, idx) => (
                                  <React.Fragment key={r.cle || r.nart}>
                                    <tr
                                      className={`ecart-row ${
                                        idx % 2 ? "pair" : ""
                                      } ${r.nonTrouve ? "row-unknown" : ""} ${
                                        r.corrige ? "row-modifiee" : ""
                                      }`.trim()}
                                    >
                                      <td className="mono ecart-nart">
                                        {r.nart}
                                      </td>
                                      <td className="ecart-att">
                                        {r.att
                                          ? r.att.split(" ").map((flag) => (
                                              <span
                                                key={flag}
                                                className={
                                                  flag === "C"
                                                    ? "att-chip att-chip-corrige"
                                                    : "att-chip"
                                                }
                                                title={
                                                  flag === "D"
                                                    ? "Compté dans plusieurs zones"
                                                    : flag === "C"
                                                      ? `Corrigée${
                                                          r.corrigeParNom
                                                            ? ` par ${r.corrigeParNom}`
                                                            : ""
                                                        } — reste affichée même sous le seuil, jusqu'à « Purger les corrections »`
                                                      : "Quantité excédentaire (qté > stock)"
                                                }
                                              >
                                                {flag}
                                              </span>
                                            ))
                                          : ""}
                                      </td>
                                      <td className="desig-cell" title={r.design}>
                                        {r.design}
                                      </td>
                                      <td>{r.refer}</td>
                                      <td className="mono">{r.gencod}</td>
                                      <td>{r.fourn}</td>
                                      <td className="ecart-fournnom" title={r.fournNom}>
                                        {r.fournNom}
                                      </td>
                                      <td className="num-cell">
                                        {fmtQteE(r.stock)}
                                      </td>
                                      {avecLive && (
                                        <td className="num-cell ecart-live">
                                          {fmtQteE(r.stockLive)}
                                        </td>
                                      )}
                                      <td className="num-cell col-qte">
                                        {fmtQteE(r.qte)}
                                      </td>
                                      <td
                                        className={`num-cell ${signeEcart(r.diff)}`}
                                      >
                                        {fmtQteE(r.diff)}
                                      </td>
                                      <td
                                        className={`num-cell ${signeEcart(r.diffval)}`}
                                      >
                                        {fmtXpfE(r.diffval)}
                                      </td>
                                    </tr>
                                    {(r.zonesBipees || []).map((z) => (
                                      <tr
                                        key={`${r.cle}|${z.code}|${z.type}`}
                                        className={`ecart-zone ${
                                          z.corrige ? "row-modifiee" : ""
                                        }`.trim()}
                                      >
                                        <td />
                                        <td />
                                        <td
                                          className="ecart-zone-lib"
                                          colSpan={avecLive ? 7 : 6}
                                        >
                                          ↳ Gisement <b>{z.code}</b>
                                          {z.type ? ` · ${z.type}` : ""}
                                          {z.corrige && (
                                            <span
                                              className="ecart-zone-corrigee"
                                              title="Quantité corrigée dans ce gisement"
                                            >
                                              {" "}
                                              corrigée
                                            </span>
                                          )}
                                        </td>
                                        <td className="num-cell">
                                          <input
                                            key={`${r.cle}|${z.code}|${z.type}|${z.qte}`}
                                            className="cell-input num ecart-zone-qte"
                                            type="number"
                                            step="any"
                                            defaultValue={z.qte}
                                            onBlur={(e) =>
                                              corrigerQteZone(
                                                r,
                                                z,
                                                e.target.value,
                                              )
                                            }
                                            onKeyDown={onCellKeyDown}
                                            title="Quantité bipée dans ce gisement — modifiable : la correction est appliquée à la ligne la plus récente du gisement"
                                          />
                                        </td>
                                        <td colSpan={2} />
                                      </tr>
                                    ))}
                                  </React.Fragment>
                                ))}
                                <tr className="ecart-soustotal">
                                  <td colSpan={nbCols - 1}>
                                    Sous-total {ecartsData.groupLabel} {g.key}
                                  </td>
                                  <td
                                    className={`num-cell ${signeEcart(g.subtotal)}`}
                                  >
                                    {fmtXpfE(g.subtotal)}
                                  </td>
                                </tr>
                              </React.Fragment>
                            ))}
                            <tr className="ecart-total">
                              <td colSpan={nbCols - 1}>TOTAL GÉNÉRAL</td>
                              <td
                                className={`num-cell ${signeEcart(ecartsData.grandTotal)}`}
                              >
                                {fmtXpfE(ecartsData.grandTotal)}
                              </td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  );
                })()
              )}
            </div>
          ) : (
          <div className="admin-bipages-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  {/* Colonne de repères : corrigée / ajoutée à la main. */}
                  <th className="marq-col" aria-label="Repères" />
                  <th>Zone</th>
                  <th>Emplacement</th>
                  <th title="Ce que le collecteur a réellement bipé : le code-barres s'il a douché une étiquette, le NART s'il l'a saisi. Aucune résolution.">
                    Code bipé
                  </th>
                  <th title="Code-barres de l'article dans le catalogue, obtenu en résolvant le code bipé (NART ou renvoi GENDOUBL), et re-résolu quand le NART change.">
                    Gencode
                  </th>
                  <th>Qté scan</th>
                  <th>NART</th>
                  <th>Désignation</th>
                  <th>Agent</th>
                  <th>Observation</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {lignes.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="no-data">
                      Aucune ligne. Les bipages apparaissent ici dès qu'un .DAT
                      est traité.
                    </td>
                  </tr>
                ) : (
                  lignes.map((l) => (
                    <tr
                      key={l._id}
                      className={`${l.found ? "" : "row-unknown"} ${
                        l.modeImport === "deduction" ? "row-deduction" : ""
                      } ${l.source === "manuel" ? "row-manuelle" : ""} ${
                        l.modifie ? "row-modifiee" : ""
                      }`.trim()}
                    >
                      {/* Repères de la ligne. L'infobulle de la correction dit
                          CE QUI a changé : « corrigée » seul obligerait à
                          rouvrir le .DAT pour le savoir. */}
                      <td className="marq-cell">
                        {l.source === "manuel" && (
                          <HiPlusCircle
                            className="marq marq-manuelle"
                            title={`Ligne ajoutée à la main${
                              l.agentNom ? ` par ${l.agentNom}` : ""
                            }`}
                          />
                        )}
                        {l.modifie && (
                          <HiPencilAlt
                            className="marq marq-modifiee"
                            title={resumeCorrection(l)}
                          />
                        )}
                      </td>
                      <td className="zone-cell">{l.zoneCode}</td>
                      <td className="zone-cell">{l.zoneType || "—"}</td>
                      <td className="mono">
                        <CelluleCodeBipe ligne={l} />
                      </td>
                      <td className="mono">
                        {enResolution.has(l._id) ? (
                          <PointsChargement />
                        ) : (
                          <CelluleGencode ligne={l} />
                        )}
                      </td>
                      <td>
                        <input
                          className="cell-input num"
                          type="number"
                          step="any"
                          value={l.qteScan ?? ""}
                          onChange={(e) =>
                            updateLocal(l._id, "qteScan", e.target.value)
                          }
                          onBlur={() => saveLine(l._id)}
                          onKeyDown={onCellKeyDown}
                        />
                      </td>
                      <td>
                        <input
                          className="cell-input"
                          type="text"
                          value={l.nart ?? ""}
                          onChange={(e) =>
                            updateLocal(l._id, "nart", e.target.value)
                          }
                          onBlur={() => saveLine(l._id)}
                          onKeyDown={onCellKeyDown}
                        />
                      </td>
                      <td className="desig-cell">
                        {enResolution.has(l._id) ? (
                          <PointsChargement />
                        ) : (
                          l.designation
                        )}
                      </td>
                      <td className="agent-cell">
                        {l.agentNom || l.agentCode ? (
                          <>
                            {l.agentNom || `Code ${l.agentCode}`}
                            {l.source && l.source !== "dat" && (
                              <span
                                className={`src-badge${
                                  l.source === "manuel" ? " manuel" : ""
                                }`}
                              >
                                {l.source === "proforma"
                                  ? "proforma"
                                  : l.source === "manuel"
                                    ? "ajout manuel"
                                    : "excel"}
                              </span>
                            )}
                            {l.modeImport === "deduction" && (
                              <span className="src-badge deduction">déduction</span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <input
                          className="cell-input"
                          type="text"
                          value={l.observation ?? ""}
                          onChange={(e) =>
                            updateLocal(l._id, "observation", e.target.value)
                          }
                          onBlur={() => saveLine(l._id)}
                          onKeyDown={onCellKeyDown}
                        />
                      </td>
                      <td className="num-cell">
                        {l.stock === null || l.stock === undefined
                          ? "—"
                          : l.stock}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

    </div>
  );
};

export default AdminBipagesScreen;