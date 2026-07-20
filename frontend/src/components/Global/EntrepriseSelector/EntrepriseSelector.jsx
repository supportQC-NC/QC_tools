// src/components/Global/EntrepriseSelector/EntrepriseSelector.jsx
// Sélecteur de société GLOBAL (monté dans le Header).
// La société choisie est stockée dans entrepriseGlobalSlice et lue par les
// écrans via selectGlobalDossier / selectGlobalEntrepriseId.
// - auto-sélection si l'utilisateur n'a qu'une seule société ;
// - réconciliation : une sélection persistée devenue inaccessible est effacée.
import React, { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { HiOfficeBuilding } from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../../slices/entrepriseApiSlice";
import {
  selectGlobalEntreprise,
  setGlobalEntreprise,
  clearGlobalEntreprise,
} from "../../../slices/entrepriseGlobalSlice";
import "./EntrepriseSelector.css";

const label = (e) =>
  `${e.trigramme ? `${e.trigramme} · ` : ""}${e.nomComplet || e.nom || e.nomDossierDBF}`;

const EntrepriseSelector = () => {
  const dispatch = useDispatch();
  const { data: entreprises } = useGetMyEntreprisesQuery();
  const selected = useSelector(selectGlobalEntreprise);

  // Réconciliation de la sélection avec la liste des sociétés accessibles.
  useEffect(() => {
    if (!entreprises) return;
    if (entreprises.length === 0) {
      if (selected) dispatch(clearGlobalEntreprise());
      return;
    }
    if (entreprises.length === 1) {
      const only = entreprises[0];
      if (!selected || selected._id !== only._id) {
        dispatch(setGlobalEntreprise(only));
      }
      return;
    }
    // Plusieurs sociétés : efface une sélection devenue inaccessible.
    if (selected && !entreprises.some((e) => e._id === selected._id)) {
      dispatch(clearGlobalEntreprise());
    }
  }, [entreprises, selected, dispatch]);

  if (!entreprises || entreprises.length === 0) return null;

  // Une seule société : affichage statique (rien à choisir).
  if (entreprises.length === 1) {
    return (
      <div className="entreprise-selector entreprise-selector--single" title={label(entreprises[0])}>
        <HiOfficeBuilding className="entreprise-selector-icon" />
        <span className="entreprise-selector-name">{label(entreprises[0])}</span>
      </div>
    );
  }

  const onChange = (ev) => {
    const id = ev.target.value;
    const e = entreprises.find((x) => x._id === id);
    dispatch(e ? setGlobalEntreprise(e) : clearGlobalEntreprise());
  };

  return (
    <div className="entreprise-selector">
      <HiOfficeBuilding className="entreprise-selector-icon" />
      <select
        className="entreprise-selector-select"
        value={selected?._id || ""}
        onChange={onChange}
        aria-label="Société active"
      >
        <option value="">— Société —</option>
        {entreprises.map((e) => (
          <option key={e._id} value={e._id}>
            {label(e)}
          </option>
        ))}
      </select>
    </div>
  );
};

export default EntrepriseSelector;
