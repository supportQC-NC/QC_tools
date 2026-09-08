// src/components/Admin/ImportComptageZone.jsx
//
// « Comptage sans collecteur » — bloc de l'écran Progression inventaire.
//
// On CHOISIT D'ABORD LA ZONE, puis on importe dessus un fichier Excel ou une
// proforma de l'ERP (décision client du 08/09/2026). Avant, ce bloc vivait dans
// l'écran Détail des bipages et la zone était devinée : dans le nom du fichier
// (« bipage_12_A_1_MAGASIN.xlsx ») et dans l'observation de la proforma. Un
// fichier mal nommé était refusé et la moitié des proformas déclarées « non
// conformes », alors que la liste des zones est là, sous les yeux.
//
// Le mode décide du signe : « comptage » AJOUTE au comptage déjà présent sur la
// zone, « déduction » RETRANCHE (quantités enregistrées en négatif, pour une
// partie du magasin restée ouverte pendant l'inventaire).
//
// Si la zone n'avait jamais été comptée, le serveur coche automatiquement ses
// phases « papillonnage » et « bipage » : sans passage au collecteur, personne
// ne rapportera les coupons correspondants.

import React, { useMemo, useRef, useState } from "react";
import {
  HiUpload,
  HiDownload,
  HiDocumentText,
  HiSearch,
  HiX,
  HiViewGrid,
} from "react-icons/hi";
import {
  useLazyGetProformasBipageQuery,
  useImportProformasBipageMutation,
  useImportExcelBipageMutation,
  getModeleExcelBipageUrl,
} from "../../slices/bipageApiSlice";
import { BASE_URL } from "../../constants";
import "./ImportComptageZone.css";

// Clé d'une zone : le code seul ne suffit pas, il peut exister au magasin ET au
// dock (deux zones distinctes, deux comptages).
const cleZone = (z) => `${z.code}||${z.type || ""}`;

const libelleZone = (z) =>
  `${z.code}${z.libelle ? ` — ${z.libelle}` : ""}${z.type ? ` (${z.type})` : ""}`;

