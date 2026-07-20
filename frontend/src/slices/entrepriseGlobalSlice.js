// src/slices/entrepriseGlobalSlice.js
// État global : entreprise sélectionnée dans le Header (persistée en localStorage).
// Stocke une version allégée de l'entreprise ({ _id, nomDossierDBF, trigramme,
// nomComplet, nom }) afin que chaque écran puisse lire la clé dont il a besoin :
// certains écrans filtrent par _id Mongo, d'autres par nomDossierDBF.
import { createSlice } from "@reduxjs/toolkit";

const STORAGE_KEY = "global_entreprise";
// Ancienne clé (ne stockait que le nomDossierDBF) — nettoyée au chargement.
const LEGACY_KEY = "global_entreprise_dossier";

// Ne conserve que les champs utiles (évite de persister le logo/couleurs, etc.).
const slim = (e) =>
  e
    ? {
        _id: e._id,
        nomDossierDBF: e.nomDossierDBF,
        trigramme: e.trigramme,
        nomComplet: e.nomComplet,
        nom: e.nom,
      }
    : null;

const loadPersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const initialState = {
  selected: loadPersisted(),
};

const entrepriseGlobalSlice = createSlice({
  name: "entrepriseGlobal",
  initialState,
  reducers: {
    // Payload : l'objet entreprise complet (ou null pour désélectionner).
    setGlobalEntreprise: (state, action) => {
      const entreprise = slim(action.payload);
      state.selected = entreprise;
      localStorage.removeItem(LEGACY_KEY);
      if (entreprise) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entreprise));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    clearGlobalEntreprise: (state) => {
      state.selected = null;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    },
  },
});

export const { setGlobalEntreprise, clearGlobalEntreprise } =
  entrepriseGlobalSlice.actions;

// Sélecteurs pratiques.
export const selectGlobalEntreprise = (state) =>
  state.entrepriseGlobal.selected;
export const selectGlobalDossier = (state) =>
  state.entrepriseGlobal.selected?.nomDossierDBF || null;
export const selectGlobalEntrepriseId = (state) =>
  state.entrepriseGlobal.selected?._id || null;

export default entrepriseGlobalSlice.reducer;
