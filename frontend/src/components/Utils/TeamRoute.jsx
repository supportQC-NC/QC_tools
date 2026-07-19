// src/components/Utils/TeamRoute.jsx
//
// Garde de route pour la gestion des ÉQUIPES : réservée aux admins et aux
// responsables. Le périmètre fin (quelles équipes / quels membres) est appliqué
// côté API (checkTeamAccess / getManageableUserScope).

import { Navigate, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";

const TeamRoute = () => {
  const { userInfo } = useSelector((state) => state.auth);

  if (!userInfo) return <Navigate to="/login" replace />;
  if (userInfo.role === "admin" || userInfo.role === "responsable") {
    return <Outlet />;
  }
  return <Navigate to="/" replace />;
};

export default TeamRoute;