const ImportComptageZone = ({ entrepriseId, zones = [], onMessage }) => {
  const [zoneKey, setZoneKey] = useState("");
  const [mode, setMode] = useState("inventaire");
  const [showProformas, setShowProformas] = useState(false);
  const fileRef = useRef(null);

  const [importExcel, { isLoading: importingExcel }] =
    useImportExcelBipageMutation();

  const zoneChoisie = useMemo(
    () => zones.find((z) => cleZone(z) === zoneKey) || null,
    [zones, zoneKey],
  );

  const deduction = mode === "deduction";
  const pretAImporter = !!zoneChoisie && !!entrepriseId;

  const lancerExcel = async (file) => {
    if (!zoneChoisie) return;
    try {
      const r = await importExcel({
        entrepriseId,
        file,
        mode,
        zoneCode: zoneChoisie.code,
        emplacement: zoneChoisie.type || "",
      }).unwrap();
      onMessage?.(r?.message || "Fichier importé.", "success");
    } catch (err) {
      onMessage?.(err?.data?.message || "Import Excel impossible.", "error");
    }
  };

  return (
    <div className="icz-card">
      <h2>
        <HiViewGrid /> Comptage sans collecteur
      </h2>
      <p className="icz-hint">
        Pour un rayon compté sur papier ou saisi en proforma : choisissez la
        zone, puis importez le comptage. Il s'ajoute à ce qui a déjà été compté
        sur cette zone — ou s'en retranche, selon le mode.
      </p>

      <div className="icz-row">
        <label className="icz-field icz-grow">
          <span>Zone</span>
          <select
            className="icz-select"
            value={zoneKey}
            onChange={(e) => setZoneKey(e.target.value)}
          >
            <option value="">— Choisir une zone —</option>
            {zones.map((z) => (
              <option key={cleZone(z)} value={cleZone(z)}>
                {libelleZone(z)}
              </option>
            ))}
          </select>
        </label>

        <label className="icz-field">
          <span>Mode</span>
          <select
            className="icz-select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            title="Comptage : les quantités s'ajoutent. Déduction : elles sont retranchées (ventes d'une partie du magasin restée ouverte)."
          >
            <option value="inventaire">Comptage (+)</option>
            <option value="deduction">Déduction (−)</option>
          </select>
        </label>
      </div>

      <div className="icz-row icz-actions">
        <button
          className={`btn-primary ${deduction ? "icz-btn-deduction" : ""}`}
          onClick={() => fileRef.current?.click()}
          disabled={!pretAImporter || importingExcel}
          title={
            pretAImporter
              ? "Importer un fichier Excel (colonnes CODE et QUANTITE)"
              : "Choisissez d'abord une zone"
          }
        >
          <HiUpload /> {importingExcel ? "Import…" : "Importer un Excel"}
        </button>

        <button
          className={`btn-primary ${deduction ? "icz-btn-deduction" : ""}`}
          onClick={() => setShowProformas(true)}
          disabled={!pretAImporter}
          title={
            pretAImporter
              ? "Choisir une proforma de l'ERP"
              : "Choisissez d'abord une zone"
          }
        >
          <HiDocumentText /> Depuis une proforma
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // permet de réimporter le même fichier
            if (file) lancerExcel(file);
          }}
        />

        <a
          className="icz-modele"
          href={`${BASE_URL}${getModeleExcelBipageUrl(entrepriseId)}`}
          title="Télécharger le modèle Excel (mode d'emploi dans l'onglet Aide)"
        >
          <HiDownload /> Modèle Excel
        </a>
      </div>

      {zoneChoisie ? (
        <div className={`icz-cible ${deduction ? "icz-cible-deduction" : ""}`}>
          {deduction ? "À retrancher de" : "À ajouter à"} la zone{" "}
          <b>{libelleZone(zoneChoisie)}</b>
          {deduction && (
            <>
              {" "}
              — les quantités seront enregistrées en <b>négatif</b>.
            </>
          )}
        </div>
      ) : (
        <div className="icz-cible icz-cible-vide">
          Aucune zone choisie : l'import est désactivé.
        </div>
      )}

      {showProformas && zoneChoisie && (
        <ProformasModal
          entrepriseId={entrepriseId}
          zone={zoneChoisie}
          mode={mode}
          onClose={() => setShowProformas(false)}
          onDone={(msg) => {
            setShowProformas(false);
            onMessage?.(msg, "success");
          }}
        />
      )}
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────────────
//  MODALE « Depuis une proforma »
//
//  La zone et le mode viennent du bloc parent : la modale ne sert plus qu'à
//  RETROUVER les bons documents (plage de dates + clients) et à les cocher.
//  Toute proforma portant au moins une ligne article est intégrable — son
//  observation n'est plus un critère, juste une information affichée.
// ───────────────────────────────────────────────────────────────────────────

