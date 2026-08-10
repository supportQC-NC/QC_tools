// src/screens/admin/AdminUserConfigScreen.jsx
//
// Configuration d'un utilisateur en PAGE plein écran (/admin/users/:id).
// La configuration par utilisateur est devenue trop dense pour une modale :
// on réutilise UserModal en mode `asPage`, comme la config entreprise.

import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import UserModal from "../../components/Admin/UserModal";
import "./AdminUserConfigScreen.css";

const AdminUserConfigScreen = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useGetUsersQuery();

  const utilisateurs = Array.isArray(data) ? data : data?.users || [];
  const trouve = utilisateurs.find((u) => String(u._id) === String(id));

  const retour = () => navigate("/admin/users");

  if (isLoading) {
    return <div className="ucp-chargement">Chargement…</div>;
  }
  if (!trouve) {
    return (
      <div className="ucp-chargement">
        Utilisateur introuvable.{" "}
        <button type="button" className="btn-cancel" onClick={retour}>
          ← Retour à la liste
        </button>
      </div>
    );
  }

  return <UserModal asPage user={trouve} onClose={retour} />;
};

export default AdminUserConfigScreen;
