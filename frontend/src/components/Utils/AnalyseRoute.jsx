// src/components/Utils/AnalyseRoute.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";

// Correspondance préfixe de chemin -> clé de permission analyse.
const PATH_TO_KEY = [
  { prefix: "/admin/commerciaux", key: "commerciaux" },
  { prefix: "/admin/filiales", key: "filiales" },
  { prefix: "/admin/reappro-local", key: "reapproLocal" },
  { prefix: "/admin/debit-comptant", key: "debitComptant" },
  { prefix: "/admin/gencod-doublons", key: "doublonsGencode" },
  { prefix: "/admin/facture-analyse", key: "factures" },
];

// Super-admin = admin avec accès à toutes les entreprises (ou admin hérité).
const isSuper = (u) =>
  u?.role === "admin" &&
  (u?.permissions?.allEntreprises === true || !u?.permissions);

export const hasAnalyseAccess = (userInfo, key) => {
  if (!userInfo) return false;
  if (isSuper(userInfo)) return true;
  // Filiales : accès à l'écran dès qu'au moins un réseau (DQ/QC/LD) est autorisé.
  if (key === "filiales") {
    const f = userInfo?.permissions?.analyse?.filiales;
    return !!(f && (f.DQ || f.QC || f.LD));
  }
  return userInfo?.permissions?.analyse?.[key] === true;
};

/**
 * Réserve les écrans d'Analyse aux utilisateurs (admins OU users) ayant la
 * permission de l'écran concerné (ou super-admin). Sinon redirige vers l'accueil.
 */
const AnalyseRoute = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const { pathname } = useLocation();

  if (!userInfo) return <Navigate to="/login" replace />;

  const match = PATH_TO_KEY.find((m) => pathname.startsWith(m.prefix));
  if (match && !hasAnalyseAccess(userInfo, match.key)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
};

export default AnalyseRoute;