// src/components/admin/EntrepriseModal.jsx
import React, { useState, useEffect } from "react";
import {
  HiX,
  HiPhotograph,
  HiFolder,
  HiDatabase,
  HiClipboardList,
  HiMail,
  HiUserGroup,
  HiPlus,
  HiTrash,
  HiSearch,
  HiColorSwatch,
  HiChartBar,
  HiRefresh,
} from "react-icons/hi";
import {
  useCreateEntrepriseMutation,
  useUpdateEntrepriseMutation,
} from "../../slices/entrepriseApiSlice";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import { useSyncGroupesPrioritairesMutation } from "../../slices/configRapportsApiSlice";
import { BASE_URL } from "../../constants";
import Modal from "../ui/Modal/Modal";
import ConfigResourceTable from "./ConfigResourceTable";
import "./EntrepriseModal.css";

// Onglets « Rapports (par client) » — CRUD embarqué (scopé à l'entreprise).
const REPORT_TABS = [
  {
    key: "rapAbonnements",
    label: "Abonnements clients",
    resource: "abonnements",
    scoped: true,
    fields: [
      { name: "tiers", label: "Tiers", type: "number", required: true },
      { name: "email", label: "Email", type: "text", required: true },
      { name: "newsletter", label: "Newsletter", type: "bool" },
      { name: "facturePdf", label: "Facture PDF", type: "bool" },
      { name: "rapportTgc", label: "Rapport TGC", type: "bool" },
      { name: "xlsExterne", label: "XLS externe", type: "bool" },
      { name: "xlsInterne", label: "XLS interne", type: "bool" },
      { name: "baseCollecteur", label: "Base collecteur", type: "text" },
      { name: "bloquer", label: "Bloquer", type: "bool" },
      { name: "user", label: "Utilisateur (option.)", type: "user" },
    ],
  },
  {
    key: "rapMailsCompta",
    label: "Mails compta",
    resource: "mails-compta",
    scoped: true,
    fields: [
      { name: "idClient", label: "ID client", type: "number", required: true },
      { name: "nomClient", label: "Nom client", type: "text" },
      { name: "mailCompta", label: "Mails compta", type: "mails" },
      { name: "nomCompta", label: "Nom compta", type: "text" },
      { name: "user", label: "Utilisateur (option.)", type: "user" },
    ],
  },
  {
    key: "rapFacturesAuto",
    label: "Factures auto",
    resource: "factures-auto",
    scoped: true,
    fields: [
      { name: "idClient", label: "ID client", type: "text" },
      { name: "client", label: "Client", type: "text" },
      { name: "mails", label: "Mails", type: "mails" },
      { name: "mailsCC", label: "Mails CC", type: "mails" },
      { name: "mailsMaintenance", label: "Mails maintenance", type: "mails" },
      { name: "user", label: "Utilisateur (option.)", type: "user" },
    ],
  },
  {
    key: "rapGroupesSpeciaux",
    label: "Groupes spéciaux",
    resource: "groupes-speciaux",
    scoped: true,
    excel: true,
    fields: [
      { name: "codeListe", label: "Code liste", type: "text", required: true },
      { name: "lblListe", label: "Libellé", type: "text" },
      { name: "format", label: "Format", type: "text" },
      { name: "codeJpg", label: "Code JPG", type: "text" },
    ],
  },
  {
    key: "rapGroupesPrioritaires",
    label: "Groupes prioritaires",
    resource: "groupes-prioritaires",
    scoped: true,
    excel: true,
    fields: [
      { name: "groupe", label: "Groupe", type: "text", required: true },
      // Champ Mongo `description`, affiché « Libellé » partout dans l'UI.
      { name: "description", label: "Libellé", type: "text" },
      // Lecture seule : nb d'articles relevé sur article.dbf de la société
      // lors du dernier scan.
      { name: "nbArticles", label: "Articles", type: "readonly-number" },
      { name: "scanneLe", label: "Dernier scan", type: "readonly-date" },
    ],
  },
];

// Bouton « Compléter depuis les articles » de l'onglet Groupes prioritaires :
// scanne article.dbf de la société et ajoute les codes GROUPE manquants.
const SyncGroupesButton = ({ entrepriseId }) => {
  const [sync, { isLoading }] = useSyncGroupesPrioritairesMutation();
  const [resultat, setResultat] = useState(null);

  const lancer = async () => {
    setResultat(null);
    try {
      const r = await sync({ entrepriseId }).unwrap();
      setResultat({ ok: true, message: r.message });
    } catch (e) {
      setResultat({
        ok: false,
        message: e?.data?.message || "Scan impossible.",
      });
    }
  };

  if (!entrepriseId) return null;

  return (
    <>
      <button
        type="button"
        className="cr-btn cr-btn-scan"
        onClick={lancer}
        disabled={isLoading}
        title="Scanner article.dbf de cette société et ajouter les groupes absents"
      >
        <HiRefresh className={isLoading ? "cr-spin" : ""} />{" "}
        {isLoading ? "Scan en cours…" : "Compléter depuis les articles"}
      </button>
      {resultat && (
        <span className={`cr-scan-msg ${resultat.ok ? "ok" : "ko"}`}>
          {resultat.message}
        </span>
      )}
    </>
  );
};

// Groupes de la nav verticale (mode page). Le groupe « Rapports » n'apparaît
// qu'en édition (entreprise déjà enregistrée).
const NAV_GROUPS = [
  {
    label: "Général",
    items: [
      { key: "general", label: "Général" },
      { key: "apparence", label: "Apparence" },
      { key: "chemins", label: "Chemins" },
      { key: "entrepots", label: "Entrepôts" },
    ],
  },
  {
    label: "États",
    items: [
      { key: "etats", label: "États Commande" },
      { key: "etatsFacture", label: "États Facture" },
      { key: "etatsProforma", label: "États Proforma" },
      { key: "etatsReservation", label: "États Réservation" },
    ],
  },
  { label: "Réception & emails", items: [{ key: "reception", label: "Réception" }] },
  {
    label: "Commercial",
    items: [
      { key: "vendeurs", label: "Vendeurs" },
      { key: "analyseCA", label: "Analyse CA" },
    ],
  },
  {
    label: "Rapports (par client)",
    report: true,
    items: REPORT_TABS.map((t) => ({ key: t.key, label: t.label })),
  },
];

const DEFAULT_ETATS_COMMANDE = {
  0: "Brouillon",
  1: "A Préparer",
  2: "Proforma",
  3: "Reliquat",
  4: "Envoyée",
  5: "Confirmée",
  6: "Transit",
  7: "Bateau",
  8: "Avion",
  9: "Commande locale",
};

