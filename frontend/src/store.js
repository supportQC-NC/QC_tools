// src/store.js
import { configureStore } from "@reduxjs/toolkit";
import { apiSlice } from "./slices/apiSlice";
import authReducer from "./slices/authSlice";
import inventaireSelectionReducer from "./slices/inventaireSelectionSlice";
import entrepriseGlobalReducer from "./slices/entrepriseGlobalSlice";

const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,
    auth: authReducer,
    inventaireSelection: inventaireSelectionReducer,
    entrepriseGlobal: entrepriseGlobalReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(apiSlice.middleware),
  // DevTools en développement SEULEMENT : avec l'extension installée, chaque
  // action sérialise tout le state — qui porte les gros datasets RTK Query
  // (5 000 lignes de bipage, classeurs CA…). En production c'était un
  // ralentissement global pour quiconque a l'extension.
  devTools: process.env.NODE_ENV !== "production",
});

export default store;