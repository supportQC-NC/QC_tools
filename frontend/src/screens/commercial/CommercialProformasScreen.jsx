// src/screens/commercial/CommercialProformasScreen.jsx
//
// MES PROFORMAS — documents proforma.dbf portant mon code vendeur
// (proforma.REPRES) : devis et commandes à préparer, avec la vue « à relancer ».
//
// ⚠️ Les réservations et commandes spéciales FERMES ne sont pas ici : elles
// vivent dans facture.dbf TYPFACT="R" et ont leurs propres écrans.

import React from "react";
import { HiDocumentReport } from "react-icons/hi";
import CommercialDocumentsView from "../../components/commercial/CommercialDocumentsView";
import "./CommercialSpace.css";

const CommercialProformasScreen = () => (
  <CommercialDocumentsView
    titre="Mes proformas"
    sousTitre="Mes devis et commandes à préparer — et ceux qui attendent une relance."
    icone={HiDocumentReport}
    categorie={null}
    vueRelanceParDefaut
  />
);

export default CommercialProformasScreen;
