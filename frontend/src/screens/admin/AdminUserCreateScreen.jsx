// src/screens/admin/AdminUserCreateScreen.jsx
//
// Création d'un utilisateur en PAGE plein écran (/admin/users/nouveau).
// Même formulaire que la configuration (UserModal en mode `asPage`) : identité
// & rôle, permissions, profil commercial. La modale était devenue illisible dès
// qu'on devait choisir des sociétés, des modules et un code vendeur.

import React from "react";
import { useNavigate } from "react-router-dom";
import UserModal from "../../components/Admin/UserModal";
import "./AdminUserConfigScreen.css";

const AdminUserCreateScreen = () => {
  const navigate = useNavigate();
  return <UserModal asPage onClose={() => navigate("/admin/users")} />;
};

export default AdminUserCreateScreen;
