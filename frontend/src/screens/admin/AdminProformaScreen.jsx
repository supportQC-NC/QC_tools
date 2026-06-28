// src/screens/admin/AdminInventaireProformaScreen.jsx
import React, { useState } from "react";
import {
  HiClipboardList,
  HiOfficeBuilding,
  HiUser,
  HiSearch,
  HiRefresh,
  HiDocumentText,
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetInventaireProformaByClientQuery } from "../../slices/inventaireProformaApiSlice";
import "./AdminInventaireProformaScreen.css";

const AdminInventaireProformaScreen = () => {
  const [nomDossierDBF, setNomDossierDBF] = useState("");
  const [clientInput, setClientInput] = useState("");
  const [client, setClient] = useState(""); // compte validé (déclenche la requête)

  const { data: entreprises } = useGetEntreprisesQuery();

  const {
    data: lignesData,
    isFetching: lignesLoading,
    refetch,
  } = useGetInventaireProformaByClientQuery(
    { nomDossierDBF, client },
    { skip: !nomDossierDBF || !client },
  );

  const groupes = lignesData?.groupes || [];

  const onEntrepriseChange = (e) => {
    setNomDossierDBF(e.target.value);
    setClientInput("");
    setClient("");
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setClient(clientInput.trim());
  };

  return (
    <div className="admin-invproforma">
      <div className="admin-invproforma-header">
        <h1>
          <HiClipboardList /> Inventaire Proforma
        </h1>
        <div className="admin-invproforma-actions">
          <div className="select-with-icon">
            <HiOfficeBuilding />
            <select value={nomDossierDBF} onChange={onEntrepriseChange}>
              <option value="">Sélectionner une entreprise…</option>
              {entreprises?.map((e) => (
                <option key={e._id} value={e.nomDossierDBF}>
                  {e.trigramme} - {e.nomComplet}
                </option>
              ))}
            </select>
          </div>

          <form className="client-form" onSubmit={onSubmit}>
            <div className="select-with-icon">
              <HiUser />
              <input
                type="text"
                placeholder="N° de compte client…"
                value={clientInput}
                onChange={(e) => setClientInput(e.target.value)}
                disabled={!nomDossierDBF}
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={!nomDossierDBF || !clientInput.trim()}
            >
              <HiSearch /> Afficher
            </button>
          </form>

          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!client}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!nomDossierDBF ? (
        <div className="admin-invproforma-placeholder">
          <HiOfficeBuilding />
          <p>Sélectionnez une entreprise pour commencer.</p>
        </div>
      ) : !client ? (
        <div className="admin-invproforma-placeholder">
          <HiUser />
          <p>Saisissez un numéro de compte client puis « Afficher ».</p>
        </div>
      ) : lignesLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : groupes.length === 0 ? (
        <div className="admin-invproforma-placeholder">
          <HiDocumentText />
          <p>Aucune ligne de proforma pour le compte {client}.</p>
        </div>
      ) : (
        <>
          <div className="admin-invproforma-summary">
            Compte <strong>{client}</strong> · {lignesData.totalProformas}{" "}
            proforma{lignesData.totalProformas > 1 ? "s" : ""} ·{" "}
            {lignesData.totalLignes} ligne
            {lignesData.totalLignes > 1 ? "s" : ""}
          </div>

          <div className="admin-invproforma-list">
            {groupes.map((g) => (
              <div key={g.numfact} className="proforma-group">
                <div className="proforma-group-header">
                  <HiDocumentText />
                  <span className="proforma-numfact">Proforma {g.numfact}</span>
                  <span className="proforma-nb">
                    {g.nbLignes} ligne{g.nbLignes > 1 ? "s" : ""}
                  </span>
                </div>

                <table className="admin-table">
                  <thead>
                    <tr>
                      <th className="col-nart">NART</th>
                      <th>Désignation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lignes.map((l, idx) => (
                      <tr
                        key={`${g.numfact}-${l.nl}-${idx}`}
                        className={l.isComment ? "row-comment" : ""}
                      >
                        <td className="mono">{l.nart || "—"}</td>
                        <td className="desig-cell">{l.design}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminInventaireProformaScreen;