// src/components/Utils/CommercialRoute.jsx
//
// Garde de l'ESPACE COMMERCIAL (/commercial/*).
//
// L'accès ne dépend PAS d'un module de permission mais du profil commercial
// (Permission.commercial.actif + au moins un code vendeur). Le contrôle réel est
// fait par l'API (requireCommercial) ; cette garde évite juste d'afficher des
// écrans vides. Contrairement aux autres gardes, un rôle admin ne suffit PAS :
// l'espace n'a de sens que pour un utilisateur rattaché à un code vendeur.

import { Navigate, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import { estCommercial } from "../../config/adminModules";

const CommercialRoute = () => {
  const { userInfo } = useSelector((state) => state.auth);

  if (!userInfo) return <Navigate to="/login" replace />;
  if (!estCommercial(userInfo)) return <Navigate to="/" replace />;

  return <Outlet />;
};

export default CommercialRoute;
