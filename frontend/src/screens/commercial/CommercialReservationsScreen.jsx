// src/screens/commercial/CommercialReservationsScreen.jsx
//
// MES RÉSERVATIONS — facture.dbf TYPFACT="R", ETAT ≠ 2 (réservation de stock),
// filtrées sur mon code vendeur. Même source que « Entrées sur réservation »,
// donc cohérente avec mes alertes d'arrivée en stock : chaque ligne indique si
// la marchandise est arrivée et si le client a déjà été prévenu.

import React from "react";
import { HiBookmark } from "react-icons/hi";
import CommercialResaView from "../../components/commercial/CommercialResaView";
import "./CommercialSpace.css";

const CommercialReservationsScreen = () => (
  <CommercialResaView
    titre="Mes réservations"
    sousTitre="Réservations de stock de mes clients : ce qui est arrivé, ce qui reste attendu, qui reste à prévenir."
    icone={HiBookmark}
    categorie="reservation"
  />
);

export default CommercialReservationsScreen;