const DEFAULT_PRIMAIRE = "#4F46E5";
const DEFAULT_SECONDAIRE = "#10B981";
const LOGO_MAX_PX = 400; // redimensionnement max (garde le base64 léger)

// ---- ANALYSE CA : défauts (= configuration QC d'origine du pipeline Python) ----
const ACA_CLASSES_DEFAUT = [
  { k: "10", v: "Visserie / Boulonnerie" },
  { k: "20", v: "Outillage" },
  { k: "30", v: "Quincaillerie" },
  { k: "40", v: "Électricité" },
  { k: "50", v: "Peinture" },
  { k: "60", v: "Plomberie / Sanitaire" },
  { k: "70", v: "Jardin / Extérieur" },
  { k: "80", v: "Divers" },
  { k: "90", v: "Matériaux" },
];
const ACA_NORMALISATION_DEFAUT = [
  { k: "PRO DEBIT EXPORT", v: "PRO DEBIT" },
  { k: "PRO DEBIT*", v: "PRO DEBIT" },
  { k: "PRO DEBIT MINE", v: "PRO DEBIT" },
  { k: "PARTICULER", v: "PARTICULIER" },
  { k: "COMPTANT", v: "PRO COMPTANT" },
  { k: "EMPLOYEE", v: "EMPLOYE" },
  { k: "ADMINISTRATIF", v: "ADMINISTRATION" },
  { k: "AGRICULTEUR                             PRO COMPTANT", v: "AGRICULTEUR" },
  { k: "COMPTE FERME", v: "AUTRE" },
  { k: "INTERNE", v: "INTERNE" },
];

// Formulaire ANALYSE CA vierge (listes en texte "1, 2, 3" ; maps en lignes k/v)
const defaultAnalyseCaForm = () => ({
  seuilTiersInterne: 9905,
  seuilPvteAberrante: 100,
  tiersInternesAutorises:
    "9994, 9915, 9913, 9925, 9914, 9910, 9916, 9905, 9920, 9912, 9998, 9995",
  tiersExclusCA: "2226",
  tiersForcerAutre: "",
  articlesExclusPrefixes: "08",
  articlesExclusExacts: "000001",
  nomsClasses: ACA_CLASSES_DEFAUT.map((r) => ({ ...r })),
  nomsSousClasses: [],
  nomsLocates: [],
  normalisationCategories: ACA_NORMALISATION_DEFAUT.map((r) => ({ ...r })),
});

// entreprise.analyseCA (JSON) -> formulaire d'édition
const analyseCaToForm = (a) => {
  const def = defaultAnalyseCaForm();
  if (!a || typeof a !== "object") return def;
  const texte = (arr, fallback) =>
    Array.isArray(arr) ? arr.join(", ") : fallback;
  const lignes = (obj, fallback) =>
    obj && typeof obj === "object" && Object.keys(obj).length > 0
      ? Object.entries(obj).map(([k, v]) => ({ k, v: String(v ?? "") }))
      : fallback;
  return {
    seuilTiersInterne: Number.isFinite(a.seuilTiersInterne)
      ? a.seuilTiersInterne
      : def.seuilTiersInterne,
    seuilPvteAberrante: Number.isFinite(a.seuilPvteAberrante)
      ? a.seuilPvteAberrante
      : def.seuilPvteAberrante,
    tiersInternesAutorises: texte(
      a.tiersInternesAutorises, def.tiersInternesAutorises,
    ),
    tiersExclusCA: texte(a.tiersExclusCA, def.tiersExclusCA),
    tiersForcerAutre: texte(a.tiersForcerAutre, def.tiersForcerAutre),
    articlesExclusPrefixes: texte(
      a.articlesExclusPrefixes, def.articlesExclusPrefixes,
    ),
    articlesExclusExacts: texte(a.articlesExclusExacts, def.articlesExclusExacts),
    nomsClasses: lignes(a.nomsClasses, def.nomsClasses),
    nomsSousClasses: lignes(a.nomsSousClasses, def.nomsSousClasses),
    nomsLocates: lignes(a.nomsLocates, def.nomsLocates),
    normalisationCategories: lignes(
      a.normalisationCategories, def.normalisationCategories,
    ),
  };
};

