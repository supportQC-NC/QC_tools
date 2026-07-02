import React from "react";
import ReactDOM from "react-dom/client";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
} from "react-router-dom";
import { Provider } from "react-redux";
import store from "./store";
import "./index.css";
import App from "./App";

import PrivateRoute from "./components/Utils/PrivateRoute";
import AdminRoute from "./components/Utils/AdminRoute";

import Login from "./screens/LoginScreen/LoginScreen";
import ForgotPassword from "./screens/ForgotPasswordScreen/ForgotPasswordScreen";
import ResetPassword from "./screens/ResetPasswordScreen/ResetPasswordScreen";
import NotFound from "./screens/NotFoundScreen/NotFoundScreen";
  import InstallAppScreen from "./screens/InstallAppScreen";
import AdminUsers from "./screens/admin/AdminUsersScreen";
import AdminEntreprises from "./screens/admin/AdminEntreprisesScreen";
import AdminArticles from "./screens/admin/AdminArticlesScreen";
import AdminConcurrents from "./screens/admin/AdminConcurrentsScreen";
import AdminRelevesScreen from "./screens/admin/AdminRelevesScreen";
import AdminInventairesScreen from "./screens/admin/AdminInventairesScreen";
import AdminZonesScreen from "./screens/admin/AdminZonesScreen";
import AdminInventaireProgressionScreen from "./screens/admin/AdminInventaireProgressionScreen";
import AdminFichesControleScreen from "./screens/admin/AdminFichesControleScreen";
import AdminBipagesScreen from "./screens/admin/AdminBipagesScreen";
import AdminInventaireProformaScreen from "./screens/admin/AdminInventaireProformaScreen";
import AdminEtiquettesScreen from "./screens/admin/AdminEtiquettesScreen";
import AdminRecapZonesScreen from "./screens/admin/AdminRecapZonesScreen";
import AdminReapprosScreen from "./screens/admin/AdminReapproScreen";
import AdminArticleInfosScreen from "./screens/admin/AdminArticleInfosScreen";
import AdminCommandesScreen from "./screens/admin/AdminCommandesScreen";
import AdminCommandeDetailScreen from "./screens/admin/AdminCommandeDetailsScreen";

