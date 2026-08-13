// src/screens/commercial/CommercialReservationsScreen.jsx
//
// MES RÉSERVATIONS — proforma.ETAT = 1, filtrées sur mon code vendeur.
// Reprend le système de réservation déjà en place dans QC Tools (écran
// Données > Réservations), restreint au périmètre du commercial.

import React from "react";
import { HiBookmark } from "react-icons/hi";
import CommercialDocumentsView from "../../components/commercial/CommercialDocumentsView";
import "./CommercialSpace.css";

const CommercialReservationsScreen = () => (
  <CommercialDocumentsView
    titre="Mes réservations"
    sousTitre="Les réservations en cours de mes clients (article, quantité, date, état)."
    icone={HiBookmark}
    categorie="reservation"
  />
);

export default CommercialReservationsScreen;