const EntrepriseModal = ({ entreprise, onClose, asPage = false }) => {
  const isEdit = !!entreprise;

  const [formData, setFormData] = useState({
    nomDossierDBF: "",
    trigramme: "",
    nomComplet: "",
    description: "",
    cheminBase: "\\\\serveur\\Bases",
    cheminPhotos: "",
    cheminExportInventaire: "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
    mappingEntrepots: {
      S1: "Magasin",
      S2: "S2",
      S3: "S3",
      S4: "S4",
      S5: "S5",
    },
    mappingEtatsCommande: { ...DEFAULT_ETATS_COMMANDE },
    mappingEtatsFacture: {},
    mappingEtatsProforma: {},
    mappingEtatsReservation: {},
    cheminRapportReception:
      "\\\\192.168.0.250\\Rcommun\\STOCK\\controle commande",
    emailsRapportReception: [],
    emailsRapportPreparation: [],
    emailsChgtPrixVente: [],
    emailsPropoReappro: [],
    mailCompta: [],
    nomCompta: "",
    userCompta: "",
    cheminLogoEtiquettes: "",
    couleurPrimaire: DEFAULT_PRIMAIRE,
    couleurSecondaire: DEFAULT_SECONDAIRE,
    logo: "",
    vendeurs: [],
    analyseCA: defaultAnalyseCaForm(),
    isActive: true,
  });

  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("general");
  const [detecting, setDetecting] = useState(false);
  const [vendeursMsg, setVendeursMsg] = useState("");

  const [createEntreprise, { isLoading: isCreating }] =
    useCreateEntrepriseMutation();
  const [updateEntreprise, { isLoading: isUpdating }] =
    useUpdateEntrepriseMutation();

  // Utilisateurs (pour le rattachement OPTIONNEL du contact compta).
  const { data: usersData } = useGetUsersQuery();
  const usersList = Array.isArray(usersData)
    ? usersData
    : usersData?.users || [];

  useEffect(() => {
    if (entreprise) {
      // Reconstruire le mapping des états depuis l'entreprise
      const etatsFromEntreprise = { ...DEFAULT_ETATS_COMMANDE };
      if (entreprise.mappingEtatsCommande) {
        const mapping = entreprise.mappingEtatsCommande;
        Object.keys(mapping).forEach((key) => {
          etatsFromEntreprise[key] = mapping[key];
        });
      }

      // États facture / proforma (libellés libres, défaut vide)
      const factureFromEnt = {};
      if (entreprise.mappingEtatsFacture) {
        Object.entries(entreprise.mappingEtatsFacture).forEach(([k, v]) => {
          factureFromEnt[k] = v;
        });
      }
      const proformaFromEnt = {};
      if (entreprise.mappingEtatsProforma) {
        Object.entries(entreprise.mappingEtatsProforma).forEach(([k, v]) => {
          proformaFromEnt[k] = v;
        });
      }
      const reservationFromEnt = {};
      if (entreprise.mappingEtatsReservation) {
        Object.entries(entreprise.mappingEtatsReservation).forEach(([k, v]) => {
          reservationFromEnt[k] = v;
        });
      }

      setFormData({
        nomDossierDBF: entreprise.nomDossierDBF || "",
        trigramme: entreprise.trigramme || "",
        nomComplet: entreprise.nomComplet || "",
        description: entreprise.description || "",
        cheminBase: entreprise.cheminBase || "\\\\serveur\\Bases",
        cheminPhotos: entreprise.cheminPhotos || "",
        cheminExportInventaire:
          entreprise.cheminExportInventaire ||
          "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
        mappingEntrepots: {
          S1: entreprise.mappingEntrepots?.S1 || "Magasin",
          S2: entreprise.mappingEntrepots?.S2 || "S2",
          S3: entreprise.mappingEntrepots?.S3 || "S3",
          S4: entreprise.mappingEntrepots?.S4 || "S4",
          S5: entreprise.mappingEntrepots?.S5 || "S5",
        },
        mappingEtatsCommande: etatsFromEntreprise,
        mappingEtatsFacture: factureFromEnt,
        mappingEtatsProforma: proformaFromEnt,
        mappingEtatsReservation: reservationFromEnt,
        cheminRapportReception:
          entreprise.cheminRapportReception ||
          "\\\\192.168.0.250\\Rcommun\\STOCK\\controle commande",
        emailsRapportReception: Array.isArray(
          entreprise.emailsRapportReception,
        )
          ? entreprise.emailsRapportReception
          : [],
        emailsRapportPreparation: Array.isArray(
          entreprise.emailsRapportPreparation,
        )
          ? entreprise.emailsRapportPreparation
          : [],
        emailsChgtPrixVente: Array.isArray(entreprise.emailsChgtPrixVente)
          ? entreprise.emailsChgtPrixVente
          : [],
        emailsPropoReappro: Array.isArray(entreprise.emailsPropoReappro)
          ? entreprise.emailsPropoReappro
          : [],
        mailCompta: Array.isArray(entreprise.mailCompta)
          ? entreprise.mailCompta
          : [],
        nomCompta: entreprise.nomCompta || "",
        userCompta: entreprise.userCompta?._id || entreprise.userCompta || "",
        cheminLogoEtiquettes: entreprise.cheminLogoEtiquettes || "",
        couleurPrimaire: entreprise.couleurPrimaire || DEFAULT_PRIMAIRE,
        couleurSecondaire: entreprise.couleurSecondaire || DEFAULT_SECONDAIRE,
        logo: entreprise.logo || "",
        analyseCA: analyseCaToForm(entreprise.analyseCA),
        vendeurs: Array.isArray(entreprise.vendeurs)
          ? entreprise.vendeurs.map((v) => ({
              code: v.code || "",
              nom: v.nom || "",
              prenom: v.prenom || "",
              email: v.email || "",
              type: v.type || "vendeur",
            }))
          : [],
        isActive: entreprise.isActive ?? true,
      });
    }
  }, [entreprise]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    // Auto-uppercase pour trigramme
    if (name === "trigramme") {
      setFormData((prev) => ({
        ...prev,
        [name]: value.toUpperCase(),
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleMappingChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEntrepots: {
        ...prev.mappingEntrepots,
        [field]: value,
      },
    }));
  };

  const handleEtatChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsCommande: {
        ...prev.mappingEtatsCommande,
        [key]: value,
      },
    }));
  };

  const handleEtatFactureChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsFacture: { ...prev.mappingEtatsFacture, [key]: value },
    }));
  };

  const handleEtatProformaChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsProforma: { ...prev.mappingEtatsProforma, [key]: value },
    }));
  };

  const handleEtatReservationChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsReservation: { ...prev.mappingEtatsReservation, [key]: value },
    }));
  };

  const handleResetEtats = () => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsCommande: { ...DEFAULT_ETATS_COMMANDE },
    }));
  };

  // Emails du rapport réception : édition multi-lignes (1 email par ligne)
  const handleEmailsChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      emailsRapportReception: e.target.value.split("\n"),
    }));
  };

  // Emails du rapport de PRÉPARATION : édition multi-lignes (1 email par ligne)
  const handleEmailsPrepaChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      emailsRapportPreparation: e.target.value.split("\n"),
    }));
  };

  // Emails alerte « changement de prix de vente » (master report).
  const handleEmailsChgtPrixChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      emailsChgtPrixVente: e.target.value.split("\n"),
    }));
  };

  // Emails compta (plusieurs possibles) — 1 par ligne.
  const handleMailComptaChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      mailCompta: e.target.value.split("\n"),
    }));
  };

  // Emails « proposition de réappro » (master report).
  const handleEmailsPropoReapproChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      emailsPropoReappro: e.target.value.split("\n"),
    }));
  };

  // ---- Apparence (couleurs + logo) ----
  const handleColorChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLogoFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Le logo doit être un fichier image (PNG/JPG).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > LOGO_MAX_PX || h > LOGO_MAX_PX) {
          const ratio = Math.min(LOGO_MAX_PX / w, LOGO_MAX_PX / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        // PNG : conserve la transparence
        const dataUrl = canvas.toDataURL("image/png");
        setFormData((prev) => ({ ...prev, logo: dataUrl }));
        setError("");
      };
      img.onerror = () => setError("Image illisible.");
      img.src = ev.target.result;
    };
    reader.onerror = () => setError("Lecture du fichier impossible.");
    reader.readAsDataURL(file);
  };

  const removeLogo = () => setFormData((prev) => ({ ...prev, logo: "" }));

  // ---- Vendeurs (codes REPRES) ----
  const addVendeur = () => {
    setFormData((prev) => ({
      ...prev,
      vendeurs: [
        ...prev.vendeurs,
        { code: "", nom: "", prenom: "", email: "", type: "vendeur" },
      ],
    }));
  };

  const updateVendeur = (index, field, value) => {
    setFormData((prev) => {
      const vendeurs = [...prev.vendeurs];
      const val =
        field === "code" ? value.replace(/\D/g, "").slice(0, 2) : value;
      vendeurs[index] = { ...vendeurs[index], [field]: val };
      return { ...prev, vendeurs };
    });
  };

  const removeVendeur = (index) => {
    setFormData((prev) => ({
      ...prev,
      vendeurs: prev.vendeurs.filter((_, i) => i !== index),
    }));
  };

  // ---- ANALYSE CA : champs simples / listes texte ----
  const handleAnalyseCaField = (name, value) => {
    setFormData((prev) => ({
      ...prev,
      analyseCA: { ...prev.analyseCA, [name]: value },
    }));
  };

  // ---- ANALYSE CA : éditeurs clé -> valeur (classes, locates, catégories) ----
  const handleAnalyseCaRow = (liste, index, field, value) => {
    setFormData((prev) => {
      const rows = [...prev.analyseCA[liste]];
      rows[index] = { ...rows[index], [field]: value };
      return { ...prev, analyseCA: { ...prev.analyseCA, [liste]: rows } };
    });
  };

  const addAnalyseCaRow = (liste) => {
    setFormData((prev) => ({
      ...prev,
      analyseCA: {
        ...prev.analyseCA,
        [liste]: [...prev.analyseCA[liste], { k: "", v: "" }],
      },
    }));
  };

  const removeAnalyseCaRow = (liste, index) => {
    setFormData((prev) => ({
      ...prev,
      analyseCA: {
        ...prev.analyseCA,
        [liste]: prev.analyseCA[liste].filter((_, i) => i !== index),
      },
    }));
  };

  const resetAnalyseCa = () => {
    setFormData((prev) => ({ ...prev, analyseCA: defaultAnalyseCaForm() }));
  };

  // Auto-détection des codes vendeurs depuis facture.REPRES
  const detecterVendeurs = async () => {
    if (!formData.nomDossierDBF.trim()) {
      setVendeursMsg("Renseignez d'abord le « Nom dossier DBF ».");
      return;
    }
    setDetecting(true);
    setVendeursMsg("");
    try {
      const res = await fetch(
        `${BASE_URL}/api/entreprises/${formData.nomDossierDBF.trim()}/representants`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || "Échec de la détection");
      }
      const data = await res.json();
      const existants = new Set(
        formData.vendeurs.map((v) => String(v.code).trim()),
      );
      const aAjouter = (data.representants || [])
        .filter((r) => !existants.has(String(r.code).trim()))
        .map((r) => ({
          code: r.code,
          nom: "",
          prenom: "",
          email: "",
          type: "vendeur",
        }));
      if (aAjouter.length === 0) {
        setVendeursMsg("Aucun nouveau code trouvé dans les factures.");
      } else {
        setFormData((prev) => ({
          ...prev,
          vendeurs: [...prev.vendeurs, ...aAjouter].sort((a, b) =>
            String(a.code).localeCompare(String(b.code)),
          ),
        }));
        setVendeursMsg(
          `${aAjouter.length} code(s) ajouté(s) depuis les factures.`,
        );
      }
    } catch (e) {
      setVendeursMsg(e.message);
    } finally {
      setDetecting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Validation
    if (formData.trigramme.length < 2 || formData.trigramme.length > 5) {
      setError("Le trigramme doit contenir entre 2 et 5 caractères");
      return;
    }

    // Normalisation des emails (accepte retours ligne, virgules, points-virgules)
    const emails = (formData.emailsRapportReception || [])
      .flatMap((l) => String(l).split(/[,;]+/))
      .map((s) => s.trim())
      .filter(Boolean);
    const emailsPrepa = (formData.emailsRapportPreparation || [])
      .flatMap((l) => String(l).split(/[,;]+/))
      .map((s) => s.trim())
      .filter(Boolean);
    const emailsChgtPrix = (formData.emailsChgtPrixVente || [])
      .flatMap((l) => String(l).split(/[,;]+/))
      .map((s) => s.trim())
      .filter(Boolean);
    const emailsReappro = (formData.emailsPropoReappro || [])
      .flatMap((l) => String(l).split(/[,;]+/))
      .map((s) => s.trim())
      .filter(Boolean);
    const mailsCompta = (formData.mailCompta || [])
      .flatMap((l) => String(l).split(/[,;]+/))
      .map((s) => s.trim())
      .filter(Boolean);
    // ANALYSE CA : formulaire -> structure API (listes/nombres/maps)
    const aca = formData.analyseCA;
    const listeNombres = (txt) =>
      String(txt || "")
        .split(/[,;\s]+/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => parseInt(v, 10))
        .filter((n) => Number.isFinite(n));
    const listeTextes = (txt) =>
      String(txt || "")
        .split(/[,;]+/)
        .map((v) => v.trim())
        .filter(Boolean);
    const lignesEnMap = (rows) =>
      Object.fromEntries(
        (rows || [])
          .map((r) => [String(r.k ?? "").trim(), String(r.v ?? "").trim()])
          .filter(([k]) => k !== ""),
      );
    const analyseCAPayload = {
      seuilTiersInterne: parseInt(aca.seuilTiersInterne, 10),
      seuilPvteAberrante: parseInt(aca.seuilPvteAberrante, 10),
      tiersInternesAutorises: listeNombres(aca.tiersInternesAutorises),
      tiersExclusCA: listeNombres(aca.tiersExclusCA),
      tiersForcerAutre: listeNombres(aca.tiersForcerAutre),
      articlesExclusPrefixes: listeTextes(aca.articlesExclusPrefixes),
      articlesExclusExacts: listeTextes(aca.articlesExclusExacts),
      nomsClasses: lignesEnMap(aca.nomsClasses),
      nomsSousClasses: lignesEnMap(aca.nomsSousClasses),
      nomsLocates: lignesEnMap(aca.nomsLocates),
      normalisationCategories: lignesEnMap(aca.normalisationCategories),
    };

    const payload = {
      ...formData,
      emailsRapportReception: emails,
      emailsRapportPreparation: emailsPrepa,
      emailsChgtPrixVente: emailsChgtPrix,
      emailsPropoReappro: emailsReappro,
      mailCompta: mailsCompta,
      userCompta: formData.userCompta || null,
      analyseCA: analyseCAPayload,
    };

    try {
      if (isEdit) {
        await updateEntreprise({ id: entreprise._id, ...payload }).unwrap();
      } else {
        await createEntreprise(payload).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue");
    }
  };

  const tabsBar = (
      <div className="modal-tabs">
        <button
          className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          Général
        </button>
        <button
          className={`tab-btn ${activeTab === "apparence" ? "active" : ""}`}
          onClick={() => setActiveTab("apparence")}
        >
          <HiColorSwatch /> Apparence
        </button>
        <button
          className={`tab-btn ${activeTab === "chemins" ? "active" : ""}`}
          onClick={() => setActiveTab("chemins")}
        >
          <HiFolder /> Chemins
        </button>
        <button
          className={`tab-btn ${activeTab === "entrepots" ? "active" : ""}`}
          onClick={() => setActiveTab("entrepots")}
        >
          <HiDatabase /> Entrepôts
        </button>
        <button
          className={`tab-btn ${activeTab === "etats" ? "active" : ""}`}
          onClick={() => setActiveTab("etats")}
        >
          <HiClipboardList /> États Commande
        </button>
        <button
          className={`tab-btn ${activeTab === "etatsFacture" ? "active" : ""}`}
          onClick={() => setActiveTab("etatsFacture")}
        >
          <HiClipboardList /> États Facture
        </button>
        <button
          className={`tab-btn ${activeTab === "etatsProforma" ? "active" : ""}`}
          onClick={() => setActiveTab("etatsProforma")}
        >
          <HiClipboardList /> États Proforma
        </button>
        <button
          className={`tab-btn ${activeTab === "etatsReservation" ? "active" : ""}`}
          onClick={() => setActiveTab("etatsReservation")}
        >
          <HiClipboardList /> États Réservation
        </button>
        <button
          className={`tab-btn ${activeTab === "reception" ? "active" : ""}`}
          onClick={() => setActiveTab("reception")}
        >
          <HiMail /> Réception
        </button>
        <button
          className={`tab-btn ${activeTab === "vendeurs" ? "active" : ""}`}
          onClick={() => setActiveTab("vendeurs")}
        >
          <HiUserGroup /> Vendeurs
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "analyseCA" ? "active" : ""}`}
          onClick={() => setActiveTab("analyseCA")}
        >
          <HiChartBar /> Analyse CA
        </button>
      </div>
  );

  const formEl = (
      <form onSubmit={handleSubmit} className="modal-form">
        {error && <div className="form-error">{error}</div>}

        {/* Tab Général */}
        {activeTab === "general" && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>Trigramme *</label>
                <input
                  type="text"
                  name="trigramme"
                  value={formData.trigramme}
                  onChange={handleChange}
                  placeholder="QC"
                  maxLength={5}
                  required
                />
                <span className="input-hint">2 à 5 caractères</span>
              </div>
              <div className="form-group">
                <label>Nom dossier DBF *</label>
                <input
                  type="text"
                  name="nomDossierDBF"
                  value={formData.nomDossierDBF}
                  onChange={handleChange}
                  placeholder="QC_DISTRIBUTION"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Nom complet *</label>
              <input
                type="text"
                name="nomComplet"
                value={formData.nomComplet}
                onChange={handleChange}
                placeholder="QC Distribution"
                required
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Description de l'entreprise..."
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleChange}
                />
                <span>Entreprise active</span>
              </label>
            </div>
          </>
        )}

        {/* Tab Apparence */}
        {activeTab === "apparence" && (
          <>
            <p className="tab-description">
              Couleurs de marque et logo de l'entreprise. Réutilisables sur
              les rapports PDF et les étiquettes.
            </p>

            <div className="form-row">
              <div className="form-group">
                <label>
                  <HiColorSwatch /> Couleur primaire
                </label>
                <div className="color-field">
                  <input
                    type="color"
                    value={formData.couleurPrimaire || DEFAULT_PRIMAIRE}
                    onChange={(e) =>
                      handleColorChange("couleurPrimaire", e.target.value)
                    }
                  />
                  <input
                    type="text"
                    value={formData.couleurPrimaire || ""}
                    onChange={(e) =>
                      handleColorChange("couleurPrimaire", e.target.value)
                    }
                    placeholder={DEFAULT_PRIMAIRE}
                    maxLength={7}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>
                  <HiColorSwatch /> Couleur secondaire
                </label>
                <div className="color-field">
                  <input
                    type="color"
                    value={formData.couleurSecondaire || DEFAULT_SECONDAIRE}
                    onChange={(e) =>
                      handleColorChange("couleurSecondaire", e.target.value)
                    }
                  />
                  <input
                    type="text"
                    value={formData.couleurSecondaire || ""}
                    onChange={(e) =>
                      handleColorChange("couleurSecondaire", e.target.value)
                    }
                    placeholder={DEFAULT_SECONDAIRE}
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>
                <HiPhotograph /> Logo
              </label>
              <div className="logo-uploader">
                <div className="logo-preview">
                  {formData.logo ? (
                    <img src={formData.logo} alt="Logo entreprise" />
                  ) : (
                    <span className="logo-empty">Aucun logo</span>
                  )}
                </div>
                <div className="logo-actions">
                  <label className="btn-logo-upload">
                    <HiPhotograph /> Choisir une image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFile}
                      hidden
                    />
                  </label>
                  {formData.logo ? (
                    <button
                      type="button"
                      className="btn-logo-remove"
                      onClick={removeLogo}
                    >
                      <HiTrash /> Retirer
                    </button>
                  ) : null}
                  <span className="input-hint">
                    PNG/JPG. Redimensionné automatiquement (max {LOGO_MAX_PX}px)
                    et stocké compressé dans l'entreprise.
                  </span>
                </div>
              </div>
            </div>

            <div className="apparence-preview">
              <span
                className="swatch"
                style={{ background: formData.couleurPrimaire || DEFAULT_PRIMAIRE }}
                title="Primaire"
              />
              <span
                className="swatch"
                style={{
                  background: formData.couleurSecondaire || DEFAULT_SECONDAIRE,
                }}
                title="Secondaire"
              />
              <span className="apparence-preview-lbl">
                Aperçu des couleurs
              </span>
            </div>
          </>
        )}

        {/* Tab Chemins */}
        {activeTab === "chemins" && (
          <>
            <div className="form-group">
              <label>
                <HiDatabase /> Chemin de base (DBF)
              </label>
              <input
                type="text"
                name="cheminBase"
                value={formData.cheminBase}
                onChange={handleChange}
                placeholder="\\serveur\Bases"
              />
              <span className="input-hint">
                Chemin complet: {formData.cheminBase}\
                {formData.nomDossierDBF || "[dossier]"}
              </span>
            </div>

            <div className="form-group">
              <label>
                <HiPhotograph /> Chemin des photos
              </label>
              <input
                type="text"
                name="cheminPhotos"
                value={formData.cheminPhotos}
                onChange={handleChange}
                placeholder="\\192.168.0.250\Rcommun\STOCK\photos"
              />
              <span className="input-hint">
                Dossier contenant les photos des articles (ex: NART.jpg)
              </span>
            </div>

            <div className="form-group">
              <label>
                <HiFolder /> Chemin export inventaire
              </label>
              <input
                type="text"
                name="cheminExportInventaire"
                value={formData.cheminExportInventaire}
                onChange={handleChange}
                placeholder="\\192.168.0.250\Rcommun\STOCK\collect_sec"
              />
              <span className="input-hint">
                Dossier où seront déposés les fichiers .dat d'inventaire
              </span>
            </div>

            <div className="form-group">
              <label>
                <HiFolder /> Logo étiquettes (optionnel)
              </label>
              <input
                type="text"
                name="cheminLogoEtiquettes"
                value={formData.cheminLogoEtiquettes}
                onChange={handleChange}
                placeholder="\\192.168.0.250\Rcommun\STOCK\logo.png"
              />
              <span className="input-hint">
                Chemin complet du fichier image (PNG/JPG) affiché sur les
                étiquettes pleine page. Laisser vide pour aucun logo.
              </span>
            </div>
          </>
        )}

        {/* Tab Entrepôts */}
        {activeTab === "entrepots" && (
          <>
            <p className="tab-description">
              Personnalisez les noms des champs stock (S1 à S5) pour cette
              entreprise. Ces noms seront affichés dans la recherche article.
            </p>

            <div className="form-row">
              <div className="form-group">
                <label>S1 (généralement Magasin)</label>
                <input
                  type="text"
                  value={formData.mappingEntrepots.S1}
                  onChange={(e) => handleMappingChange("S1", e.target.value)}
                  placeholder="Magasin"
                />
              </div>
              <div className="form-group">
                <label>S2</label>
                <input
                  type="text"
                  value={formData.mappingEntrepots.S2}
                  onChange={(e) => handleMappingChange("S2", e.target.value)}
                  placeholder="Réserve"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>S3</label>
                <input
                  type="text"
                  value={formData.mappingEntrepots.S3}
                  onChange={(e) => handleMappingChange("S3", e.target.value)}
                  placeholder="Dépôt"
                />
              </div>
              <div className="form-group">
                <label>S4</label>
                <input
                  type="text"
                  value={formData.mappingEntrepots.S4}
                  onChange={(e) => handleMappingChange("S4", e.target.value)}
                  placeholder="Transit"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>S5</label>
                <input
                  type="text"
                  value={formData.mappingEntrepots.S5}
                  onChange={(e) => handleMappingChange("S5", e.target.value)}
                  placeholder="Autre"
                />
              </div>
              <div className="form-group">
                {/* Espace vide pour alignement */}
              </div>
            </div>
          </>
        )}

        {/* Tab États Commande */}
        {activeTab === "etats" && (
          <>
            <div className="tab-description-row">
              <p className="tab-description">
                Personnalisez les libellés des états de commande (0 à 9) pour
                cette entreprise. Ces libellés seront affichés dans le détail
                des commandes.
              </p>
              <button
                type="button"
                className="btn-reset-etats"
                onClick={handleResetEtats}
                title="Réinitialiser les valeurs par défaut"
              >
                Réinitialiser
              </button>
            </div>

            <div className="etats-grid">
              {Object.keys(DEFAULT_ETATS_COMMANDE).map((key) => (
                <div className="form-group etat-field" key={key}>
                  <label>
                    <span className="etat-key">État {key}</span>
                    <span className="etat-default">
                      (défaut: {DEFAULT_ETATS_COMMANDE[key]})
                    </span>
                  </label>
                  <input
                    type="text"
                    value={formData.mappingEtatsCommande[key] || ""}
                    onChange={(e) => handleEtatChange(key, e.target.value)}
                    placeholder={DEFAULT_ETATS_COMMANDE[key]}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Tab États Facture */}
        {activeTab === "etatsFacture" && (
          <>
            <p className="tab-description">
              Définissez les libellés des états de facture (codes 0 à 9) pour
              cette entreprise. Ces libellés seront affichés dans les écrans
              Factures. Laissez vide un code non utilisé.
            </p>
            <div className="etats-grid">
              {Object.keys(DEFAULT_ETATS_COMMANDE).map((key) => (
                <div className="form-group etat-field" key={key}>
                  <label>
                    <span className="etat-key">État {key}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.mappingEtatsFacture[key] || ""}
                    onChange={(e) =>
                      handleEtatFactureChange(key, e.target.value)
                    }
                    placeholder={`Libellé état ${key}`}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Tab États Proforma */}
        {activeTab === "etatsProforma" && (
          <>
            <p className="tab-description">
              Définissez les libellés des états de proforma (codes 0 à 9) pour
              cette entreprise. Ces libellés seront affichés dans les écrans
              Proformas. Laissez vide un code non utilisé.
            </p>
            <div className="etats-grid">
              {Object.keys(DEFAULT_ETATS_COMMANDE).map((key) => (
                <div className="form-group etat-field" key={key}>
                  <label>
                    <span className="etat-key">État {key}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.mappingEtatsProforma[key] || ""}
                    onChange={(e) =>
                      handleEtatProformaChange(key, e.target.value)
                    }
                    placeholder={`Libellé état ${key}`}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Tab États Réservation */}
        {activeTab === "etatsReservation" && (
          <>
            <p className="tab-description">
              Définissez les libellés des états de réservation (codes 0 à 9) pour
              cette entreprise. Laissez vide un code non utilisé.
            </p>
            <div className="etats-grid">
              {Object.keys(DEFAULT_ETATS_COMMANDE).map((key) => (
                <div className="form-group etat-field" key={key}>
                  <label>
                    <span className="etat-key">État {key}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.mappingEtatsReservation[key] || ""}
                    onChange={(e) =>
                      handleEtatReservationChange(key, e.target.value)
                    }
                    placeholder={`Libellé état ${key}`}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Tab Réception */}
        {activeTab === "reception" && (
          <>
            <p className="tab-description">
              Paramètres du rapport de contrôle commande (réception de
              marchandises) : dossier d'enregistrement du PDF et destinataires
              de l'email.
            </p>

            <div className="form-group">
              <label>
                <HiFolder /> Dossier d'enregistrement du rapport
              </label>
              <input
                type="text"
                name="cheminRapportReception"
                value={formData.cheminRapportReception}
                onChange={handleChange}
                placeholder="\\192.168.0.250\Rcommun\STOCK\controle commande"
              />
              <span className="input-hint">
                Dossier réseau (RCOMMUN) où le PDF du rapport sera déposé.
              </span>
            </div>

            <div className="form-group">
              <label>
                <HiMail /> Emails destinataires du rapport
              </label>
              <textarea
                name="emailsRapportReception"
                rows={5}
                value={(formData.emailsRapportReception || []).join("\n")}
                onChange={handleEmailsChange}
                placeholder={"achats@exemple.com\nresponsable@exemple.com"}
              />
              <span className="input-hint">
                Un email par ligne (les virgules et points-virgules sont aussi
                acceptés). Le rapport PDF leur sera envoyé en pièce jointe.
              </span>
            </div>

            <div className="form-group">
              <label>
                <HiMail /> Emails destinataires du rapport de préparation
              </label>
              <textarea
                name="emailsRapportPreparation"
                rows={5}
                value={(formData.emailsRapportPreparation || []).join("\n")}
                onChange={handleEmailsPrepaChange}
                placeholder={"preparation@exemple.com\ncommercial@exemple.com"}
              />
              <span className="input-hint">
                Un email par ligne (virgules / points-virgules acceptés). Le
                rapport PDF de préparation de commande leur sera envoyé en
                pièce jointe.
              </span>
            </div>

            <div className="form-group">
              <label>
                <HiMail /> Emails alerte « changement de prix de vente »
              </label>
              <textarea
                name="emailsChgtPrixVente"
                rows={4}
                value={(formData.emailsChgtPrixVente || []).join("\n")}
                onChange={handleEmailsChgtPrixChange}
                placeholder={"achat@exemple.com\nn.leroux@exemple.com"}
              />
              <span className="input-hint">
                Un email par ligne (virgules / points-virgules acceptés).
                Destinataires du rapport de changement de prix de vente.
              </span>
            </div>

            <div className="form-group">
              <label>
                <HiMail /> Emails « proposition de réappro »
              </label>
              <textarea
                name="emailsPropoReappro"
                rows={4}
                value={(formData.emailsPropoReappro || []).join("\n")}
                onChange={handleEmailsPropoReapproChange}
                placeholder={"magasin@exemple.com\nachat@exemple.com"}
              />
              <span className="input-hint">
                Un email par ligne (virgules / points-virgules acceptés).
                Destinataires des propositions de réapprovisionnement.
              </span>
            </div>

            <p className="tab-description">
              Contact <strong>comptabilité</strong> de la société (rapports
              TGC / facturation). Vous pouvez rattacher un utilisateur existant
              (optionnel).
            </p>
            <div className="form-row">
              <div className="form-group">
                <label>Emails compta</label>
                <textarea
                  name="mailCompta"
                  rows={3}
                  value={(formData.mailCompta || []).join("\n")}
                  onChange={handleMailComptaChange}
                  placeholder={"comptabilite@exemple.com\ncompta2@exemple.com"}
                />
                <span className="input-hint">
                  Un email par ligne (virgules / points-virgules acceptés).
                </span>
              </div>
              <div className="form-group">
                <label>Nom compta</label>
                <input
                  type="text"
                  name="nomCompta"
                  value={formData.nomCompta}
                  onChange={handleChange}
                  placeholder="Nom du contact"
                />
              </div>
            </div>
            <div className="form-group">
              <label>
                <HiUserGroup /> Utilisateur rattaché (optionnel)
              </label>
              <select
                name="userCompta"
                value={formData.userCompta || ""}
                onChange={handleChange}
              >
                <option value="">— aucun —</option>
                {usersList.map((u) => (
                  <option key={u._id} value={u._id}>
                    {`${u.prenom || ""} ${u.nom || ""}`.trim() || u.email}
                    {u.email ? ` (${u.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Tab Vendeurs */}
        {activeTab === "vendeurs" && (
          <>
            <p className="tab-description">
              Associez chaque code vendeur (champ <strong>REPRES</strong>, 2
              chiffres) à une identité et un type. « Détecter » récupère les
              codes réellement présents dans les factures ; vous pouvez aussi
              en ajouter manuellement.
            </p>

            <div className="vendeurs-toolbar">
              <button
                type="button"
                className="btn-detect-vendeur"
                onClick={detecterVendeurs}
                disabled={detecting}
              >
                <HiSearch />{" "}
                {detecting ? "Détection…" : "Détecter depuis les factures"}
              </button>
              <button
                type="button"
                className="btn-add-vendeur"
                onClick={addVendeur}
              >
                <HiPlus /> Ajouter un code
              </button>
              {vendeursMsg ? (
                <span className="vendeurs-msg">{vendeursMsg}</span>
              ) : null}
            </div>

            {formData.vendeurs.length === 0 ? (
              <div className="vendeurs-empty">
                Aucun code vendeur. Cliquez sur « Détecter » ou « Ajouter un
                code ».
              </div>
            ) : (
              <table className="vendeurs-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Nom</th>
                    <th>Prénom</th>
                    <th>Email</th>
                    <th>Type</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {formData.vendeurs.map((v, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="vendeur-code-input"
                          type="text"
                          inputMode="numeric"
                          value={v.code}
                          maxLength={2}
                          placeholder="00"
                          onChange={(e) =>
                            updateVendeur(i, "code", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={v.nom}
                          placeholder="Nom"
                          onChange={(e) =>
                            updateVendeur(i, "nom", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={v.prenom}
                          placeholder="Prénom"
                          onChange={(e) =>
                            updateVendeur(i, "prenom", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="email"
                          value={v.email}
                          placeholder="email (optionnel)"
                          onChange={(e) =>
                            updateVendeur(i, "email", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <select
                          value={v.type}
                          onChange={(e) =>
                            updateVendeur(i, "type", e.target.value)
                          }
                        >
                          <option value="commercial">Commercial</option>
                          <option value="vendeur">Vendeur</option>
                          <option value="autre">Autre</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-vendeur-remove"
                          onClick={() => removeVendeur(i)}
                          title="Supprimer"
                        >
                          <HiTrash />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === "analyseCA" && (
          <>
            <p className="tab-description">
              Paramètres du module <strong>Analyse CA</strong> pour CETTE
              entreprise (équivalents du config.py du pipeline). Les valeurs
              par défaut correspondent à la configuration QC.
            </p>

            <div className="aca-toolbar">
              <button
                type="button"
                className="btn-add-vendeur"
                onClick={resetAnalyseCa}
              >
                Réinitialiser (valeurs QC)
              </button>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Seuil tiers interne</label>
                <input
                  type="number"
                  value={formData.analyseCA.seuilTiersInterne}
                  onChange={(e) =>
                    handleAnalyseCaField("seuilTiersInterne", e.target.value)
                  }
                />
                <small>TIERS ≥ seuil = compte interne</small>
              </div>
              <div className="form-group">
                <label>Seuil PVTE aberrante (× catalogue)</label>
                <input
                  type="number"
                  value={formData.analyseCA.seuilPvteAberrante}
                  onChange={(e) =>
                    handleAnalyseCaField("seuilPvteAberrante", e.target.value)
                  }
                />
                <small>Ligne exclue si PVTE &gt; catalogue × seuil</small>
              </div>
            </div>

            <div className="form-group">
              <label>Tiers internes autorisés (analyse interne)</label>
              <input
                type="text"
                value={formData.analyseCA.tiersInternesAutorises}
                onChange={(e) =>
                  handleAnalyseCaField("tiersInternesAutorises", e.target.value)
                }
                placeholder="9994, 9915, 9913…"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Tiers exclus du CA</label>
                <input
                  type="text"
                  value={formData.analyseCA.tiersExclusCA}
                  onChange={(e) =>
                    handleAnalyseCaField("tiersExclusCA", e.target.value)
                  }
                  placeholder="2226 (BON DE CAISSE)"
                />
              </div>
              <div className="form-group">
                <label>Tiers forcés en catégorie AUTRE</label>
                <input
                  type="text"
                  value={formData.analyseCA.tiersForcerAutre}
                  onChange={(e) =>
                    handleAnalyseCaField("tiersForcerAutre", e.target.value)
                  }
                  placeholder="vide = aucun"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Préfixes d'articles exclus</label>
                <input
                  type="text"
                  value={formData.analyseCA.articlesExclusPrefixes}
                  onChange={(e) =>
                    handleAnalyseCaField(
                      "articlesExclusPrefixes", e.target.value,
                    )
                  }
                  placeholder="08 (ECOPART)"
                />
              </div>
              <div className="form-group">
                <label>Codes articles exclus (exacts)</label>
                <input
                  type="text"
                  value={formData.analyseCA.articlesExclusExacts}
                  onChange={(e) =>
                    handleAnalyseCaField("articlesExclusExacts", e.target.value)
                  }
                  placeholder="000001 (PROFORMA)"
                />
              </div>
            </div>

            {[
              {
                liste: "nomsClasses",
                titre: "Noms des classes",
                aide: "Préfixe article (dizaine) → libellé (onglet Classes)",
                cleLabel: "Code",
                valLabel: "Libellé",
              },
              {
                liste: "nomsSousClasses",
                titre: "Noms des sous-classes",
                aide: "Préfixe article 2 chiffres → libellé (onglet Sous_Classes)",
                cleLabel: "Code (2 chiffres)",
                valLabel: "Libellé",
              },
              {
                liste: "nomsLocates",
                titre: "Noms des locates",
                aide: "Code GROUPE → libellé lisible (onglet Locates)",
                cleLabel: "Code groupe",
                valLabel: "Libellé",
              },
              {
                liste: "normalisationCategories",
                titre: "Normalisation des catégories clients",
                aide: "Variante trouvée en base → catégorie canonique",
                cleLabel: "Variante",
                valLabel: "Catégorie",
              },
            ].map((cfg) => (
              <div className="aca-section" key={cfg.liste}>
                <div className="aca-section-header">
                  <h4>{cfg.titre}</h4>
                  <button
                    type="button"
                    className="btn-add-vendeur"
                    onClick={() => addAnalyseCaRow(cfg.liste)}
                  >
                    <HiPlus /> Ajouter
                  </button>
                </div>
                <small className="aca-aide">{cfg.aide}</small>
                {formData.analyseCA[cfg.liste].length === 0 ? (
                  <div className="aca-empty">Aucune entrée.</div>
                ) : (
                  <table className="vendeurs-table aca-table">
                    <thead>
                      <tr>
                        <th>{cfg.cleLabel}</th>
                        <th>{cfg.valLabel}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.analyseCA[cfg.liste].map((row, i) => (
                        <tr key={`${cfg.liste}-${i}`}>
                          <td>
                            <input
                              type="text"
                              value={row.k}
                              onChange={(e) =>
                                handleAnalyseCaRow(
                                  cfg.liste, i, "k", e.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.v}
                              onChange={(e) =>
                                handleAnalyseCaRow(
                                  cfg.liste, i, "v", e.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-vendeur-remove"
                              onClick={() => removeAnalyseCaRow(cfg.liste, i)}
                              title="Supprimer"
                            >
                              <HiTrash />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className="btn-submit"
            disabled={isCreating || isUpdating}
          >
            {isCreating || isUpdating
              ? "Enregistrement..."
              : isEdit
                ? "Modifier"
                : "Créer"}
          </button>
        </div>
      </form>
  );

  const body = (
    <>
      {tabsBar}
      {formEl}
    </>
  );

  // Mode PAGE plein écran (édition depuis /admin/entreprises/:id)
  // Layout : en-tête sticky + nav verticale à gauche + panneau à droite.
  if (asPage) {
    const activeReport = REPORT_TABS.find((t) => t.key === activeTab);
    const hasId = !!entreprise?._id;
    return (
      <div className="entreprise-config-page">
        <div className="ecp-header">
          <h2>Configuration — {entreprise?.nomComplet || "Entreprise"}</h2>
          <div className="ecp-header-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              ← Retour à la liste
            </button>
            <button
              type="button"
              className="btn-submit"
              disabled={isCreating || isUpdating}
              onClick={() => handleSubmit({ preventDefault: () => {} })}
            >
              {isUpdating ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </div>

        <div className="ecp-layout">
          <nav className="ecp-nav">
            {NAV_GROUPS.map((g) => {
              if (g.report && !hasId) return null;
              return (
                <div key={g.label} className="ecp-nav-group">
                  <div className="ecp-nav-group-label">{g.label}</div>
                  {g.items.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      className={`ecp-nav-item ${activeTab === it.key ? "active" : ""}`}
                      onClick={() => setActiveTab(it.key)}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>

          <div className="ecp-content">
            {activeReport ? (
              <ConfigResourceTable
                resource={activeReport.resource}
                fields={activeReport.fields}
                scoped={activeReport.scoped}
                entrepriseId={entreprise?._id}
                label={activeReport.label}
                excel={!!activeReport.excel}
                extraActions={
                  activeReport.resource === "groupes-prioritaires" ? (
                    <SyncGroupesButton entrepriseId={entreprise?._id} />
                  ) : null
                }
              />
            ) : (
              formEl
            )}
          </div>
        </div>
      </div>
    );
  }

  // Mode MODALE (création d'une nouvelle entreprise)
  return (
    <Modal onClose={onClose} contentClassName="modal modal-entreprise">
      <div className="modal-header">
        <h2>{isEdit ? "Modifier l'entreprise" : "Nouvelle entreprise"}</h2>
        <button className="btn-close" onClick={onClose}>
          <HiX />
        </button>
      </div>
      {body}
    </Modal>
  );
};

export default EntrepriseModal;