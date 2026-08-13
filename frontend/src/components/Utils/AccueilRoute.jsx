// src/components/Utils/AccueilRoute.jsx
//
// Page d'accueil "/" : le tableau de bord habituel, SAUF pour un commercial dont
// l'accueil est son espace dédié (cahier des charges : « le dashboard constitue
// la page d'accueil principale du commercial »).
//
// Un administrateur également rattaché à un code vendeur garde le tableau de
// bord général — il atteint son espace par le menu (« Espace commercial »).

import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { estCommercial } from "../../config/adminModules";
import UserDashboard from "../../screens/user/userDashboardScreen";

const AccueilRoute = () => {
  const { userInfo } = useSelector((state) => state.auth);

  if (userInfo && userInfo.role !== "admin" && estCommercial(userInfo)) {
    return <Navigate to="/commercial" replace />;
  }
  return <UserDashboard />;
};

export default AccueilRoute;
