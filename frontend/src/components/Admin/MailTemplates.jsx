// src/components/Admin/MailTemplates.jsx
//
// Bibliothèque de MODÈLES d'email, PARTAGÉS par société. Chaque modèle est un
// design (blocs + réglages) réutilisable : « Utiliser » ouvre une nouvelle
// campagne pré-remplie. La VIGNETTE est le rendu HTML réel (endpoint /preview)
// affiché dans un iframe réduit. Scopé société (entrepriseId).
import React, { useEffect, useState } from "react";
import { HiTemplate, HiTrash, HiArrowRight, HiUser } from "react-icons/hi";
import {
  useGetMailTemplatesQuery,
  useDeleteMailTemplateMutation,
  usePreviewCampaignMutation,
} from "../../slices/mailingApiSlice";

// Vignette : demande le rendu HTML du design puis l'affiche dans un iframe mis à
// l'échelle (non interactif). Un rendu serveur = fidèle à l'email réel.
const MailThumbnail = ({ design }) => {
  const [preview] = usePreviewCampaignMutation();
  const [html, setHtml] = useState(null);

  useEffect(() => {
    let alive = true;
    preview(design || { blocks: [] })
      .unwrap()
      .then((r) => alive && setHtml(r?.html || ""))
      .catch(() => alive && setHtml(""));
    return () => {
      alive = false;
    };
  }, [design, preview]);

  return (
    <div className="mtpl-thumb">
      {html ? (
        <iframe
          title="Aperçu du modèle"
          className="mtpl-frame"
          srcDoc={html}
          scrolling="no"
          tabIndex={-1}
        />
      ) : (
        <div className="mtpl-thumb-ph">{html === null ? "Aperçu…" : "Vide"}</div>
      )}
    </div>
  );
};

const MailTemplates = ({ entrepriseId, onUse }) => {
  const { data: templates = [], isLoading } = useGetMailTemplatesQuery(
    entrepriseId,
    { skip: !entrepriseId },
  );
  const [deleteTemplate] = useDeleteMailTemplateMutation();

  const remove = async (t) => {
    if (!window.confirm(`Supprimer le modèle « ${t.nom} » ?`)) return;
    try {
      await deleteTemplate(t._id).unwrap();
    } catch (e) {
      alert(e?.data?.message || "Suppression impossible");
    }
  };

  return (
    <div>
      <div className="ml-head">
        <h1>
          <HiTemplate /> Modèles d'email
        </h1>
      </div>

      {!entrepriseId && (
        <div className="ml-hint">Sélectionnez une société dans l'en-tête.</div>
      )}
      <div className="ml-muted" style={{ marginBottom: 12 }}>
        Enregistrez un design depuis l'éditeur d'une campagne (bouton «
        Enregistrer comme modèle »). Les modèles sont partagés avec tous les
        utilisateurs de la société.
      </div>

      {isLoading ? (
        <div className="ml-empty">Chargement…</div>
      ) : templates.length === 0 ? (
        <div className="ml-empty">
          Aucun modèle enregistré pour cette société pour l'instant.
        </div>
      ) : (
        <div className="mtpl-grid">
          {templates.map((t) => (
            <div key={t._id} className="mtpl-card">
              <MailThumbnail design={t.design} />
              <div className="mtpl-body">
                <div className="mtpl-name">{t.nom}</div>
                <div className="mtpl-desc">
                  {t.description || t.subject || "—"}
                </div>
                <div className="mtpl-meta">
                  <HiUser />
                  {[t.user?.prenom, t.user?.nom].filter(Boolean).join(" ") ||
                    "Auteur inconnu"}
                </div>
              </div>
              <div className="mtpl-actions">
                <button className="mtpl-use" onClick={() => onUse(t)}>
                  Utiliser <HiArrowRight />
                </button>
                <button
                  className="mtpl-del"
                  title="Supprimer"
                  onClick={() => remove(t)}
                >
                  <HiTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MailTemplates;
