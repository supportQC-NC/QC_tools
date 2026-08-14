// src/screens/commercial/CommercialReservationsScreen.jsx
//
// MES RÉSERVATIONS — facture.dbf TYPFACT="R", ETAT ≠ 2 (réservation de stock),
// filtrées sur mon code vendeur. Même source que « Entrées sur réservation »,
// donc cohérente avec mes alertes d'arrivée en stock.

import React from "react";
import { HiBookmark } from "react-icons/hi";
import CommercialResaView from "../../components/commercial/CommercialResaView";
import "./CommercialSpace.css";

const CommercialReservationsScreen = () => (
  <CommercialResaView
    titre="Mes réservations"
    sousTitre="Les réservations de stock en cours pour mes clients."
    icone={HiBookmark}
    categorie="reservation"
  />
);

export default CommercialReservationsScreen;
