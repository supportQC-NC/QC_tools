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
// Le bloc est REPLIÉ par défaut : il ne sert qu'aux rayons comptés sans
// collecteur, il n'a pas à occuper l'écran de pilotage le reste du temps.
//
// La SÉLECTION DE PROFORMAS (plage de dates + clients) est portée par
// l'inventaire, saisie une seule fois à son initialisation (décision client du
// 09/09/2026) : la fenêtre d'import affiche donc directement la liste, au lieu
// de redemander les mêmes filtres à chaque zone.
//
// Le mode décide du signe : « comptage » AJOUTE au comptage déjà présent sur la
// zone, « déduction » RETRANCHE (quantités enregistrées en négatif, pour une
// partie du magasin restée ouverte pendant l'inventaire).
//
// Si la zone n'avait jamais été comptée, le serveur coche automatiquement ses
// phases « papillonnage » et « bipage » : sans passage au collecteur, personne
// ne rapportera les coupons correspondants.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiUpload,
  HiDownload,
  HiDocumentText,
  HiRefresh,
  HiX,
  HiViewGrid,
  HiChevronDown,
  HiChevronRight,
  HiPencilAlt,
} from "react-icons/hi";
import {
  useLazyGetProformasBipageQuery,
  useImportProformasBipageMutation,
  useImportExcelBipageMutation,
  getModeleExcelBipageUrl,
} from "../../slices/bipageApiSlice";
import { useSetFiltreProformasMutation } from "../../slices/inventaireZoneApiSlice";
import { BASE_URL } from "../../constants";
import "./ImportComptageZone.css";

// Clé d'une zone : le code seul ne suffit pas, il peut exister au magasin ET au
// dock (deux zones distinctes, deux comptages).
const cleZone = (z) => `${z.code}||${z.type || ""}`;

const libelleZone = (z) =>
  `${z.code}${z.libelle ? ` — ${z.libelle}` : ""}${z.type ? ` (${z.type})` : ""}`;

const fmtJour = (v) => (v ? new Date(v).toLocaleDateString("fr-FR") : "");

/** Résumé lisible de la sélection de proformas de l'inventaire. */
export const resumeFiltreProformas = (f) => {
  if (!f) return "";
  const bouts = [];
  if (f.dateDebut && f.dateFin)
    bouts.push(`du ${fmtJour(f.dateDebut)} au ${fmtJour(f.dateFin)}`);
  else if (f.dateDebut) bouts.push(`depuis le ${fmtJour(f.dateDebut)}`);
  else if (f.dateFin) bouts.push(`jusqu'au ${fmtJour(f.dateFin)}`);
  if (f.clients) bouts.push(`client(s) ${f.clients}`);
  return bouts.join(" · ");
};

/** Une sélection vide ferait balayer toute la table des proformas. */
const filtreRenseigne = (f) => !!(f?.dateDebut || f?.dateFin || f?.clients);

