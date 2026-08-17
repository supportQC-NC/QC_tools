// src/screens/commercial/CommercialSpecialesScreen.jsx
//
// MES COMMANDES SPÉCIALES — facture.dbf TYPFACT="R" avec ETAT = 2
// (« Commande Spéciale » dans mappingEtatsReservation), filtrées sur mon code
// vendeur. L'écran indique aussi, document par document, ce qui est ENTRÉ EN
// STOCK et quels clients restent à prévenir.

import React from "react";
import { HiStar } from "react-icons/hi";
import CommercialResaView from "../../components/commercial/CommercialResaView";
import "./CommercialSpace.css";

const CommercialSpecialesScreen = () => (
  <CommercialResaView
    titre="Mes commandes spéciales"
    sousTitre="Commandes spéciales de mes clients, avec leur arrivée en stock et les clients à prévenir."
    icone={HiStar}
    categorie="speciale"
  />
);

export default CommercialSpecialesScreen;
