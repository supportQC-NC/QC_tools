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
import ModuleRoute from "./components/Utils/ModuleRoute";
import TeamRoute from "./components/Utils/TeamRoute";

import Login from "./screens/LoginScreen/LoginScreen";
import ForgotPassword from "./screens/ForgotPasswordScreen/ForgotPasswordScreen";
import ResetPassword from "./screens/ResetPasswordScreen/ResetPasswordScreen";
import NotFound from "./screens/NotFoundScreen/NotFoundScreen";
import InstallAppScreen from "./screens/InstallAppScreen";
import ProfileScreen from "./screens/ProfileScreen/ProfileScreen";
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
import AdminEditionPromoScreen from "./screens/admin/AdminEditionPromoScreen";
import AdminMailingScreen from "./screens/admin/AdminMailingScreen";
import AssistantIAScreen from "./screens/user/AssistantIAScreen";
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
import AdminReservationsScreen from "./screens/admin/AdminReservationsScreen";
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
import AdminCollecteursMapScreen from "./screens/admin/AdminCollecteursMapScreen";
import AdminAnalyseCaScreen from "./screens/admin/AdminAnalyseCaScreen";
import AdminFactureAnalyseScreen from "./screens/admin/AdminFactureAnalyseScreen";
import AdminJournalCaisseScreen from "./screens/admin/AdminJournalCaisseScreen";
import AdminTopArticlesScreen from "./screens/admin/AdminTopArticlesScreen";
import AdminAnalyseReapproScreen from "./screens/admin/AdminAnalyseReapproScreen";
import AdminReceptionSuiviScreen from "./screens/admin/AdminReceptionSuiviScreen";
import AdminExportGisementsScreen from "./screens/admin/AdminExportGisementsScreen";
import AdminExecutablesScreen from "./screens/admin/AdminExecutablesScreen";
import AdminExecutableDetailScreen from "./screens/admin/AdminExecutableDetailScreen";
import AdminEquipesScreen from "./screens/admin/AdminEquipesScreen";
import AdminEquipeDetailScreen from "./screens/admin/AdminEquipeDetailScreen";
import AdminTachesScreen from "./screens/admin/AdminTachesScreen";
import MesTachesScreen from "./screens/user/MesTachesScreen";
import EspaceEquipeScreen from "./screens/user/EspaceEquipeScreen";

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />}>
      <Route path="/login" element={<Login />} />
      <Route path="/install" element={<InstallAppScreen />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />

      {/* ===================== Routes utilisateur ===================== */}
      <Route element={<PrivateRoute />}>
        <Route path="/" element={<UserDashboard />} />
        <Route path="/profile" element={<ProfileScreen />} />
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
        <Route path="/edition-promo" element={<AdminEditionPromoScreen />} />
        <Route path="/mes-taches" element={<MesTachesScreen />} />
        <Route path="/espace-equipe" element={<EspaceEquipeScreen />} />
      </Route>

      {/* ======= Écrans admin : garde par module (admin OU utilisateur
          autorisé ; données filtrées par société côté API) ======= */}

      {/* Administration · Tableau de bord -> module "dashboard_admin" */}
      <Route element={<ModuleRoute module="dashboard_admin" />}>
        <Route path="/admin" element={<AdminDashboard />} />
      </Route>

      {/* Communication · Mailing -> module "mailing" (strictement gaté) */}
      <Route element={<ModuleRoute module="mailing" />}>
        <Route path="/mailing" element={<AdminMailingScreen />} />
      </Route>

      {/* Communication · Assistant IA -> module "assistant_ia" (strictement gaté) */}
      <Route element={<ModuleRoute module="assistant_ia" />}>
        <Route path="/assistant-ia" element={<AssistantIAScreen />} />
      </Route>

      {/* Administration · Utilisateurs -> module "users_admin" (ou responsable,
          données scopées à son équipe côté API) */}
      <Route element={<ModuleRoute module="users_admin" roles={["responsable"]} />}>
        <Route path="/admin/users" element={<AdminUsers />} />
      </Route>

      {/* Administration · Équipes & Tâches -> admins + responsables */}
      <Route element={<TeamRoute />}>
        <Route path="/admin/equipes" element={<AdminEquipesScreen />} />
        <Route path="/admin/equipes/:id" element={<AdminEquipeDetailScreen />} />
        <Route path="/admin/taches" element={<AdminTachesScreen />} />
      </Route>

      {/* Administration · Entreprises -> module "entreprises_admin" */}
      <Route element={<ModuleRoute module="entreprises_admin" />}>
        <Route path="/admin/entreprises" element={<AdminEntreprises />} />
      </Route>

      {/* Données · Articles / Fournisseurs / Meilleures ventes -> "stock" */}
      <Route element={<ModuleRoute module="stock" />}>
        <Route path="/admin/articles" element={<AdminArticles />} />
        <Route
          path="/admin/articles/:nomDossierDBF/:nart"
          element={<AdminArticleInfosScreen />}
        />
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
          path="/admin/meilleures-ventes"
          element={<AdminMeilleursVentesScreen />}
        />
      </Route>

      {/* Données · Clients -> module "client" */}
      <Route element={<ModuleRoute module="client" />}>
        <Route path="/admin/clients" element={<AdminClientsScreen />} />
        <Route
          path="/admin/clients/:nomDossierDBF"
          element={<AdminClientsScreen />}
        />
        <Route
          path="/admin/clients/:nomDossierDBF/:tiers"
          element={<AdminClientDetailScreen />}
        />
      </Route>

      {/* Données · Commandes -> module "commandes" */}
      <Route element={<ModuleRoute module="commandes" />}>
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

      {/* Données · Proformas -> module "proforma" */}
      <Route element={<ModuleRoute module="proforma" />}>
        <Route path="/admin/proformas" element={<AdminProformasScreen />} />
        <Route
          path="/admin/proformas/:nomDossierDBF"
          element={<AdminProformasScreen />}
        />
        <Route
          path="/admin/proformas/:nomDossierDBF/:numfact"
          element={<AdminProformaDetailScreen />}
        />
      </Route>

      {/* Données · Réservations (proformas état <= 2) -> module "proforma".
          Le détail réutilise l'écran proforma (/admin/proformas/:dossier/:numfact). */}
      <Route element={<ModuleRoute module="proforma" />}>
        <Route path="/admin/reservations" element={<AdminReservationsScreen />} />
        <Route
          path="/admin/reservations/:nomDossierDBF"
          element={<AdminReservationsScreen />}
        />
      </Route>

      {/* Données · Factures -> module "facture" */}
      <Route element={<ModuleRoute module="facture" />}>
        <Route path="/admin/factures" element={<AdminFacturesScreen />} />
        <Route
          path="/admin/factures/:nomDossierDBF"
          element={<AdminFacturesScreen />}
        />
        <Route
          path="/admin/factures/:nomDossierDBF/:numfact"
          element={<AdminFactureDetailScreen />}
        />
      </Route>

      {/* Données · Concurrents -> module "concurrents" */}
      <Route element={<ModuleRoute module="concurrents" />}>
        <Route path="/admin/concurrents" element={<AdminConcurrents />} />
      </Route>

      {/* Données · Relevés (admin) -> module "releve" */}
      <Route element={<ModuleRoute module="releve" />}>
        <Route path="/admin/releves" element={<AdminRelevesScreen />} />
      </Route>

      {/* Données · Inventaires (admin) -> module "inventaire" */}
      <Route element={<ModuleRoute module="inventaire" />}>
        <Route path="/admin/inventaires" element={<AdminInventairesScreen />} />
        <Route path="/admin/zones" element={<AdminZonesScreen />} />
        <Route
          path="/admin/inventaire-progression"
          element={<AdminInventaireProgressionScreen />}
        />
        <Route path="/admin/recap-zones" element={<AdminRecapZonesScreen />} />
      </Route>

      {/* Données · Inventaire Proforma -> module "inventaire_proforma_admin" */}
      <Route element={<ModuleRoute module="inventaire_proforma_admin" />}>
        <Route
          path="/admin/inventaire-proforma"
          element={<AdminInventaireProformaScreen />}
        />
      </Route>

      {/* Données · Fiches de contrôle -> module "fiches_controle_admin" */}
      <Route element={<ModuleRoute module="fiches_controle_admin" />}>
        <Route
          path="/admin/fiches-controle"
          element={<AdminFichesControleScreen />}
        />
      </Route>

      {/* Données · Bipages -> module "bipage" */}
      <Route element={<ModuleRoute module="bipage" />}>
        <Route path="/admin/bipages" element={<AdminBipagesScreen />} />
      </Route>

      {/* Données · Réappros (admin) -> module "reapro" */}
      <Route element={<ModuleRoute module="reapro" />}>
        <Route path="/admin/reappros" element={<AdminReapprosScreen />} />
      </Route>

      {/* Analyse · Commerciaux -> module "commerciaux_admin" */}
      <Route element={<ModuleRoute module="commerciaux_admin" />}>
        <Route path="/admin/commerciaux" element={<AdminCommerciauxScreen />} />
        <Route
          path="/admin/commerciaux/:nomDossierDBF/:code"
          element={<AdminCommercialDetailScreen />}
        />
      </Route>

      {/* Analyse · Filiales -> module "filiales_admin" */}
      <Route element={<ModuleRoute module="filiales_admin" />}>
        <Route path="/admin/filiales" element={<AdminFilialesScreen />} />
      </Route>

      {/* Analyse · Reappro Local -> module "reappro_local_admin" */}
      <Route element={<ModuleRoute module="reappro_local_admin" />}>
        <Route
          path="/admin/reappro-local"
          element={<AdminReapproLocalScreen />}
        />
      </Route>

      {/* Analyse · Débit / Comptant -> module "debit_comptant_admin" */}
      <Route element={<ModuleRoute module="debit_comptant_admin" />}>
        <Route
          path="/admin/debit-comptant"
          element={<AdminDebitComptantScreen />}
        />
      </Route>

      {/* Analyse · Doublons GENCODE -> module "gencod_doublons_admin" */}
      <Route element={<ModuleRoute module="gencod_doublons_admin" />}>
        <Route
          path="/admin/gencod-doublons"
          element={<AdminGencodDoublonsScreen />}
        />
      </Route>

      {/* Analyse · Analyse CA -> module "analyse_ca_admin" */}
      <Route element={<ModuleRoute module="analyse_ca_admin" />}>
        <Route path="/admin/analyse-ca" element={<AdminAnalyseCaScreen />} />
      </Route>

      {/* Analyse · Performance Dock -> module "performance_dock_admin" */}
      <Route element={<ModuleRoute module="performance_dock_admin" />}>
        <Route
          path="/admin/performance-dock"
          element={<AdminPerformanceDockScreen />}
        />
      </Route>

      {/* Analyse · Collecteurs -> module "collecteurs_admin" */}
      <Route element={<ModuleRoute module="collecteurs_admin" />}>
        <Route path="/admin/collecteurs" element={<AdminCollecteursScreen />} />
        <Route
          path="/admin/collecteurs-carte"
          element={<AdminCollecteursMapScreen />}
        />
      </Route>

      {/* Analyse · Facturation -> module "facture_analyse_admin" */}
      <Route element={<ModuleRoute module="facture_analyse_admin" />}>
        <Route
          path="/admin/facture-analyse"
          element={<AdminFactureAnalyseScreen />}
        />
      </Route>

      {/* Analyse · Journal de Caisse -> module "journal_caisse_admin" */}
      <Route element={<ModuleRoute module="journal_caisse_admin" />}>
        <Route
          path="/admin/journal-caisse"
          element={<AdminJournalCaisseScreen />}
        />
      </Route>

      {/* Analyse · Top Articles -> module "top_articles_admin" */}
      <Route element={<ModuleRoute module="top_articles_admin" />}>
        <Route path="/admin/top-articles" element={<AdminTopArticlesScreen />} />
      </Route>

      {/* Analyse · Analyse Réappro -> module "analyse_reappro_admin" */}
      <Route element={<ModuleRoute module="analyse_reappro_admin" />}>
        <Route
          path="/admin/analyse-reappro"
          element={<AdminAnalyseReapproScreen />}
        />
      </Route>

      {/* Données · Suivi Réceptions -> module "reception_suivi_admin" */}
      <Route element={<ModuleRoute module="reception_suivi_admin" />}>
        <Route
          path="/admin/suivi-receptions"
          element={<AdminReceptionSuiviScreen />}
        />
      </Route>

      {/* Données · Export Gisements -> module "export_gisements_admin" */}
      <Route element={<ModuleRoute module="export_gisements_admin" />}>
        <Route
          path="/admin/export-gisements"
          element={<AdminExportGisementsScreen />}
        />
      </Route>

      {/* Données · Exécutables -> module "executables_admin" */}
      <Route element={<ModuleRoute module="executables_admin" />}>
        <Route path="/admin/executables" element={<AdminExecutablesScreen />} />
        <Route
          path="/admin/executables/:name"
          element={<AdminExecutableDetailScreen />}
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