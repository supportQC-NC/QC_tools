// src/slices/inventaireSelectionSlice.js
import { createSlice } from "@reduxjs/toolkit";

// Conserve l'entreprise (nomDossierDBF) choisie dans les modules Inventaires,
// persistée dans localStorage pour survivre aux changements de page / refresh.
const initialState = {
  selectedEntreprise: localStorage.getItem("invSelectedEntreprise") || "",
};

const inventaireSelectionSlice = createSlice({
  name: "inventaireSelection",
  initialState,
  reducers: {
    setSelectedEntreprise: (state, action) => {
      const val = action.payload || "";
      state.selectedEntreprise = val;
      if (val) localStorage.setItem("invSelectedEntreprise", val);
      else localStorage.removeItem("invSelectedEntreprise");
    },
  },
});

export const { setSelectedEntreprise } = inventaireSelectionSlice.actions;
export default inventaireSelectionSlice.reducer;