// src/screens/commercial/CommercialSpecialesScreen.jsx
//
// MES COMMANDES SPÉCIALES — facture.dbf TYPFACT="R" avec ETAT = 2
// (« Commande Spéciale » dans mappingEtatsReservation), filtrées sur mon code
// vendeur. Leur arrivée en stock remonte dans « Mes alertes ».

import React from "react";
import { HiStar } from "react-icons/hi";
import CommercialResaView from "../../components/commercial/CommercialResaView";
import "./CommercialSpace.css";

const CommercialSpecialesScreen = () => (
  <CommercialResaView
    titre="Mes commandes spéciales"
    sousTitre="Commandes spéciales de mes clients. Leur arrivée en stock apparaît dans « Mes alertes »."
    icone={HiStar}
    categorie="speciale"
  />
);

export default CommercialSpecialesScreen;