const ImportComptageZone = ({
  entrepriseId,
  zones = [],
  filtreProformas,
  onMessage,
}) => {
  const [ouvert, setOuvert] = useState(false);
  const [zoneKey, setZoneKey] = useState("");
  const [mode, setMode] = useState("inventaire");
  const [showProformas, setShowProformas] = useState(false);
  const [editionFiltre, setEditionFiltre] = useState(false);
  const fileRef = useRef(null);

  const [importExcel, { isLoading: importingExcel }] =
    useImportExcelBipageMutation();

  const zoneChoisie = useMemo(
    () => zones.find((z) => cleZone(z) === zoneKey) || null,
    [zones, zoneKey],
  );

  const deduction = mode === "deduction";
  const pretAImporter = !!zoneChoisie && !!entrepriseId;
  const filtreOk = filtreRenseigne(filtreProformas);

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
    <div className={`icz-card ${ouvert ? "icz-ouvert" : "icz-replie"}`}>
      <button
        type="button"
        className="icz-toggle"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
      >
        {ouvert ? <HiChevronDown /> : <HiChevronRight />}
        <HiViewGrid />
        <span className="icz-toggle-titre">Comptage sans collecteur</span>
        <span className="icz-toggle-sous">
          Excel ou proforma, pour un rayon compté sans terminal
        </span>
      </button>

      {ouvert && (
        <div className="icz-corps">
          <p className="icz-hint">
            Pour un rayon compté sur papier ou saisi en proforma : choisissez la
            zone, puis importez le comptage. Il s'ajoute à ce qui a déjà été
            compté sur cette zone — ou s'en retranche, selon le mode.
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

          {/* Sélection de proformas de l'inventaire : rappelée ici, modifiable
              en un clic, mais plus jamais redemandée à chaque import. */}
          <div className="icz-filtre-resume">
            <HiDocumentText />
            {filtreOk ? (
              <span>
                Proformas de l'inventaire : <b>{resumeFiltreProformas(filtreProformas)}</b>
              </span>
            ) : (
              <span className="icz-filtre-vide">
                Aucune sélection de proformas définie pour cet inventaire.
              </span>
            )}
            <button
              type="button"
              className="icz-filtre-modifier"
              onClick={() => setEditionFiltre(true)}
            >
              <HiPencilAlt /> {filtreOk ? "Modifier" : "Définir"}
            </button>
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
        </div>
      )}

      {editionFiltre && (
        <FiltreProformasModal
          entrepriseId={entrepriseId}
          filtre={filtreProformas}
          onClose={() => setEditionFiltre(false)}
          onDone={(msg) => {
            setEditionFiltre(false);
            onMessage?.(msg, "success");
          }}
        />
      )}

      {showProformas && zoneChoisie && (
        <ProformasModal
          entrepriseId={entrepriseId}
          zone={zoneChoisie}
          mode={mode}
          filtre={filtreProformas}
          onClose={() => setShowProformas(false)}
          onModifierFiltre={() => {
            setShowProformas(false);
            setEditionFiltre(true);
          }}
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
//  MODALE « Sélection des proformas de l'inventaire »
//
//  Saisie UNE FOIS (normalement à l'initialisation de l'inventaire) : la plage
//  de dates et les clients ne changent pas d'une zone à l'autre. Sans au moins
//  un critère, la recherche balaierait toute la table proforma de l'ERP.
// ───────────────────────────────────────────────────────────────────────────

export const FiltreProformasModal = ({
  entrepriseId,
  filtre,
  onClose,
  onDone,
}) => {
  const [dateDebut, setDateDebut] = useState(filtre?.dateDebut || "");
  const [dateFin, setDateFin] = useState(filtre?.dateFin || "");
  const [clients, setClients] = useState(filtre?.clients || "");
  const [erreur, setErreur] = useState("");

  const [enregistrer, { isLoading }] = useSetFiltreProformasMutation();

  const valider = async () => {
    setErreur("");
    if (!dateDebut && !dateFin && !clients.trim()) {
      setErreur(
        "Renseignez au moins une plage de dates ou un numéro de client : sans filtre, toute la table des proformas serait balayée.",
      );
      return;
    }
    try {
      await enregistrer({ entrepriseId, dateDebut, dateFin, clients }).unwrap();
      onDone("Sélection des proformas enregistrée pour cet inventaire.");
    } catch (e) {
      setErreur(e?.data?.message || "Enregistrement impossible.");
    }
  };

  return (
    <div className="icz-overlay" onClick={onClose}>
      <div className="icz-modal icz-modal-etroit" onClick={(e) => e.stopPropagation()}>
        <div className="icz-modal-head">
          <h2>
            <HiDocumentText /> Proformas de cet inventaire
          </h2>
          <button className="btn-icon" onClick={onClose} title="Fermer">
            <HiX />
          </button>
        </div>

        <p className="icz-hint">
          Ces critères valent pour <b>tout l'inventaire</b> : ils ne seront plus
          redemandés à chaque import. La fenêtre « Depuis une proforma »
          affichera directement les documents correspondants.
        </p>

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
        </div>

        {erreur && <div className="icz-msg err">{erreur}</div>}

        <div className="icz-modal-actions">
          <button className="btn-icon" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={valider} disabled={isLoading}>
            {isLoading ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────────────
//  MODALE « Depuis une proforma »
//
//  La zone et le mode viennent du bloc parent, la plage de dates et les clients
//  de l'inventaire : la modale n'a plus qu'à AFFICHER les documents et à les
//  cocher. Toute proforma portant au moins une ligne article est intégrable —
//  son observation n'est plus un critère, juste une information affichée.
// ───────────────────────────────────────────────────────────────────────────

const ProformasModal = ({
  entrepriseId,
  zone,
  mode,
  filtre,
  onClose,
  onModifierFiltre,
  onDone,
}) => {
  const [selection, setSelection] = useState([]); // [numfact]
  const [erreur, setErreur] = useState("");

  const [chercher, { data, isFetching }] = useLazyGetProformasBipageQuery();
  const [importer, { isLoading: importing }] =
    useImportProformasBipageMutation();

  const proformas = data?.proformas || [];
  const integrables = proformas.filter((p) => p.eligible);
  const deduction = mode === "deduction";
  const filtreOk = filtreRenseigne(filtre);
  const toutCoche =
    integrables.length > 0 &&
    integrables.every((p) => selection.includes(p.numfact));

  // ⚠️ Dépendances sur les VALEURS, pas sur l'objet `filtre` : l'écran
  // rafraîchit la session toutes les 4 s, et une dépendance sur l'objet
  // relancerait un balayage des proformas à chaque passage.
  const fDebut = filtre?.dateDebut || "";
  const fFin = filtre?.dateFin || "";
  const fClients = filtre?.clients || "";

  const lancerRecherche = React.useCallback(async () => {
    setErreur("");
    setSelection([]);
    try {
      await chercher({
        entrepriseId,
        dateDebut: fDebut,
        dateFin: fFin,
        clients: fClients,
      }).unwrap();
    } catch (e) {
      setErreur(e?.data?.message || "Recherche impossible.");
    }
  }, [chercher, entrepriseId, fDebut, fFin, fClients]);

  // La liste s'affiche dès l'ouverture : les critères sont ceux de
  // l'inventaire, il n'y a plus rien à saisir avant de chercher.
  useEffect(() => {
    if (filtreOk) lancerRecherche();
  }, [filtreOk, lancerRecherche]);

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

        <div className="icz-bandeau-filtre">
          <span>
            {filtreOk ? (
              <>
                Proformas de l'inventaire :{" "}
                <b>{resumeFiltreProformas(filtre)}</b>
              </>
            ) : (
              "Aucune sélection de proformas n'a été définie pour cet inventaire."
            )}
          </span>
          <div className="icz-bandeau-actions">
            <button
              className="btn-icon"
              onClick={lancerRecherche}
              disabled={!filtreOk || isFetching}
              title="Recharger la liste"
            >
              <HiRefresh />
            </button>
            <button className="btn-icon" onClick={onModifierFiltre}>
              <HiPencilAlt /> {filtreOk ? "Modifier" : "Définir"}
            </button>
          </div>
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
              {!filtreOk ? (
                <tr>
                  <td colSpan={7} className="no-data">
                    Définissez d'abord la plage de dates et les clients de cet
                    inventaire : c'est la seule fois où on vous les demande.
                  </td>
                </tr>
              ) : isFetching && !data ? (
                <tr>
                  <td colSpan={7} className="no-data">
                    Recherche des proformas…
                  </td>
                </tr>
              ) : !data ? (
                <tr>
                  <td colSpan={7} className="no-data">
                    Aucune donnée.
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