import ArticleSearch from "./screens/user/UserArticleSearch";
import InventaireScreen from "./screens/user/UserInventaire";
import UserReappro from "./screens/user/UserReappro";
import ReleveScreen from "./screens/user/RelevesScreen";
import UserControleCommande from "./screens/user/UserControleCommande";
import AdminDashboard from "./screens/admin/AdminDashboardScreen";
import AdminMeilleursVentesScreen from "./screens/admin/AdminMeilleursVentesScreen";
import UserPreparationCommande from "./screens/user/UserPreparationCommande";
import AdminProformasScreen from "./screens/admin/AdminProformasScreen";
import AdminProformaDetailScreen from "./screens/admin/AdminProformaDetailsScreen";
import UserProformasScreen from "./screens/user/UserProformasScreen";
import AdminFournisseursScreen from "./screens/admin/AdminFournisseursScreen";
import AdminFournisseurInfosScreen from "./screens/admin/AdminFournisseurInfosScreen";
import AdminFacturesScreen from "./screens/admin/AdminFacturesScreen";
import AdminFactureDetailScreen from "./screens/admin/AdminFactureDetailsScreen";
import AdminClientDetailScreen from "./screens/admin/AdminClientDetailsScreen";
import AdminClientsScreen from "./screens/admin/AdminClientsScreen";
import UserDashboard from "./screens/user/userDashboardScreen";
import AdminCommerciauxScreen from "./screens/admin/AdminCommerciauxScreen";
import AdminCommercialDetailScreen from "./screens/admin/AdminCommercialDetailScreen";
import AdminFilialesScreen from "./screens/admin/AdminFilialesScreen";
import AdminReapproLocalScreen from "./screens/admin/AdminReapproLocalScreen";
import AdminDebitComptantScreen from "./screens/admin/AdminDebitComptantScreen";
 import AdminGencodDoublonsScreen from "./screens/admin/AdminGencodDoublonsScreen";
 import AdminPerformanceDockScreen from "./screens/admin/AdminPerformanceDockScreen";
  import AdminCollecteursScreen from "./screens/admin/AdminCollecteursScreen";

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />}>
      <Route path="/login" element={<Login />} />
       <Route path="/install" element={<InstallAppScreen />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />

      <Route element={<PrivateRoute />}>
      <Route path="/" element={<UserDashboard />} />
        <Route path="/articles" element={<ArticleSearch />} />
        <Route path="/inventaire" element={<InventaireScreen />} />
        <Route path="/proformas" element={<UserProformasScreen />} />
        <Route path="/reappro" element={<UserReappro />} />
        <Route path="/releve" element={<ReleveScreen />} />
        <Route path="/controle-commandes" element={<UserControleCommande />} />
        <Route
          path="/preparation-commandes"
          element={<UserPreparationCommande />}
        />
        <Route path="/etiquettes" element={<AdminEtiquettesScreen />} />
      </Route>

      <Route element={<AdminRoute />}>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/entreprises" element={<AdminEntreprises />} />
        <Route path="/admin/articles" element={<AdminArticles />} />
        <Route path="/admin/concurrents" element={<AdminConcurrents />} />
        <Route path="/admin/releves" element={<AdminRelevesScreen />} />
        <Route path="/admin/inventaires" element={<AdminInventairesScreen />} />
        <Route path="/admin/zones" element={<AdminZonesScreen />} />
        <Route path="/admin/commerciaux" element={<AdminCommerciauxScreen />} />
        <Route path="/admin/filiales" element={<AdminFilialesScreen />} />
         <Route path="/admin/performance-dock" element={<AdminPerformanceDockScreen />} />
         <Route path="/admin/collecteurs" element={<AdminCollecteursScreen />} />
 
  <Route path="/admin/collecteurs" element={<AdminCollecteursScreen />} />
         <Route path="/admin/reappro-local" element={<AdminReapproLocalScreen />} />
            <Route path="/admin/debit-comptant" element={<AdminDebitComptantScreen />} />
            <Route path="/admin/gencod-doublons" element={<AdminGencodDoublonsScreen />} />
<Route
  path="/admin/commerciaux/:nomDossierDBF/:code"
  element={<AdminCommercialDetailScreen />}
/>
        <Route
          path="/admin/inventaire-progression"
          element={<AdminInventaireProgressionScreen />}
        />
        <Route
          path="/admin/fiches-controle"
          element={<AdminFichesControleScreen />}
        />
        <Route path="/admin/bipages" element={<AdminBipagesScreen />} />
        <Route
          path="/admin/inventaire-proforma"
          element={<AdminInventaireProformaScreen />}
        />
        <Route
          path="/admin/recap-zones"
          element={<AdminRecapZonesScreen />}
        />
        <Route path="/admin/reappros" element={<AdminReapprosScreen />} />
        <Route path="/admin/proformas" element={<AdminProformasScreen />} />
        <Route path="/admin/clients" element={<AdminClientsScreen />} />
        <Route path="/admin/clients/:nomDossierDBF" element={<AdminClientsScreen />} />
        <Route path="/admin/clients/:nomDossierDBF/:tiers" element={<AdminClientDetailScreen />} />
        <Route
          path="/admin/fournisseurs"
          element={<AdminFournisseursScreen />}
        />
        <Route
          path="/admin/fournisseurs/:nomDossierDBF"
          element={<AdminFournisseursScreen />}
        />
        <Route
          path="/admin/fournisseurs/:nomDossierDBF/:fournId"
          element={<AdminFournisseurInfosScreen />}
        />
        <Route
          path="/admin/proformas/:nomDossierDBF"
          element={<AdminProformasScreen />}
        />
        <Route
          path="/admin/proformas/:nomDossierDBF/:numfact"
          element={<AdminProformaDetailScreen />}
        />
        <Route path="/admin/factures" element={<AdminFacturesScreen />} />
        <Route
          path="/admin/factures/:nomDossierDBF"
          element={<AdminFacturesScreen />}
        />
        <Route
          path="/admin/factures/:nomDossierDBF/:numfact"
          element={<AdminFactureDetailScreen />}
        />
        <Route
          path="/admin/meilleures-ventes"
          element={<AdminMeilleursVentesScreen />}
        />
        <Route
          path="/admin/articles/:nomDossierDBF/:nart"
          element={<AdminArticleInfosScreen />}
        />
        <Route path="/admin/commandes" element={<AdminCommandesScreen />} />
        <Route
          path="/admin/commandes/:nomDossierDBF"
          element={<AdminCommandesScreen />}
        />
        <Route
          path="/admin/commandes/:nomDossierDBF/:numcde"
          element={<AdminCommandeDetailScreen />}
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Route>,
  ),
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>,
);