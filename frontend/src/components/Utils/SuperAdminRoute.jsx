// src/components/Utils/SuperAdminRoute.jsx
import { Navigate, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";

// Super-admin = administrateur ayant accès à TOUTES les entreprises
// (ou admin hérité sans document Permission — cohérent avec le backend).
export const isSuperAdmin = (userInfo) =>
  userInfo?.role === "admin" &&
  (userInfo?.permissions?.allEntreprises === true || !userInfo?.permissions);

/**
 * Réserve une route aux super-admins (gestion Utilisateurs / Entreprises,
 * Analyse Filiales). Un admin « scopé » (limité à certaines entreprises) est
 * renvoyé sur le tableau de bord — qui est unique, donc "/".
 */
const SuperAdminRoute = () => {
  const { userInfo } = useSelector((state) => state.auth);

  if (!userInfo) return <Navigate to="/login" replace />;
  if (userInfo.role !== "admin") return <Navigate to="/" replace />;
  if (!isSuperAdmin(userInfo)) return <Navigate to="/" replace />;

  return <Outlet />;
};

export default SuperAdminRoute;