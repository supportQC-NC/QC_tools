import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import EntrepriseModal from "../../components/Admin/EntrepriseModal";
import "./AdminEntrepriseConfigScreen.css";

// Page de configuration d'une entreprise (édition plein écran) — remplace la
// modale d'édition. Réutilise EntrepriseModal en mode `asPage`.
const AdminEntrepriseConfigScreen = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: entreprises, isLoading } = useGetEntreprisesQuery();
  const found = entreprises?.find((e) => e._id === id);
  const back = () => navigate("/admin/entreprises");

  if (isLoading) {
    return <div className="entreprise-config-state">Chargement…</div>;
  }
  if (!found) {
    return (
      <div className="entreprise-config-state">
        <p>Entreprise introuvable.</p>
        <button type="button" className="btn-cancel" onClick={back}>
          ← Retour à la liste
        </button>
      </div>
    );
  }
  return <EntrepriseModal asPage entreprise={found} onClose={back} />;
};

export default AdminEntrepriseConfigScreen;
