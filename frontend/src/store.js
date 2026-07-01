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
  devTools: true,
});

export default store;