const ProformasModal = ({ entrepriseId, zone, mode, onClose, onDone }) => {
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [clients, setClients] = useState("");
  const [selection, setSelection] = useState([]); // [numfact]
  const [erreur, setErreur] = useState("");

  const [chercher, { data, isFetching }] = useLazyGetProformasBipageQuery();
  const [importer, { isLoading: importing }] =
    useImportProformasBipageMutation();

  const proformas = data?.proformas || [];
  const integrables = proformas.filter((p) => p.eligible);
  const deduction = mode === "deduction";
  const toutCoche =
    integrables.length > 0 &&
    integrables.every((p) => selection.includes(p.numfact));

  const lancerRecherche = async () => {
    setErreur("");
    setSelection([]);
    if (!dateDebut && !dateFin && !clients.trim()) {
      setErreur(
        "Renseignez au moins une plage de dates ou un numéro de client : sans filtre, toute la table des proformas serait balayée.",
      );
      return;
    }
    try {
      await chercher({ entrepriseId, dateDebut, dateFin, clients }).unwrap();
    } catch (e) {
      setErreur(e?.data?.message || "Recherche impossible.");
    }
  };

  const toggle = (numfact) =>
    setSelection((s) =>
      s.includes(numfact) ? s.filter((n) => n !== numfact) : [...s, numfact],
    );

  const valider = async () => {
    setErreur("");
    try {
      const r = await importer({
        entrepriseId,
        zoneCode: zone.code,
        emplacement: zone.type || "",
        mode,
        items: selection.map((numfact) => ({ numfact })),
      }).unwrap();
      onDone(r?.message || "Proformas intégrées.");
    } catch (e) {
      setErreur(e?.data?.message || "Import impossible.");
    }
  };

  return (
    <div className="icz-overlay" onClick={onClose}>
      <div className="icz-modal" onClick={(e) => e.stopPropagation()}>
        <div className="icz-modal-head">
          <h2>
            <HiDocumentText /> Compter la zone {zone.code} depuis une proforma
          </h2>
          <button className="btn-icon" onClick={onClose} title="Fermer">
            <HiX />
          </button>
        </div>

        <div className={`icz-cible ${deduction ? "icz-cible-deduction" : ""}`}>
          Destination : <b>{libelleZone(zone)}</b> —{" "}
          {deduction ? (
            <>
              mode <b>déduction</b>, les quantités seront retranchées du comptage
            </>
          ) : (
            <>
              mode <b>comptage</b>, les quantités s'ajoutent au comptage existant
            </>
          )}
          .
        </div>

        <div className="icz-filtres">
          <label>
            Du
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </label>
          <label>
            au
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
          <label className="icz-grow">
            Client(s)
            <input
              type="text"
              placeholder="9900 ou 9900, 9901…"
              value={clients}
              onChange={(e) => setClients(e.target.value)}
            />
          </label>
          <button
            className="btn-primary"
            onClick={lancerRecherche}
            disabled={isFetching}
          >
            <HiSearch /> {isFetching ? "Recherche…" : "Rechercher"}
          </button>
        </div>

        {erreur && <div className="icz-msg err">{erreur}</div>}

        {data && (
          <div className="icz-resultats">
            <span>
              {data.total} proforma(s) trouvée(s), dont{" "}
              <b>{data.nbEligibles}</b> intégrable(s).
            </span>
          </div>
        )}

        <div className="icz-modal-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={toutCoche}
                    title="Tout cocher"
                    onChange={() =>
                      setSelection(
                        toutCoche ? [] : integrables.map((p) => p.numfact),
                      )
                    }
                  />
                </th>
                <th>N° proforma</th>
                <th>Date</th>
                <th>Client</th>
                <th>Observation</th>
                <th>Vendeur</th>
                <th>Lignes</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr>
                  <td colSpan={7} className="no-data">
                    Choisissez une plage de dates et/ou des clients, puis lancez
                    la recherche.
                  </td>
                </tr>
              ) : proformas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="no-data">
                    Aucune proforma sur cette sélection.
                  </td>
                </tr>
              ) : (
                proformas.map((p) => (
                  <tr key={p.numfact} className={p.eligible ? "" : "icz-row-ko"}>
                    <td>
                      {p.eligible && (
                        <input
                          type="checkbox"
                          checked={selection.includes(p.numfact)}
                          onChange={() => toggle(p.numfact)}
                        />
                      )}
                    </td>
                    <td className="mono">{p.numfact}</td>
                    <td>
                      {p.datfact
                        ? new Date(p.datfact).toLocaleDateString("fr-FR")
                        : "—"}
                    </td>
                    <td className="desig-cell">
                      {p.tiers} {p.nomClient}
                    </td>
                    <td className="desig-cell">
                      {p.observation || "—"}
                      {!p.eligible && p.raison && (
                        <div className="icz-raison">{p.raison}</div>
                      )}
                    </td>
                    <td>
                      {p.agentNom || (p.agentCode ? `Code ${p.agentCode}` : "—")}
                    </td>
                    <td className="num-cell">{p.nbLignes}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="icz-modal-actions">
          <button className="btn-icon" onClick={onClose}>
            Annuler
          </button>
          <button
            className={`btn-primary ${deduction ? "icz-btn-deduction" : ""}`}
            onClick={valider}
            disabled={selection.length === 0 || importing}
          >
            <HiUpload />{" "}
            {importing
              ? "Intégration…"
              : `${deduction ? "Déduire" : "Intégrer"} ${selection.length} proforma(s)`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportComptageZone;
