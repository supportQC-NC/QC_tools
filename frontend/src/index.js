import React from "react";
import ReactDOM from "react-dom/client";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { Provider } from "react-redux";
import store from "./store";
import "./index.css";
import App from "./App";

import PrivateRoute from "./components/Utils/PrivateRoute";
import ModuleRoute from "./components/Utils/ModuleRoute";
import TeamRoute from "./components/Utils/TeamRoute";
import CommercialRoute from "./components/Utils/CommercialRoute";
import AccueilRoute from "./components/Utils/AccueilRoute";

// L'écran de CONNEXION reste dans le bundle principal : il doit s'afficher
// sans attendre le téléchargement d'un chunk.
import Login from "./screens/LoginScreen/LoginScreen";

// Tous les AUTRES écrans sont chargés À LA DEMANDE (React.lazy, 27/11/2026) :
// importés statiquement, les ~130 écrans partaient dans UN SEUL bundle de
// 4,6 Mo (mapbox, ag-grid, jspdf, xlsx compris) téléchargé en entier avant le
// premier affichage. Chaque écran devient un chunk chargé à sa première
// visite ; le <Suspense> qui affiche l'attente est dans App.js, autour des
// <Outlet />. Un nouvel écran suit le même motif — ne pas réintroduire
// d'import statique ici.
const ForgotPassword = React.lazy(() => import("./screens/ForgotPasswordScreen/ForgotPasswordScreen"));
const ResetPassword = React.lazy(() => import("./screens/ResetPasswordScreen/ResetPasswordScreen"));
const NotFound = React.lazy(() => import("./screens/NotFoundScreen/NotFoundScreen"));
const InstallAppScreen = React.lazy(() => import("./screens/InstallAppScreen"));
const ProfileScreen = React.lazy(() => import("./screens/ProfileScreen/ProfileScreen"));
const AdminUsers = React.lazy(() => import("./screens/admin/AdminUsersScreen"));
const AdminBadgesScreen = React.lazy(() => import("./screens/admin/AdminBadgesScreen"));
const AdminEntreprises = React.lazy(() => import("./screens/admin/AdminEntreprisesScreen"));
const AdminEntrepriseConfigScreen = React.lazy(() => import("./screens/admin/AdminEntrepriseConfigScreen"));
const AdminUserConfigScreen = React.lazy(() => import("./screens/admin/AdminUserConfigScreen"));
const AdminUserCreateScreen = React.lazy(() => import("./screens/admin/AdminUserCreateScreen"));
const AdminArticles = React.lazy(() => import("./screens/admin/AdminArticlesScreen"));
const AdminConcurrents = React.lazy(() => import("./screens/admin/AdminConcurrentsScreen"));
const AdminRelevesScreen = React.lazy(() => import("./screens/admin/AdminRelevesScreen"));
const AdminInventairesScreen = React.lazy(() => import("./screens/admin/AdminInventairesScreen"));
const AdminZonesScreen = React.lazy(() => import("./screens/admin/AdminZonesScreen"));
const AdminInventaireProgressionScreen = React.lazy(() => import("./screens/admin/AdminInventaireProgressionScreen"));
const AdminFichesControleScreen = React.lazy(() => import("./screens/admin/AdminFichesControleScreen"));
const AdminBipagesScreen = React.lazy(() => import("./screens/admin/AdminBipagesScreen"));
const AdminAjoutControleInventaireScreen = React.lazy(() => import("./screens/admin/AdminAjoutControleInventaireScreen"));
const AdminDemandesBipageScreen = React.lazy(() => import("./screens/admin/AdminDemandesBipageScreen"));
const AdminInventaireProformaScreen = React.lazy(() => import("./screens/admin/AdminInventaireProformaScreen"));
const AdminEtiquettesScreen = React.lazy(() => import("./screens/admin/AdminEtiquettesScreen"));
const ChangementPrixScreen = React.lazy(() => import("./screens/admin/ChangementPrixScreen"));
const HistoriquePachatScreen = React.lazy(() => import("./screens/admin/HistoriquePachatScreen"));
const SuiviEntreesScreen = React.lazy(() => import("./screens/admin/SuiviEntreesScreen"));
const ResaEntreesScreen = React.lazy(() => import("./screens/admin/ResaEntreesScreen"));
const RapportTgcScreen = React.lazy(() => import("./screens/admin/RapportTgcScreen"));
const BalancesClientsScreen = React.lazy(() => import("./screens/admin/BalancesClientsScreen"));
const AdminFrequentationScreen = React.lazy(() => import("./screens/admin/AdminFrequentationScreen"));
const CommunicationClientScreen = React.lazy(() => import("./screens/admin/CommunicationClientScreen"));
const AdminEditionPromoScreen = React.lazy(() => import("./screens/admin/AdminEditionPromoScreen"));
const AdminMailingScreen = React.lazy(() => import("./screens/admin/AdminMailingScreen"));
const AssistantIAScreen = React.lazy(() => import("./screens/user/AssistantIAScreen"));
const VeilleScreen = React.lazy(() => import("./screens/user/VeilleScreen"));
const MediathequeScreen = React.lazy(() => import("./screens/user/MediathequeScreen"));
const AdminRecapZonesScreen = React.lazy(() => import("./screens/admin/AdminRecapZonesScreen"));
const AdminSuiviInventaireScreen = React.lazy(() => import("./screens/admin/AdminSuiviInventaireScreen"));
const AdminSuiviBipageScreen = React.lazy(() => import("./screens/admin/AdminSuiviBipageScreen"));
const AdminSuiviDemandesBipageScreen = React.lazy(() => import("./screens/admin/AdminSuiviDemandesBipageScreen"));
const AdminSuiviReapproScreen = React.lazy(() => import("./screens/admin/AdminSuiviReapproScreen"));
const AdminSuiviPreparationScreen = React.lazy(() => import("./screens/admin/AdminSuiviPreparationScreen"));
const AdminAgentsInventaireScreen = React.lazy(() => import("./screens/admin/AdminAgentsInventaireScreen"));
const AdminInventaireDashboardScreen = React.lazy(() => import("./screens/admin/AdminInventaireDashboardScreen"));
const AdminLocalisationInventaireScreen = React.lazy(() => import("./screens/admin/AdminLocalisationInventaireScreen"));
const AdminVerificationPointRougeScreen = React.lazy(() => import("./screens/admin/AdminVerificationPointRougeScreen"));
const AdminInventaireBilansScreen = React.lazy(() => import("./screens/admin/AdminInventaireBilansScreen"));
const AdminZonesRetoucheesScreen = React.lazy(() => import("./screens/admin/AdminZonesRetoucheesScreen"));
const AdminEcartsZonesScreen = React.lazy(() => import("./screens/admin/AdminEcartsZonesScreen"));
const AdminReapprosScreen = React.lazy(() => import("./screens/admin/AdminReapproScreen"));
const AdminReapproMecalacScreen = React.lazy(() => import("./screens/admin/AdminReapproMecalacScreen"));
const AdminArticleInfosScreen = React.lazy(() => import("./screens/admin/AdminArticleInfosScreen"));
const AdminCommandesScreen = React.lazy(() => import("./screens/admin/AdminCommandesScreen"));
const AdminCommandeDetailScreen = React.lazy(() => import("./screens/admin/AdminCommandeDetailsScreen"));
const EnvoiCdeFournisseurScreen = React.lazy(() => import("./screens/admin/EnvoiCdeFournisseurScreen"));
const AdminTopVentesScreen = React.lazy(() => import("./screens/admin/AdminTopVentesScreen"));
const AdminInfobullesScreen = React.lazy(() => import("./screens/admin/AdminInfobullesScreen"));
const AdminSmtpScreen = React.lazy(() => import("./screens/admin/AdminSmtpScreen"));

