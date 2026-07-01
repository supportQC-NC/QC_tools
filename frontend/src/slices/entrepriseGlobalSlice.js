// src/slices/entrepriseGlobalSlice.js
// État global : entreprise sélectionnée dans le Header (persistée en localStorage).
// Stocke uniquement le nomDossierDBF ; les infos complètes (logo, couleurs, nom)
// sont relues depuis la liste des entreprises (toujours à jour).
import { createSlice } from "@reduxjs/toolkit";

const STORAGE_KEY = "global_entreprise_dossier";

const initialState = {
  selectedDossier: localStorage.getItem(STORAGE_KEY) || null,
};

const entrepriseGlobalSlice = createSlice({
  name: "entrepriseGlobal",
  initialState,
  reducers: {
    setGlobalEntreprise: (state, action) => {
      const dossier = action.payload || null;
      state.selectedDossier = dossier;
      if (dossier) localStorage.setItem(STORAGE_KEY, dossier);
      else localStorage.removeItem(STORAGE_KEY);
    },
    clearGlobalEntreprise: (state) => {
      state.selectedDossier = null;
      localStorage.removeItem(STORAGE_KEY);
    },
  },
});

export const { setGlobalEntreprise, clearGlobalEntreprise } =
  entrepriseGlobalSlice.actions;

// Sélecteur pratique : nomDossierDBF sélectionné globalement (ou null).
export const selectGlobalDossier = (state) =>
  state.entrepriseGlobal.selectedDossier;

export default entrepriseGlobalSlice.reducer;