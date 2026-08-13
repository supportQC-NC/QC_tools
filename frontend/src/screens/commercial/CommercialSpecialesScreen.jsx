// src/screens/commercial/CommercialSpecialesScreen.jsx
//
// MES COMMANDES SPÉCIALES — proforma.ETAT = 0, filtrées sur mon code vendeur.
// Le suivi « reçue / entrée en stock / disponible pour le client » est porté par
// l'écran Alertes (croisement avec entrees.dbf), accessible d'un clic.

import React from "react";
import { HiStar } from "react-icons/hi";
import CommercialDocumentsView from "../../components/commercial/CommercialDocumentsView";
import "./CommercialSpace.css";

const CommercialSpecialesScreen = () => (
  <CommercialDocumentsView
    titre="Mes commandes spéciales"
    sousTitre="Commandes spéciales en attente. Les articles arrivés en stock apparaissent dans « Alertes »."
    icone={HiStar}
    categorie="speciale"
  />
);

export default CommercialSpecialesScreen;
