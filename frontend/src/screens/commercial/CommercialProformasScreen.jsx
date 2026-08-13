// src/screens/commercial/CommercialProformasScreen.jsx
//
// MES PROFORMAS — tous les documents proforma.dbf portant mon code vendeur
// (proforma.REPRES), toutes catégories confondues, avec la vue « à relancer ».

import React from "react";
import { HiDocumentReport } from "react-icons/hi";
import CommercialDocumentsView from "../../components/commercial/CommercialDocumentsView";
import "./CommercialSpace.css";

const CommercialProformasScreen = () => (
  <CommercialDocumentsView
    titre="Mes proformas"
    sousTitre="Mes devis, réservations et commandes spéciales — et ceux qui attendent une relance."
    icone={HiDocumentReport}
    categorie={null}
    vueRelanceParDefaut
  />
);

export default CommercialProformasScreen;
