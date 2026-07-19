// src/components/Utils/ModuleRoute.jsx
//
// Garde de route par MODULE. Autorise :
//   - les comptes role="admin" (accès total, inchangé) ;
//   - les utilisateurs disposant de la permission `action` sur `module`.
//
// Utilisation dans le routeur :
//   <Route element={<ModuleRoute module="analyse_ca_admin" />}>
//     <Route path="/admin/analyse-ca" element={<AdminAnalyseCaScreen />} />
//   </Route>
//
// Le contrôle par SOCIÉTÉ reste géré côté API (checkEntrepriseAccess) : le
// front n'affiche l'écran que si le module est autorisé ; les données sont
// filtrées par le backend selon les entreprises de l'utilisateur.

import { Navigate, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import { hasModuleAccess } from "../../config/adminModules";

const ModuleRoute = ({ module, action = "read", roles = [] }) => {
  const { userInfo } = useSelector((state) => state.auth);

  if (!userInfo) return <Navigate to="/login" replace />;

  // Admin : accès total.
  if (userInfo.role === "admin") return <Outlet />;

  // Rôles explicitement autorisés (ex. "responsable" pour /admin/users, dont
  // les données sont scopées côté API).
  if (roles.includes(userInfo.role)) return <Outlet />;

  // Utilisateur : nécessite la permission sur le module.
  if (hasModuleAccess(userInfo, module, action)) return <Outlet />;

  // Sinon retour à l'accueil.
  return <Navigate to="/" replace />;
};

export default ModuleRoute;