const InventaireScreen = React.lazy(() => import("./screens/user/UserInventaire"));
const UserReappro = React.lazy(() => import("./screens/user/UserReappro"));
const ReleveScreen = React.lazy(() => import("./screens/user/RelevesScreen"));
const UserControleCommande = React.lazy(() => import("./screens/user/UserControleCommande"));
const AdminMeilleursVentesScreen = React.lazy(() => import("./screens/admin/AdminMeilleursVentesScreen"));
const UserPreparationCommande = React.lazy(() => import("./screens/user/UserPreparationCommande"));
const AdminProformasScreen = React.lazy(() => import("./screens/admin/AdminProformasScreen"));
const AdminProformaDetailScreen = React.lazy(() => import("./screens/admin/AdminProformaDetailsScreen"));
const AdminReservationsScreen = React.lazy(() => import("./screens/admin/AdminReservationsScreen"));
const UserProformasScreen = React.lazy(() => import("./screens/user/UserProformasScreen"));
const AdminFournisseursScreen = React.lazy(() => import("./screens/admin/AdminFournisseursScreen"));
const AdminFournisseurInfosScreen = React.lazy(() => import("./screens/admin/AdminFournisseurInfosScreen"));
const AdminFacturesScreen = React.lazy(() => import("./screens/admin/AdminFacturesScreen"));
const AdminFactureDetailScreen = React.lazy(() => import("./screens/admin/AdminFactureDetailsScreen"));
const AdminClientDetailScreen = React.lazy(() => import("./screens/admin/AdminClientDetailsScreen"));
const AdminClientsScreen = React.lazy(() => import("./screens/admin/AdminClientsScreen"));
const AdminCommerciauxScreen = React.lazy(() => import("./screens/admin/AdminCommerciauxScreen"));
const AdminCommercialDetailScreen = React.lazy(() => import("./screens/admin/AdminCommercialDetailScreen"));
const AdminFilialesScreen = React.lazy(() => import("./screens/admin/AdminFilialesScreen"));
const AdminReapproLocalScreen = React.lazy(() => import("./screens/admin/AdminReapproLocalScreen"));
const AdminDebitComptantScreen = React.lazy(() => import("./screens/admin/AdminDebitComptantScreen"));
const AdminGencodDoublonsScreen = React.lazy(() => import("./screens/admin/AdminGencodDoublonsScreen"));
const AdminDerniereFacturationScreen = React.lazy(() => import("./screens/admin/AdminDerniereFacturationScreen"));
const AdminPerformanceDockScreen = React.lazy(() => import("./screens/admin/AdminPerformanceDockScreen"));
const AdminCollecteursScreen = React.lazy(() => import("./screens/admin/AdminCollecteursScreen"));
const AdminCollecteursMapScreen = React.lazy(() => import("./screens/admin/AdminCollecteursMapScreen"));
const AdminAnalyseCaMatriceScreen = React.lazy(() => import("./screens/admin/AdminAnalyseCaMatriceScreen"));
const AdminAnalyseCaMensuelleScreen = React.lazy(() => import("./screens/admin/AdminAnalyseCaMensuelleScreen"));
const AdminHistoriquePromosScreen = React.lazy(() => import("./screens/admin/AdminHistoriquePromosScreen"));
const AdminStatsCommerciauxScreen = React.lazy(() => import("./screens/admin/AdminStatsCommerciauxScreen"));
const AdminAnalyseStockScreen = React.lazy(() => import("./screens/admin/AdminAnalyseStockScreen"));
const AdminFactureAnalyseScreen = React.lazy(() => import("./screens/admin/AdminFactureAnalyseScreen"));
const AdminProformaAnalyseScreen = React.lazy(() => import("./screens/admin/AdminProformaAnalyseScreen"));
const AdminDocumentsFtpScreen = React.lazy(() => import("./screens/admin/AdminDocumentsFtpScreen"));
const DictionnairesScreen = React.lazy(() => import("./screens/user/DictionnairesScreen"));
const AdminJournalCaisseScreen = React.lazy(() => import("./screens/admin/AdminJournalCaisseScreen"));
const AdminTopArticlesScreen = React.lazy(() => import("./screens/admin/AdminTopArticlesScreen"));
const AdminAnalyseReapproScreen = React.lazy(() => import("./screens/admin/AdminAnalyseReapproScreen"));
const AdminReceptionSuiviScreen = React.lazy(() => import("./screens/admin/AdminReceptionSuiviScreen"));
const AdminExportGisementsScreen = React.lazy(() => import("./screens/admin/AdminExportGisementsScreen"));
const AdminDictionnaireRayonsScreen = React.lazy(() => import("./screens/admin/AdminDictionnaireRayonsScreen"));
const AdminExecutablesScreen = React.lazy(() => import("./screens/admin/AdminExecutablesScreen"));
const AdminExecutableDetailScreen = React.lazy(() => import("./screens/admin/AdminExecutableDetailScreen"));
const AdminEquipesScreen = React.lazy(() => import("./screens/admin/AdminEquipesScreen"));
const AdminEquipeDetailScreen = React.lazy(() => import("./screens/admin/AdminEquipeDetailScreen"));
const AdminTachesScreen = React.lazy(() => import("./screens/admin/AdminTachesScreen"));
const MesTachesScreen = React.lazy(() => import("./screens/user/MesTachesScreen"));
const EspaceEquipeScreen = React.lazy(() => import("./screens/user/EspaceEquipeScreen"));
const MonMenuScreen = React.lazy(() => import("./screens/user/MonMenuScreen"));
const ReceptionManuelleScreen = React.lazy(() => import("./screens/user/ReceptionManuelleScreen"));
const PreparationManuelleScreen = React.lazy(() => import("./screens/user/PreparationManuelleScreen"));
const ListesReapproScreen = React.lazy(() => import("./screens/user/ListesReapproScreen"));
const CommercialDashboardScreen = React.lazy(() => import("./screens/commercial/CommercialDashboardScreen"));
const CommercialPortefeuilleScreen = React.lazy(() => import("./screens/commercial/CommercialPortefeuilleScreen"));
const CommercialClientScreen = React.lazy(() => import("./screens/commercial/CommercialClientScreen"));
const CommercialProformasScreen = React.lazy(() => import("./screens/commercial/CommercialProformasScreen"));
const CommercialReservationsScreen = React.lazy(() => import("./screens/commercial/CommercialReservationsScreen"));
const CommercialSpecialesScreen = React.lazy(() => import("./screens/commercial/CommercialSpecialesScreen"));
const CommercialFacturesScreen = React.lazy(() => import("./screens/commercial/CommercialFacturesScreen"));
const CommercialAlertesScreen = React.lazy(() => import("./screens/commercial/CommercialAlertesScreen"));
const CommercialAnalyseScreen = React.lazy(() => import("./screens/commercial/CommercialAnalyseScreen"));
const CommercialPrimeScreen = React.lazy(() => import("./screens/commercial/CommercialPrimeScreen"));

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />}>
      <Route path="/login" element={<Login />} />
      <Route path="/install" element={<InstallAppScreen />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />

      {/* ===================== Routes utilisateur ===================== */}
      <Route element={<PrivateRoute />}>
        {/* Accueil : tableau de bord général, ou espace commercial si l'utilisateur
            est rattaché à un code vendeur (voir AccueilRoute). */}
        <Route path="/" element={<AccueilRoute />} />
        <Route path="/profile" element={<ProfileScreen />} />
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
        <Route path="/mon-menu" element={<MonMenuScreen />} />
        {/* Tableau de bord unique : l'ancienne route admin y renvoie. */}
        <Route path="/admin" element={<Navigate to="/" replace />} />
      </Route>

      {/* ===================== Espace commercial =====================
          Gaté par le PROFIL commercial (Permission.commercial), pas par un
          module : chaque commercial ne voit que les données de son ou ses
          codes vendeur, société par société (filtrage serveur). */}
      <Route element={<CommercialRoute />}>
        <Route path="/commercial" element={<CommercialDashboardScreen />} />
        <Route
          path="/commercial/clients"
          element={<CommercialPortefeuilleScreen />}
        />
        <Route
          path="/commercial/clients/:dossier/:tiers"
          element={<CommercialClientScreen />}
        />
        <Route
          path="/commercial/proformas"
          element={<CommercialProformasScreen />}
        />
        <Route
          path="/commercial/reservations"
          element={<CommercialReservationsScreen />}
        />
        <Route
          path="/commercial/commandes-speciales"
          element={<CommercialSpecialesScreen />}
        />
        <Route
          path="/commercial/factures"
          element={<CommercialFacturesScreen />}
        />
        <Route
          path="/commercial/analyses"
          element={<CommercialAnalyseScreen />}
        />
        <Route path="/commercial/prime" element={<CommercialPrimeScreen />} />
        <Route
          path="/commercial/alertes"
          element={<CommercialAlertesScreen />}
        />
      </Route>

      {/* ======= Écrans admin : garde par module (admin OU utilisateur
          autorisé ; données filtrées par société côté API) ======= */}

      {/* Communication · Mailing -> module "mailing" (strictement gaté) */}
      <Route element={<ModuleRoute module="mailing" />}>
        <Route path="/mailing" element={<AdminMailingScreen />} />
      </Route>

      {/* Communication · Assistant IA -> module "assistant_ia" (strictement gaté) */}
      <Route element={<ModuleRoute module="assistant_ia" />}>
        <Route path="/assistant-ia" element={<AssistantIAScreen />} />
      </Route>

      {/* Communication · Veille IA hebdomadaire -> module "veille" */}
      <Route element={<ModuleRoute module="veille" />}>
        <Route path="/veille" element={<VeilleScreen />} />
      </Route>

      {/* Communication · Catalogue nouveautés -> module "communication_client" */}
      <Route element={<ModuleRoute module="communication_client" />}>
        <Route path="/communication-client" element={<CommunicationClientScreen />} />
      </Route>

      {/* Communication · Médiathèque (images/HTML pour signatures mail) */}
      <Route element={<ModuleRoute module="mediatheque" />}>
        <Route path="/mediatheque" element={<MediathequeScreen />} />
      </Route>

      {/* Gestion · Changement de prix de vente -> module "changement_prix" */}
      <Route element={<ModuleRoute module="changement_prix" />}>
        <Route path="/changement-prix" element={<ChangementPrixScreen />} />
      </Route>

      {/* Gestion · Contrôle réception manuel (fiches papier) */}
      <Route element={<ModuleRoute module="reception_manuelle" />}>
        <Route path="/reception-manuelle" element={<ReceptionManuelleScreen />} />
      </Route>

      {/* Gestion · Préparation de commande manuelle (fiches papier) */}
      <Route element={<ModuleRoute module="prep_commande_manuelle" />}>
        <Route
          path="/preparation-manuelle"
          element={<PreparationManuelleScreen />}
        />
        {/* Suivi unifié : préparations au collecteur + fiches papier marquées
            « préparées ». Le module manuel suffit à l'ouvrir. */}
        <Route
          path="/admin/suivi-preparation"
          element={<AdminSuiviPreparationScreen />}
        />
      </Route>

      {/* Gestion · Listes de réappro -> module "demande_reappro" */}
      <Route element={<ModuleRoute module="demande_reappro" />}>
        <Route path="/demandes-reappro" element={<ListesReapproScreen />} />
        {/* Suivi unifié : listes préparées au collecteur + réappros libres. */}
        <Route path="/admin/suivi-reappro" element={<AdminSuiviReapproScreen />} />
      </Route>

      {/* Gestion · Historique prix d'achat -> module "historique_pachat" */}
      <Route element={<ModuleRoute module="historique_pachat" />}>
        <Route path="/historique-pachat" element={<HistoriquePachatScreen />} />
      </Route>

      {/* Données · Suivi des entrées -> module "suivi_entrees" */}
      <Route element={<ModuleRoute module="suivi_entrees" />}>
        <Route path="/admin/suivi-entrees" element={<SuiviEntreesScreen />} />
      </Route>

      {/* Données · Entrées sur réservation -> module "resa_entrees" */}
      <Route element={<ModuleRoute module="resa_entrees" />}>
        <Route path="/admin/resa-entrees" element={<ResaEntreesScreen />} />
      </Route>

      {/* Analyse · Rapports TGC -> module "rapport_tgc" */}
      <Route element={<ModuleRoute module="rapport_tgc" />}>
        <Route path="/admin/rapport-tgc" element={<RapportTgcScreen />} />
      </Route>

      {/* Analyse · Balances / clients à bloquer -> module "balances_clients" */}
      <Route element={<ModuleRoute module="balances_clients" />}>
        <Route path="/admin/balances-clients" element={<BalancesClientsScreen />} />
      </Route>

      {/* Analyse · Fréquentation magasin -> module "frequentation_admin" */}
      <Route element={<ModuleRoute module="frequentation_admin" />}>
        <Route path="/admin/frequentation" element={<AdminFrequentationScreen />} />
      </Route>

      {/* Administration · Utilisateurs -> module "users_admin" (ou responsable,
          données scopées à son équipe côté API) */}
      <Route element={<ModuleRoute module="users_admin" roles={["responsable"]} />}>
        <Route path="/admin/users" element={<AdminUsers />} />
        {/* Badges (code-barres des comptes) : même périmètre que la gestion
            des utilisateurs — c'est la liste des mêmes personnes. */}
        <Route path="/admin/badges" element={<AdminBadgesScreen />} />
        {/* Création : page plein écran (le formulaire ne tient plus en modale). */}
        <Route path="/admin/users/nouveau" element={<AdminUserCreateScreen />} />
        <Route
          path="/admin/users/:id"
          element={<AdminUserConfigScreen />}
        />
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
        <Route
          path="/admin/entreprises/:id"
          element={<AdminEntrepriseConfigScreen />}
        />
      </Route>

      {/* Administration · Infobulles menu -> module "infobulles_admin" */}
      <Route element={<ModuleRoute module="infobulles_admin" />}>
        <Route path="/admin/infobulles" element={<AdminInfobullesScreen />} />
      </Route>

      {/* Administration · Paramètres SMTP -> module "smtp_admin" (backend admin-only) */}
      <Route element={<ModuleRoute module="smtp_admin" />}>
        <Route path="/admin/smtp" element={<AdminSmtpScreen />} />
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
        {/* Tableau de bord de l'inventaire en cours : recoupe les stats
            existantes, n'ajoute aucun agrégat serveur. */}
        <Route
          path="/admin/inventaire-dashboard"
          element={<AdminInventaireDashboardScreen />}
        />
        {/* Bilans de clôture : synthèse figée de chaque inventaire + comparaison
            inter-inventaires par zone. */}
        <Route
          path="/admin/inventaire-bilans"
          element={<AdminInventaireBilansScreen />}
        />
        {/* Classement complet des zones retouchées. Pas au menu : on y arrive
            depuis le tableau de bord. */}
        <Route
          path="/admin/zones-retouchees"
          element={<AdminZonesRetoucheesScreen />}
        />
        {/* Classement des écarts de stock. Pas au menu non plus : on y arrive
            depuis le tableau de bord. */}
        <Route
          path="/admin/ecarts-zones"
          element={<AdminEcartsZonesScreen />}
        />
        <Route path="/admin/recap-zones" element={<AdminRecapZonesScreen />} />
        {/* Affichage mural (plein écran, auto-actualisé) de l'inventaire. */}
        <Route
          path="/admin/suivi-inventaire"
          element={<AdminSuiviInventaireScreen />}
        />
        <Route path="/admin/suivi-bipage" element={<AdminSuiviBipageScreen />} />
        <Route
          path="/admin/agents-inventaire"
          element={<AdminAgentsInventaireScreen />}
        />
      </Route>

      {/* Terrain · Localisation inventaire -> module "localisation_inventaire"
          (module À PART ENTIÈRE, distinct d'« inventaire » : il sera aussi
          porté sur l'app mobile). */}
      <Route element={<ModuleRoute module="localisation_inventaire" />}>
        <Route
          path="/admin/localisation-inventaire"
          element={<AdminLocalisationInventaireScreen />}
        />
      </Route>

      {/* Terrain · Vérification point rouge -> module "verification_inventaire"
          (module à part entière ; version collecteur à venir). */}
      <Route element={<ModuleRoute module="verification_inventaire" />}>
        <Route
          path="/admin/verification-point-rouge"
          element={<AdminVerificationPointRougeScreen />}
        />
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

      {/* Données · Bipages (demandes) + Inventaire Zones · Détail des bipages -> module "bipage" */}
      <Route element={<ModuleRoute module="bipage" />}>
        <Route path="/admin/demandes-bipage" element={<AdminDemandesBipageScreen />} />
        {/* Suivi du bipage TERRAIN (demandes envoyées aux collecteurs). Le
            suivi du bipage d'INVENTAIRE est /admin/suivi-bipage, module
            « inventaire » : deux cycles de vie différents. */}
        <Route
          path="/admin/suivi-demandes-bipage"
          element={<AdminSuiviDemandesBipageScreen />}
        />
        <Route path="/admin/bipages" element={<AdminBipagesScreen />} />
        {/* Ajout des bipages OUBLIÉS découverts au contrôle (zone facultative
            → pseudo-zone CONTROLE) : ils rejoignent le Détail des bipages. */}
        <Route
          path="/admin/ajout-controle-inventaire"
          element={<AdminAjoutControleInventaireScreen />}
        />
      </Route>

      {/* Données · Réappros (admin) -> module "reapro" */}
      <Route element={<ModuleRoute module="reapro" />}>
        <Route path="/admin/reappros" element={<AdminReapprosScreen />} />
        {/* Terrain · Réappro Mécalac : descendre au rayon ce qui dort dans un
            entrepôt S2..S5. Même module de permission que le réappro. */}
        <Route
          path="/reappro-mecalac"
          element={<AdminReapproMecalacScreen />}
        />
      </Route>

      {/* Gestion · Envoi Commande Fournisseur -> module "envoi_cde_fournisseur" */}
      <Route element={<ModuleRoute module="envoi_cde_fournisseur" />}>
        <Route
          path="/admin/envoi-cde-fournisseur"
          element={<EnvoiCdeFournisseurScreen />}
        />
      </Route>

      {/* Commerciaux · Top Ventes -> module "commerciaux_outils" */}
      <Route element={<ModuleRoute module="commerciaux_outils" />}>
        <Route path="/admin/top-ventes" element={<AdminTopVentesScreen />} />
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

      {/* Analyse · Dernière facturation -> module "derniere_facturation_admin" */}
      <Route element={<ModuleRoute module="derniere_facturation_admin" />}>
        <Route
          path="/admin/derniere-facturation"
          element={<AdminDerniereFacturationScreen />}
        />
      </Route>

      {/* Analyse · Analyse CA -> module "analyse_ca_admin" */}
      <Route element={<ModuleRoute module="analyse_ca_admin" />}>
        <Route path="/admin/analyse-ca" element={<AdminAnalyseCaMatriceScreen />} />
      </Route>

      {/* Analyse · Analyse CA mensuelle -> module "analyse_ca_mensuelle_admin" */}
      <Route element={<ModuleRoute module="analyse_ca_mensuelle_admin" />}>
        <Route
          path="/admin/analyse-ca-mensuelle"
          element={<AdminAnalyseCaMensuelleScreen />}
        />
      </Route>

      {/* Analyse · Historique promos -> module "historique_promos_admin" */}
      <Route element={<ModuleRoute module="historique_promos_admin" />}>
        <Route
          path="/admin/historique-promos"
          element={<AdminHistoriquePromosScreen />}
        />
      </Route>

      {/* Analyse · Stats commerciaux -> module "stats_commerciaux_admin" */}
      <Route element={<ModuleRoute module="stats_commerciaux_admin" />}>
        <Route
          path="/admin/stats-commerciaux"
          element={<AdminStatsCommerciauxScreen />}
        />
      </Route>

      {/* Analyse · Analyse stock -> module "analyse_stock_admin" */}
      <Route element={<ModuleRoute module="analyse_stock_admin" />}>
        <Route
          path="/admin/analyse-stock"
          element={<AdminAnalyseStockScreen />}
        />
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

      {/* Analyse · Proforma -> module "analyse_proforma_admin" */}
      <Route element={<ModuleRoute module="analyse_proforma_admin" />}>
        <Route
          path="/admin/analyse-proforma"
          element={<AdminProformaAnalyseScreen />}
        />
      </Route>

      {/* Données · Documents FTP -> module "documents_ftp_admin" */}
      <Route element={<ModuleRoute module="documents_ftp_admin" />}>
        <Route
          path="/admin/documents-ftp"
          element={<AdminDocumentsFtpScreen />}
        />
      </Route>

      {/* Annuaires du personnel -> module "dictionnaires" (clé et URL gardées
          telles quelles au renommage du 03/11/2026 : droits déjà accordés).
          Transverse : pas de scoping société (décision client 02/11/2026). */}
      <Route element={<ModuleRoute module="dictionnaires" />}>
        <Route path="/dictionnaires" element={<DictionnairesScreen />} />
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
        <Route
          path="/admin/dictionnaire-rayons"
          element={<AdminDictionnaireRayonsScreen />}
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