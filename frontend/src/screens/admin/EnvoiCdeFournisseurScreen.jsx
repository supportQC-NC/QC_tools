import React, { useState, useMemo, useRef, useEffect } from "react";
import { useSelector } from "react-redux";
import {
  HiMail,
  HiPaperAirplane,
  HiEye,
  HiDocumentText,
  HiUserGroup,
  HiClipboardList,
  HiRefresh,
  HiPlus,
  HiPencil,
  HiTrash,
  HiX,
  HiExclamation,
  HiCheckCircle,
  HiShieldCheck,
  HiDownload,
  HiUpload,
  HiBadgeCheck,
  HiClock,
} from "react-icons/hi";
import { selectGlobalDossier, selectGlobalEntreprise } from "../../slices/entrepriseGlobalSlice";
import {
  useGetCommandesPrepareesQuery,
  useGetCommandeDetailQuery,
  useGetEnvoiParametresQuery,
  useUpdateEnvoiParametresMutation,
  useGetApercuEnvoiQuery,
  useVerifierFournisseursMutation,
  useEnvoyerCommandesMutation,
  useGetFournisseurEmailsQuery,
  useImportReferenceMutation,
  useImportReferenceGlobalMutation,
  useCreateFournisseurEmailMutation,
  useUpdateFournisseurEmailMutation,
  useDeleteFournisseurEmailMutation,
  useImportEmailsExcelMutation,
  useDeleteEmailsBulkMutation,
  useEnvoyerMasseMutation,
  useApercuRelanceMutation,
  useEnvoyerRelanceMutation,
  useApercuDemandeFactureMutation,
  useEnvoyerDemandeFactureMutation,
  useGetListeArQuery,
  useApercuArMutation,
  useConfirmerArMutation,
  useAnnulerArMutation,
  useGetMessagesFournisseurQuery,
  useUpsertMessageFournisseurMutation,
  useGetResponsableCcQuery,
  useUpsertResponsableCcMutation,
  useGetEnvoiHistoriqueQuery,
  useGetApercuPurgeHistoriqueQuery,
  usePurgerHistoriqueMutation,
} from "../../slices/envoiCdeApiSlice";
import { hasModulePermission } from "../../config/menuConfig";
import { ENVOI_CDE_URL } from "../../constants";
import Modal from "../../components/ui/Modal/Modal";
import RichTextEditor from "../../components/ui/RichTextEditor/RichTextEditor";
import "./EnvoiCdeFournisseurScreen.css";

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (v) => {
  if (!v) return "";
  let d = null;
  if (typeof v === "string" && v.length === 8) {
    d = new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
  } else {
    const p = new Date(v);
    if (!isNaN(p.getTime())) d = p;
  }
  if (!d || isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("fr-FR");
};
// Montant + devise de la commande (cmdref.CDVISE) — aucune conversion n'est
// faite nulle part, on affiche la devise telle qu'elle est dans l'ERP.
const fmtMoney = (n, devise = "F") =>
  (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) +
  " " +
  (devise || "F");

// Affiche le champ BATEAU : "OK" en vert, "P/VERIF" en orange, sinon texte brut.
const renderBateau = (b) => {
  const v = (b || "").trim();
  if (!v) return <span className="ecf-recip tag">—</span>;
  const up = v.toUpperCase();
  if (up === "OK") return <span className="ecf-badge ok">OK</span>;
  if (up.includes("VERIF") || up.includes("VÉRIF"))
    return <span className="ecf-badge test">{v}</span>;
  return v;
};

// ════════════════════════════════════════════════════════════════════════════
//  ÉCRAN PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
const EnvoiCdeFournisseurScreen = () => {
  const dossier = useSelector(selectGlobalDossier) || "";
  const entreprise = useSelector(selectGlobalEntreprise);
  const [tab, setTab] = useState("commandes");

  const { data: params } = useGetEnvoiParametresQuery(dossier, { skip: !dossier });
  const [updateParams, { isLoading: savingParams }] =
    useUpdateEnvoiParametresMutation();

  const [editEmails, setEditEmails] = useState(null); // édition des adresses de test

  const toggleTestMode = async () => {
    if (!params) return;
    // Sécurité : confirmation explicite avant de PASSER en mode réel.
    if (params.testMode) {
      const ok = window.confirm(
        "Désactiver le mode test ?\n\nEn mode RÉEL, les emails partiront réellement aux fournisseurs. Confirmez-vous ?",
      );
      if (!ok) return;
    }
    await updateParams({ nomDossierDBF: dossier, testMode: !params.testMode });
  };

  const saveTestEmails = async () => {
    await updateParams({ nomDossierDBF: dossier, testEmails: editEmails });
    setEditEmails(null);
  };

  if (!dossier) {
    return (
      <div className="ecf-wrap">
        <div className="ecf-head">
          <h1>
            <HiMail /> Envoi Commande Fournisseur
          </h1>
        </div>
        <div className="ecf-empty">
          Sélectionnez une société dans l'en-tête pour commencer.
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "commandes", label: "Commandes préparées", icon: HiClipboardList },
    { key: "ar", label: "Accusés de réception", icon: HiBadgeCheck },
    { key: "masse", label: "Message en masse", icon: HiMail },
    { key: "emails", label: "Emails fournisseurs", icon: HiUserGroup },
    { key: "messages", label: "Modèles de message", icon: HiDocumentText },
    { key: "responsable", label: "Responsable (CC)", icon: HiUserGroup },
    { key: "historique", label: "Historique", icon: HiClipboardList },
  ];

  return (
    <div className="ecf-wrap">
      <div className="ecf-head">
        <h1>
          <HiMail /> Envoi Commande Fournisseur
        </h1>
        <div className="ecf-soc">
          Société : <b>{entreprise?.nomComplet || dossier}</b>
        </div>
      </div>

      {params && (
        <div className={`ecf-testbanner ${params.testMode ? "on" : "off"}`}>
          <HiShieldCheck />
          <div style={{ flex: 1 }}>
            {params.testMode ? (
              <span>
                <b>MODE TEST actif.</b> Tous les envois sont redirigés vers les
                adresses de test — aucun email n'atteint les fournisseurs.
              </span>
            ) : (
              <span>
                <b>MODE RÉEL.</b> Les emails partent réellement aux fournisseurs.
              </span>
            )}
            <div style={{ marginTop: 6, fontSize: "0.8rem" }}>
              {editEmails === null ? (
                <>
                  <span className="ecf-recip tag">Adresses de test :</span>{" "}
                  {(params.testEmails || []).join(", ") || "—"}{" "}
                  <button
                    className="ecf-btn"
                    style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                    onClick={() => setEditEmails((params.testEmails || []).join("; "))}
                  >
                    <HiPencil /> Modifier
                  </button>
                </>
              ) : (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="ecf-input"
                    style={{ minWidth: 340 }}
                    value={editEmails}
                    onChange={(e) => setEditEmails(e.target.value)}
                    placeholder="adresses séparées par ;"
                  />
                  <button className="ecf-btn primary" onClick={saveTestEmails} disabled={savingParams}>
                    OK
                  </button>
                  <button className="ecf-btn" onClick={() => setEditEmails(null)}>
                    Annuler
                  </button>
                </span>
              )}
            </div>
          </div>
          <button
            className={`ecf-btn ${params.testMode ? "" : "danger"}`}
            onClick={toggleTestMode}
            disabled={savingParams}
            title={params.testMode ? "Passer en mode réel" : "Revenir en mode test"}
          >
            {params.testMode ? "Passer en mode réel" : "Repasser en mode test"}
          </button>
        </div>
      )}

      <div className="ecf-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`ecf-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <t.icon /> {t.label}
          </button>
        ))}
      </div>

      {tab === "commandes" && <CommandesTab dossier={dossier} params={params} />}
      {tab === "ar" && <ArTab dossier={dossier} params={params} />}
      {tab === "masse" && <MasseTab dossier={dossier} params={params} />}
      {tab === "emails" && <EmailsTab dossier={dossier} />}
      {tab === "messages" && <MessagesTab dossier={dossier} />}
      {tab === "responsable" && <ResponsableTab dossier={dossier} />}
      {tab === "historique" && <HistoriqueTab dossier={dossier} params={params} />}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  ONGLET COMMANDES
// ════════════════════════════════════════════════════════════════════════════
const CommandesTab = ({ dossier, params }) => {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [bateau, setBateau] = useState("");
  const [detailNumcde, setDetailNumcde] = useState(null);
  const [apercuNumcde, setApercuNumcde] = useState(null);
  const [showSend, setShowSend] = useState(false);
  const [problems, setProblems] = useState(null);
  const [result, setResult] = useState(null);

  const { data, isLoading, isFetching, refetch, error } =
    useGetCommandesPrepareesQuery({ nomDossierDBF: dossier, search, bateau });

  const [verifier, { isLoading: verifying }] = useVerifierFournisseursMutation();
  const [envoyer, { isLoading: sending }] = useEnvoyerCommandesMutation();

  const commandes = data?.commandes || [];
  const allSelected =
    commandes.length > 0 && selected.length === commandes.length;

  const toggle = (numcde) =>
    setSelected((s) =>
      s.includes(numcde) ? s.filter((n) => n !== numcde) : [...s, numcde],
    );
  const toggleAll = () =>
    setSelected(allSelected ? [] : commandes.map((c) => c.NUMCDE));

  const handlePrepareEnvoi = async () => {
    setProblems(null);
    setResult(null);
    try {
      const v = await verifier({ nomDossierDBF: dossier, numcdes: selected }).unwrap();
      if (!v.ok) {
        setProblems(v.problemes);
        return;
      }
      setShowSend(true);
    } catch (e) {
      setProblems([{ raison: e?.data?.message || "Erreur de vérification." }]);
    }
  };

  const handleConfirmEnvoi = async () => {
    try {
      const r = await envoyer({ nomDossierDBF: dossier, numcdes: selected }).unwrap();
      setResult(r);
      setShowSend(false);
      setSelected([]);
    } catch (e) {
      setResult({
        nbOk: 0,
        nbErr: selected.length,
        resultats: [{ statut: "erreur", message: e?.data?.message || "Erreur d'envoi." }],
      });
      setShowSend(false);
    }
  };

  const selectedCmd = useMemo(
    () => commandes.filter((c) => selected.includes(c.NUMCDE)),
    [commandes, selected],
  );

  return (
    <div>
      <div className="ecf-toolbar">
        <input
          className="ecf-input"
          placeholder="Rechercher (n° cmd…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="ecf-input"
          value={bateau}
          onChange={(e) => setBateau(e.target.value)}
          title="Filtrer par bateau"
        >
          <option value="">Bateau : tous</option>
          {(data?.bateaux || []).map((b) => (
            <option key={b.value} value={b.value}>
              {b.value === "__vide__" ? "(sans bateau)" : b.value} ({b.count})
            </option>
          ))}
        </select>
        <button className="ecf-btn" onClick={() => refetch()} disabled={isFetching}>
          <HiRefresh /> Rafraîchir
        </button>
        <div className="ecf-spacer" />
        <span className="ecf-soc">
          {data?.totalRecords ?? 0} commande(s){bateau ? " (filtrées)" : ""} · « OK » en tête
        </span>
        <button
          className="ecf-btn primary"
          disabled={selected.length === 0 || verifying}
          onClick={handlePrepareEnvoi}
        >
          <HiPaperAirplane /> Envoyer la sélection ({selected.length})
        </button>
      </div>

      {problems && (
        <div className="ecf-msg err">
          <b>
            <HiExclamation /> Impossible d'envoyer — corrigez d'abord :
          </b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {problems.map((p, i) => (
              <li key={i}>
                {p.numcde ? `Cmd ${p.numcde} — ` : ""}
                {p.raison}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className={`ecf-msg ${result.nbErr ? "err" : "ok"}`}>
          <b>
            <HiCheckCircle /> {result.nbOk} envoyée(s), {result.nbErr} erreur(s).
          </b>
          {result.testMode && " (mode test)"}
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {(result.resultats || []).map((r, i) => (
              <li key={i}>
                Cmd {r.numcde} :{" "}
                {r.statut === "envoye"
                  ? `envoyée à ${(r.destinataires || []).join(", ")}`
                  : `erreur — ${r.message}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="ecf-msg err">Erreur de chargement des commandes.</div>}

      <div className="ecf-tablewrap">
        <table className="ecf-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="ecf-checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
              <th>N° Cmd</th>
              <th>Fourn.</th>
              <th>Nom fournisseur</th>
              <th>Date</th>
              <th>État</th>
              <th>Bateau</th>
              <th className="ecf-right">Lignes</th>
              <th className="ecf-right" title="Σ (quantité × prix d'achat) de chaque ligne">
                Montant total
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : commandes.length === 0 ? (
              <tr>
                <td colSpan={11} className="ecf-empty">
                  Aucune commande préparée (ETAT = 1).
                </td>
              </tr>
            ) : (
              commandes.map((c) => (
                <tr key={c.NUMCDE}>
                  <td>
                    <input
                      type="checkbox"
                      className="ecf-checkbox"
                      checked={selected.includes(c.NUMCDE)}
                      onChange={() => toggle(c.NUMCDE)}
                    />
                  </td>
                  <td>
                    <b>{c.NUMCDE}</b>
                  </td>
                  <td>{c.FOURN}</td>
                  <td className="wrap">{c.NOM}</td>
                  <td>{fmtDate(c.DATCDE)}</td>
                  <td>{c.ETAT_LABEL || c.ETAT}</td>
                  <td>{renderBateau(c.BATEAU)}</td>
                  <td className="ecf-right">{c.NB_LIGNES}</td>
                  <td className="ecf-right">
                    {fmtMoney(c.MONTANT_TOTAL, c.DEVISE)}
                  </td>
                  <td>
                    <button
                      className="ecf-btn"
                      title="Détail"
                      onClick={() => setDetailNumcde(c.NUMCDE)}
                    >
                      <HiDocumentText />
                    </button>{" "}
                    <button
                      className="ecf-btn"
                      title="Aperçu de l'email"
                      onClick={() => setApercuNumcde(c.NUMCDE)}
                    >
                      <HiEye />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailNumcde && (
        <DetailModal
          dossier={dossier}
          numcde={detailNumcde}
          onClose={() => setDetailNumcde(null)}
        />
      )}
      {apercuNumcde && (
        <ApercuModal
          dossier={dossier}
          numcde={apercuNumcde}
          onClose={() => setApercuNumcde(null)}
        />
      )}
      {showSend && (
        <SendModal
          commandes={selectedCmd}
          testInfo={params}
          sending={sending}
          onConfirm={handleConfirmEnvoi}
          onClose={() => setShowSend(false)}
        />
      )}
    </div>
  );
};

// ── Modale détail commande ───────────────────────────────────────────────────
const DetailModal = ({ dossier, numcde, onClose }) => {
  const { data, isLoading } = useGetCommandeDetailQuery({ nomDossierDBF: dossier, numcde });
  return (
    <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal lg">
      <h3>
        <HiDocumentText /> Détail commande {numcde}
        <button className="ecf-btn ecf-spacer" onClick={onClose}>
          <HiX />
        </button>
      </h3>
      {isLoading ? (
        <div className="ecf-empty">Chargement…</div>
      ) : !data ? (
        <div className="ecf-empty">Introuvable.</div>
      ) : (
        <>
          <div className="ecf-recip" style={{ marginBottom: 10 }}>
            <span className="tag">Fournisseur :</span> {data.fourn} — {data.fournNom}
            {" · "}
            <span className="tag">Date :</span> {fmtDate(data.datcde)}
            {" · "}
            <span className="tag">Lignes :</span> {data.nbLignes}
            {" · "}
            <span className="tag">Montant total :</span>{" "}
            <b>{fmtMoney(data.montantTotal, data.devise)}</b>
          </div>
          <div className="ecf-tablewrap">
            <table className="ecf-table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Code</th>
                  <th>Désignation</th>
                  <th>Désign. frn</th>
                  <th>Référence</th>
                  <th>Gencode</th>
                  <th className="ecf-right">Qté</th>
                  <th className="ecf-right">Prix achat</th>
                  <th className="ecf-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {data.lignes.map((l, i) => (
                  <tr key={i}>
                    <td>{l.NL}</td>
                    <td>{l.NART}</td>
                    <td className="wrap">{l.DESIGN}</td>
                    <td className="wrap">{l.DESIFRN}</td>
                    <td>{l.REFER}</td>
                    <td>{l.GENCOD}</td>
                    <td className="ecf-right">{l.QTE}</td>
                    <td className="ecf-right">{fmtMoney(l.PRIX, data.devise)}</td>
                    <td className="ecf-right">
                      {fmtMoney(l.MONTANT_LIGNE, data.devise)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="ecf-right">
                    <b>Montant total</b>
                  </td>
                  <td className="ecf-right">
                    <b>{fmtMoney(data.montantTotal, data.devise)}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
};

// ── Modale aperçu email ──────────────────────────────────────────────────────
const ApercuModal = ({ dossier, numcde, onClose }) => {
  const { data, isLoading, error } = useGetApercuEnvoiQuery({
    nomDossierDBF: dossier,
    numcde,
  });
  return (
    <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal lg">
      <h3>
        <HiEye /> Aperçu de l'email — commande {numcde}
        <button className="ecf-btn ecf-spacer" onClick={onClose}>
          <HiX />
        </button>
      </h3>
      {isLoading ? (
        <div className="ecf-empty">Chargement…</div>
      ) : error ? (
        <div className="ecf-msg err">
          {error?.data?.message || "Impossible de résoudre l'envoi."}
        </div>
      ) : (
        <>
          {data.envoi?.testMode && (
            <div className="ecf-testbanner on" style={{ marginBottom: 10 }}>
              <HiShieldCheck /> Mode test : sera envoyé à {data.envoi.to.join(", ")}
            </div>
          )}
          <div className="ecf-recip" style={{ marginBottom: 8 }}>
            <div>
              <span className="tag">Sujet :</span> {data.sujet}
            </div>
            <div>
              <span className="tag">Destinataire(s) réel(s) :</span>{" "}
              {data.destinatairesReels.join(", ")}
            </div>
            <div>
              <span className="tag">CC réel(s) :</span>{" "}
              {data.ccReels.length ? data.ccReels.join(", ") : "—"}
            </div>
            <div>
              <span className="tag">Langue :</span> {data.langue} ·{" "}
              <span className="tag">Lignes :</span> {data.nbLignes} ·{" "}
              <span className="tag">Montant total :</span>{" "}
              {fmtMoney(data.montantTotal, data.devise)} ·{" "}
              <span className="tag">PJ :</span> Excel + PDF + logo société
            </div>
          </div>
          <div
            className="ecf-preview"
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
        </>
      )}
    </Modal>
  );
};

// ── Modale confirmation envoi ────────────────────────────────────────────────
const SendModal = ({ commandes, testInfo, sending, onConfirm, onClose }) => (
  <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal">
    <h3>
      <HiPaperAirplane /> Confirmer l'envoi
    </h3>
    <div
      className={`ecf-testbanner ${testInfo?.testMode ? "on" : "off"}`}
      style={{ marginBottom: 12 }}
    >
      <HiShieldCheck />
      {testInfo?.testMode ? (
        <span>
          <b>Mode test :</b> envoi redirigé vers {(testInfo.testEmails || []).join(", ")}.
        </span>
      ) : (
        <span>
          <b>Mode réel :</b> les {commandes.length} commande(s) partiront aux
          vrais fournisseurs.
        </span>
      )}
    </div>
    <p>Vous allez envoyer {commandes.length} commande(s) :</p>
    <div className="ecf-tablewrap" style={{ maxHeight: 240 }}>
      <table className="ecf-table">
        <thead>
          <tr>
            <th>N° Cmd</th>
            <th>Fourn.</th>
            <th>Nom</th>
          </tr>
        </thead>
        <tbody>
          {commandes.map((c) => (
            <tr key={c.NUMCDE}>
              <td>{c.NUMCDE}</td>
              <td>{c.FOURN}</td>
              <td className="wrap">{c.NOM}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="ecf-actions">
      <button className="ecf-btn" onClick={onClose} disabled={sending}>
        Annuler
      </button>
      <button className="ecf-btn success" onClick={onConfirm} disabled={sending}>
        <HiPaperAirplane /> {sending ? "Envoi en cours…" : "Confirmer l'envoi"}
      </button>
    </div>
  </Modal>
);

// ════════════════════════════════════════════════════════════════════════════
//  ONGLET ACCUSÉS DE RÉCEPTION (AR)
//
//  Toute commande envoyée est « en attente d'AR » jusqu'à ce que le fournisseur
//  confirme. On coche les commandes confirmées, on vérifie (ou corrige) leur
//  MONTANT TOTAL, et un mail de confirmation part au fournisseur.
//
//  Contrairement à la relance, PAS de regroupement par fournisseur : un AR porte
//  sur une commande et sur son montant.
// ════════════════════════════════════════════════════════════════════════════
const ArTab = ({ dossier, params }) => {
  const [statut, setStatut] = useState("en_attente");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]); // n° de commande
  const [montants, setMontants] = useState({}); // numcde -> montant corrigé (saisi)
  const [showConfirm, setShowConfirm] = useState(false);
  const [showFacture, setShowFacture] = useState(false);
  const [result, setResult] = useState(null);
  const [resultFacture, setResultFacture] = useState(null);

  const { data, isLoading, isFetching, refetch } = useGetListeArQuery({
    nomDossierDBF: dossier,
    statut: statut || undefined,
    search: search || undefined,
    page,
    limit: 50,
  });
  const [annuler, { isLoading: annulation }] = useAnnulerArMutation();

  // Mémoïsé : plusieurs useMemo en dépendent, une nouvelle référence à chaque
  // rendu les ferait tous recalculer.
  const rows = useMemo(() => data?.commandes || [], [data]);
  const totalPages = data ? Math.ceil(data.total / data.limit) || 1 : 1;

  const toggle = (numcde) =>
    setSelected((s) =>
      s.includes(numcde) ? s.filter((n) => n !== numcde) : [...s, numcde],
    );
  const toutCoche = rows.length > 0 && rows.every((r) => selected.includes(r.numcde));
  const toggleAll = () =>
    setSelected(
      toutCoche
        ? selected.filter((n) => !rows.some((r) => r.numcde === n))
        : [...new Set([...selected, ...rows.map((r) => r.numcde)])],
    );

  // Montant affiché : la saisie en cours, sinon celui retenu/calculé côté serveur.
  const montantDe = (r) =>
    montants[r.numcde] !== undefined ? montants[r.numcde] : r.montantTotal ?? 0;

  // Payload de confirmation : n° + montant retenu pour chaque commande cochée.
  const selection = useMemo(
    () =>
      rows
        .filter((r) => selected.includes(r.numcde))
        .map((r) => ({
          numcde: r.numcde,
          montantTotal: Number(montantDe(r)) || 0,
          fournNom: r.fournNom,
          devise: r.devise,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selected, montants],
  );

  // Demande de facture : uniquement les commandes dont l'AR est CONFIRMÉ. Le
  // serveur refuse les autres de toute façon — autant ne pas les proposer.
  const selectionFacture = useMemo(
    () =>
      rows
        .filter((r) => selected.includes(r.numcde) && r.statut === "confirme")
        .map((r) => r.numcde),
    [rows, selected],
  );

  const handleAnnuler = async (numcde) => {
    const ok = window.confirm(
      `Repasser la commande ${numcde} en « AR en attente » ?\n\nAucun mail n'est envoyé.`,
    );
    if (!ok) return;
    setResult(null);
    await annuler({ nomDossierDBF: dossier, numcdes: [numcde] });
  };

  return (
    <div>
      <div className="ecf-toolbar">
        <input
          className="ecf-input"
          placeholder="Rechercher (n° cmd, fournisseur…)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="ecf-input"
          value={statut}
          onChange={(e) => {
            setStatut(e.target.value);
            setPage(1);
          }}
        >
          <option value="en_attente">AR en attente</option>
          <option value="confirme">AR confirmés</option>
          <option value="facture_a_demander">Facture à demander</option>
          <option value="">Toutes les commandes envoyées</option>
        </select>
        <button className="ecf-btn" onClick={() => refetch()} disabled={isFetching}>
          <HiRefresh /> Rafraîchir
        </button>
        <div className="ecf-spacer" />
        <span className="ecf-soc">
          {data?.total ?? 0} commande(s) · {data?.nbAttente ?? 0} en attente d'AR
          {data?.nbFactureADemander
            ? ` · ${data.nbFactureADemander} facture(s) à demander`
            : ""}
        </span>
        <button
          className="ecf-btn primary"
          disabled={selection.length === 0}
          onClick={() => {
            setResult(null);
            setShowConfirm(true);
          }}
        >
          <HiBadgeCheck /> Confirmer l'AR ({selection.length})
        </button>
        <button
          className="ecf-btn"
          disabled={selectionFacture.length === 0}
          title={
            selected.length && !selectionFacture.length
              ? "Aucune commande cochée n'a d'AR confirmé : on ne réclame la facture qu'après la confirmation du fournisseur."
              : "Réclamer la facture des commandes confirmées"
          }
          onClick={() => {
            setResultFacture(null);
            setShowFacture(true);
          }}
        >
          <HiDocumentText /> Demander la facture ({selectionFacture.length})
        </button>
        {selected.length > 0 && (
          <button className="ecf-btn" onClick={() => setSelected([])}>
            <HiX /> Vider
          </button>
        )}
      </div>

      <div className="ecf-hint" style={{ marginBottom: 10 }}>
        Le montant total est calculé ligne à ligne (quantité × prix d'achat). Vous
        pouvez le corriger directement dans le tableau avant de confirmer — par
        exemple si le fournisseur a confirmé un prix révisé ou une rupture. Une
        fois l'AR confirmé, « Demander la facture » réclame la facture au
        fournisseur, en lui rappelant le montant retenu.
      </div>

      {resultFacture && (
        <div className={`ecf-msg ${resultFacture.nbErr ? "err" : "ok"}`}>
          <b>
            <HiCheckCircle /> {resultFacture.nbOk} demande(s) de facture
            envoyée(s), {resultFacture.nbErr} erreur(s).
          </b>
          {resultFacture.testMode && " (mode test)"}
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {(resultFacture.resultats || []).map((r, i) => (
              <li key={i}>
                {r.fournNom || `Fournisseur ${r.fournId ?? "?"}`} —{" "}
                {(r.numcdes || []).join(", ")} :{" "}
                {r.statut === "envoye"
                  ? `demandé à ${(r.destinataires || []).join(", ")}`
                  : `erreur — ${r.message}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className={`ecf-msg ${result.nbErr ? "err" : "ok"}`}>
          <b>
            <HiCheckCircle /> {result.nbConfirmes} AR confirmé(s) — {result.nbOk}{" "}
            mail(s) envoyé(s)
            {result.nbSansMail ? `, ${result.nbSansMail} sans mail` : ""}
            {result.nbErr ? `, ${result.nbErr} erreur(s)` : ""}.
          </b>
          {result.testMode && " (mode test)"}
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {(result.resultats || []).map((r, i) => (
              <li key={i}>
                Cmd {r.numcde} ({r.fournNom || "?"}) —{" "}
                {fmtMoney(r.montantTotal, r.devise)} :{" "}
                {r.statut === "envoye"
                  ? `mail envoyé à ${(r.destinataires || []).join(", ")}`
                  : r.statut === "confirme_sans_mail"
                    ? `confirmé sans mail — ${r.message}`
                    : `erreur — ${r.message}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ecf-tablewrap">
        <table className="ecf-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="ecf-checkbox"
                  checked={toutCoche}
                  onChange={toggleAll}
                />
              </th>
              <th>N° Cmd</th>
              <th>Fourn.</th>
              <th>Nom fournisseur</th>
              <th>Date cmd</th>
              <th>Envoyée le</th>
              <th className="ecf-right">Lignes</th>
              <th className="ecf-right" title="Σ (quantité × prix d'achat) de chaque ligne">
                Montant total
              </th>
              <th>AR</th>
              <th>Facture</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="ecf-empty">
                  {statut === "en_attente"
                    ? "Aucune commande en attente d'accusé de réception."
                    : "Aucune commande."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const saisi = montants[r.numcde] !== undefined;
                const ecart =
                  Math.abs(Number(montantDe(r)) - (r.montantCalcule || 0)) > 0.009;
                return (
                  <tr
                    key={r.numcde}
                    className={selected.includes(r.numcde) ? "selectionnee" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="ecf-checkbox"
                        checked={selected.includes(r.numcde)}
                        onChange={() => toggle(r.numcde)}
                      />
                    </td>
                    <td>
                      <b>{r.numcde}</b>
                      {r.archivee && (
                        <>
                          {" "}
                          <span
                            className="ecf-badge test"
                            title="Commande absente des fichiers ERP (archivée)"
                          >
                            archivée
                          </span>
                        </>
                      )}
                    </td>
                    <td>{r.fournId}</td>
                    <td className="wrap">{r.fournNom}</td>
                    <td>{fmtDate(r.datcde)}</td>
                    <td>{fmtDate(r.dateEnvoi)}</td>
                    <td className="ecf-right">{r.nbLignes || "—"}</td>
                    <td className="ecf-right">
                      <input
                        className="ecf-input ecf-montant"
                        type="number"
                        step="0.01"
                        value={montantDe(r)}
                        onChange={(e) =>
                          setMontants((m) => ({ ...m, [r.numcde]: e.target.value }))
                        }
                        title={`Calculé : ${fmtMoney(r.montantCalcule, r.devise)}`}
                      />{" "}
                      <span className="ecf-recip tag">{r.devise}</span>
                      {(ecart || r.montantCorrige) && (
                        <div className="ecf-hint">
                          calculé : {fmtMoney(r.montantCalcule, r.devise)}
                          {saisi ? " (corrigé)" : ""}
                        </div>
                      )}
                    </td>
                    <td>
                      {r.statut === "confirme" ? (
                        <span
                          className="ecf-badge ok"
                          title={
                            r.confirmePar
                              ? `Par ${`${r.confirmePar.prenom || ""} ${
                                  r.confirmePar.nom || ""
                                }`.trim() || r.confirmePar.email}`
                              : ""
                          }
                        >
                          <HiCheckCircle /> confirmé {fmtDate(r.dateConfirmation)}
                        </span>
                      ) : (
                        <span className="ecf-badge test">
                          <HiClock /> en attente
                        </span>
                      )}
                      {r.statut === "confirme" && !r.mailEnvoye && (
                        <span className="ecf-badge err" title="Aucun mail n'est parti">
                          sans mail
                        </span>
                      )}
                    </td>
                    <td>
                      {r.factureDemandeeLe ? (
                        <span
                          className="ecf-badge ok"
                          title={
                            r.nbDemandesFacture > 1
                              ? `${r.nbDemandesFacture} demandes envoyées`
                              : "Demande de facture envoyée"
                          }
                        >
                          demandée {fmtDate(r.factureDemandeeLe)}
                          {r.nbDemandesFacture > 1 ? ` (×${r.nbDemandesFacture})` : ""}
                        </span>
                      ) : r.statut === "confirme" ? (
                        <span
                          className="ecf-badge test"
                          title="AR confirmé : la facture peut être réclamée"
                        >
                          à demander
                        </span>
                      ) : (
                        <span className="ecf-hint">—</span>
                      )}
                    </td>
                    <td>
                      {r.statut === "confirme" && (
                        <button
                          className="ecf-btn"
                          title="Repasser en attente d'AR"
                          disabled={annulation}
                          onClick={() => handleAnnuler(r.numcde)}
                        >
                          <HiX />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="ecf-toolbar" style={{ marginTop: 10 }}>
        <div className="ecf-spacer" />
        <button className="ecf-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Précédent
        </button>
        <span className="ecf-soc">
          {page} / {totalPages}
        </span>
        <button
          className="ecf-btn"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
        </button>
      </div>

      {showConfirm && (
        <ArModal
          dossier={dossier}
          commandes={selection}
          testInfo={params}
          onClose={() => setShowConfirm(false)}
          onDone={(r) => {
            setResult(r);
            setShowConfirm(false);
            setSelected([]);
            setMontants({});
          }}
        />
      )}

      {showFacture && (
        <FactureModal
          dossier={dossier}
          numcdes={selectionFacture}
          testInfo={params}
          onClose={() => setShowFacture(false)}
          onDone={(r) => {
            setResultFacture(r);
            setShowFacture(false);
            setSelected([]);
          }}
        />
      )}
    </div>
  );
};

// ── Modale de confirmation d'AR : aperçu par commande puis confirmation ──────
const ArModal = ({ dossier, commandes, testInfo, onClose, onDone }) => {
  const [apercu, { isLoading: chargement }] = useApercuArMutation();
  const [confirmer, { isLoading: envoi }] = useConfirmerArMutation();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [envoyerMail, setEnvoyerMail] = useState(true);
  const [ouvert, setOuvert] = useState(null); // numcde dont l'aperçu est déplié

  // Aperçu calculé côté serveur : c'est EXACTEMENT ce qui partira.
  useEffect(() => {
    let annule = false;
    apercu({
      nomDossierDBF: dossier,
      commandes: commandes.map((c) => ({
        numcde: c.numcde,
        montantTotal: c.montantTotal,
      })),
    })
      .unwrap()
      .then((r) => {
        if (!annule) setData(r);
      })
      .catch((e) => {
        if (!annule)
          setErreur(e?.data?.message || "Impossible de préparer la confirmation.");
      });
    return () => {
      annule = true;
    };
  }, [dossier, commandes, apercu]);

  const lignes = data?.commandes || [];
  const valides = lignes.filter((c) => !c.erreur);
  const enErreur = lignes.filter((c) => c.erreur);

  const valider = async () => {
    try {
      const r = await confirmer({
        nomDossierDBF: dossier,
        commandes: commandes.map((c) => ({
          numcde: c.numcde,
          montantTotal: c.montantTotal,
        })),
        envoyerMail,
      }).unwrap();
      onDone(r);
    } catch (e) {
      setErreur(e?.data?.message || "Erreur de confirmation.");
    }
  };

  return (
    <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal lg">
      <h3>
        <HiBadgeCheck /> Confirmer l'AR — {commandes.length} commande(s)
        <button className="ecf-btn ecf-spacer" onClick={onClose}>
          <HiX />
        </button>
      </h3>

      {envoyerMail &&
        (testInfo?.testMode ? (
          <div className="ecf-testbanner on" style={{ marginBottom: 10 }}>
            <HiShieldCheck /> Mode test : les confirmations partiront vers{" "}
            {(testInfo.testEmails || []).join(", ")} — aucun fournisseur ne sera
            contacté.
          </div>
        ) : (
          <div className="ecf-testbanner off" style={{ marginBottom: 10 }}>
            <HiExclamation /> Mode réel : les confirmations partiront réellement aux
            fournisseurs.
          </div>
        ))}

      {erreur && <div className="ecf-msg err">{erreur}</div>}

      {chargement && !data ? (
        <div className="ecf-empty">Préparation des confirmations…</div>
      ) : (
        <>
          {enErreur.length > 0 && (
            <div className="ecf-msg err">
              <b>
                <HiExclamation /> {enErreur.length} commande(s) seront confirmées{" "}
                <u>sans mail</u> :
              </b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {enErreur.map((c, i) => (
                  <li key={i}>
                    {c.numcde} — {c.erreur}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="ecf-check">
            <input
              type="checkbox"
              className="ecf-checkbox"
              checked={envoyerMail}
              onChange={(e) => setEnvoyerMail(e.target.checked)}
            />
            Envoyer le mail de confirmation au fournisseur (sinon l'AR est
            simplement enregistré)
          </label>

          <div className="ecf-relance-liste">
            {valides.map((c) => (
              <div className="ecf-relance-card" key={c.numcde}>
                <div className="ecf-relance-head">
                  <b>
                    Cmd {c.numcde} — {c.fournNom || "(sans nom)"}
                  </b>
                  <span className={`ecf-badge ${c.langue === "A" ? "a" : "f"}`}>
                    {c.langue === "A" ? "Anglais" : "Français"}
                  </span>
                  <span className="ecf-recip tag">
                    Montant : <b>{fmtMoney(c.montantTotal, c.devise)}</b>
                    {c.montantCorrige &&
                      ` (calculé : ${fmtMoney(c.montantCalcule, c.devise)})`}
                  </span>
                  <button
                    className="ecf-btn ecf-spacer"
                    onClick={() => setOuvert(ouvert === c.numcde ? null : c.numcde)}
                  >
                    <HiEye /> {ouvert === c.numcde ? "Masquer" : "Aperçu"}
                  </button>
                </div>
                {envoyerMail && (
                  <div className="ecf-recip">
                    <div>
                      <span className="tag">Objet :</span> {c.envoi?.sujet}
                    </div>
                    <div>
                      <span className="tag">À :</span> {(c.envoi?.to || []).join(", ")}
                    </div>
                    {(c.envoi?.cc || []).length > 0 && (
                      <div>
                        <span className="tag">Copie :</span> {(c.envoi.cc || []).join(", ")}
                      </div>
                    )}
                    {c.envoi?.testMode && (
                      <div>
                        <span className="tag">En réel :</span>{" "}
                        {(c.destinatairesReels || []).join(", ")}
                      </div>
                    )}
                  </div>
                )}
                {ouvert === c.numcde && (
                  <div
                    className="ecf-preview mail"
                    dangerouslySetInnerHTML={{ __html: c.html }}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="ecf-actions">
        <button className="ecf-btn" onClick={onClose}>
          Annuler
        </button>
        <button
          className="ecf-btn success"
          onClick={valider}
          disabled={envoi || lignes.length === 0}
        >
          <HiBadgeCheck />{" "}
          {envoi
            ? "Confirmation…"
            : envoyerMail
              ? `Confirmer et envoyer (${valides.length})`
              : `Confirmer sans mail (${lignes.length})`}
        </button>
      </div>
    </Modal>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  ONGLET MESSAGE EN MASSE (vœux / annonces — texte simple FR/EN)
// ════════════════════════════════════════════════════════════════════════════
const MasseTab = ({ dossier, params }) => {
  const { data: emails = [] } = useGetFournisseurEmailsQuery({ nomDossierDBF: dossier });
  const [envoyer, { isLoading: sending }] = useEnvoyerMasseMutation();

  const [cible, setCible] = useState("francais");
  const [selected, setSelected] = useState([]); // fournIds
  const [search, setSearch] = useState("");
  const [sujetF, setSujetF] = useState("");
  const [messageF, setMessageF] = useState("");
  const [sujetA, setSujetA] = useState("");
  const [messageA, setMessageA] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);

  const avecMail = useMemo(
    () => emails.filter((e) => (e.emails || []).length > 0),
    [emails],
  );
  const nbF = avecMail.filter((e) => e.langue !== "A").length;
  const nbA = avecMail.filter((e) => e.langue === "A").length;

  const selectedDocs = avecMail.filter((e) => selected.includes(e.fournId));
  const selNbF = selectedDocs.filter((e) => e.langue !== "A").length;
  const selNbA = selectedDocs.filter((e) => e.langue === "A").length;

  // Langues réellement concernées par la cible (pour savoir quels champs exiger).
  const besoinF = cible === "francais" || (cible === "selection" && selNbF > 0);
  const besoinA = cible === "anglais" || (cible === "selection" && selNbA > 0);

  const nbCibles =
    cible === "francais" ? nbF : cible === "anglais" ? nbA : selectedDocs.length;

  const filtered = avecMail.filter((e) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      String(e.fournId).includes(s) ||
      (e.fournLbl || "").toLowerCase().includes(s)
    );
  });

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const cocherAffiches = () =>
    setSelected((s) => [...new Set([...s, ...filtered.map((e) => e.fournId)])]);

  const canSend =
    nbCibles > 0 &&
    (!besoinF || (sujetF.trim() && messageF.trim())) &&
    (!besoinA || (sujetA.trim() && messageA.trim()));

  const doSend = async () => {
    try {
      const r = await envoyer({
        nomDossierDBF: dossier,
        cible,
        fournIds: selected,
        sujetF,
        messageF,
        sujetA,
        messageA,
      }).unwrap();
      setResult(r);
      setConfirm(false);
    } catch (e) {
      setResult({ erreur: e?.data?.message || "Erreur d'envoi." });
      setConfirm(false);
    }
  };

  const etapeMsg = cible === "selection" ? 3 : 2;
  const destF = cible === "francais" ? nbF : selNbF;
  const destA = cible === "anglais" ? nbA : selNbA;

  return (
    <div className="ecf-mass">
      <div className="ecf-mass-intro">
        <HiMail />
        <div>
          Envoyez un <b>message groupé</b> (vœux, annonces…) à vos fournisseurs, en{" "}
          <b>texte simple</b> (aucun code/HTML). Chaque fournisseur reçoit le
          message dans <b>sa langue</b> ; le transitaire reste en copie.{" "}
          {params?.testMode
            ? "Mode test actif : rien n'atteint les fournisseurs."
            : "Mode réel : les emails partent aux fournisseurs."}
        </div>
      </div>

      {/* Étape 1 — cible */}
      <div className="ecf-step">
        <div className="ecf-step-head">
          <span className="ecf-step-num">1</span>
          <h4 className="ecf-step-title">À qui envoyer&nbsp;?</h4>
        </div>
        <div className="ecf-choices">
          {[
            { v: "francais", big: nbF, t: "Tous les français", s: "Fournisseurs en langue FR" },
            { v: "anglais", big: nbA, t: "Tous les anglais", s: "Fournisseurs en langue EN" },
            {
              v: "selection",
              big: selectedDocs.length,
              t: "Une sélection",
              s: "Choisir des fournisseurs précis",
            },
          ].map((o) => (
            <div
              key={o.v}
              className={`ecf-choice ${cible === o.v ? "active" : ""}`}
              onClick={() => setCible(o.v)}
            >
              <span className="ecf-choice-big">{o.big}</span>
              <div>
                <div className="ecf-choice-t">
                  {o.t}{" "}
                  {cible === o.v && (
                    <HiCheckCircle style={{ verticalAlign: "-2px", color: "#4ade80" }} />
                  )}
                </div>
                <div className="ecf-choice-s">{o.s}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Étape 2 — sélection de fournisseurs */}
      {cible === "selection" && (
        <div className="ecf-step">
          <div className="ecf-step-head">
            <span className="ecf-step-num">2</span>
            <h4 className="ecf-step-title">Choisir les fournisseurs</h4>
          </div>
          <div className="ecf-toolbar" style={{ marginBottom: 8 }}>
            <input
              className="ecf-input"
              placeholder="Rechercher (code ou nom)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="ecf-btn" onClick={cocherAffiches}>
              Tout cocher (affichés)
            </button>
            <button className="ecf-btn" onClick={() => setSelected([])}>
              Tout décocher
            </button>
            <div className="ecf-spacer" />
            <span className="ecf-soc">
              {selectedDocs.length} choisi(s) · {selNbF} FR / {selNbA} EN
            </span>
          </div>
          <div className="ecf-tablewrap" style={{ maxHeight: 300 }}>
            <table className="ecf-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Code</th>
                  <th>Fournisseur</th>
                  <th>Langue</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr
                    key={e._id}
                    onClick={() => toggle(e.fournId)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="ecf-checkbox"
                        checked={selected.includes(e.fournId)}
                        readOnly
                      />
                    </td>
                    <td>{e.fournId}</td>
                    <td className="wrap">{e.fournLbl}</td>
                    <td>
                      <span className={`ecf-badge ${e.langue === "A" ? "a" : "f"}`}>
                        {e.langue}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Étape 3 — message(s) */}
      <div className="ecf-step">
        <div className="ecf-step-head">
          <span className="ecf-step-num">{etapeMsg}</span>
          <h4 className="ecf-step-title">Votre message</h4>
        </div>
        {!besoinF && !besoinA ? (
          <div className="ecf-choice-s">
            Choisissez d'abord des destinataires à l'étape précédente.
          </div>
        ) : (
          <div className="ecf-compose">
            {besoinF && (
              <div className="ecf-lang">
                <div className="ecf-lang-head fr">
                  🇫🇷 Message français · {destF} destinataire(s)
                </div>
                <div className="ecf-lang-body">
                  <span className="ecf-mini">Objet de l'email</span>
                  <input
                    value={sujetF}
                    onChange={(e) => setSujetF(e.target.value)}
                    placeholder="Ex. Joyeuses fêtes de fin d'année"
                  />
                  <div style={{ height: 10 }} />
                  <span className="ecf-mini">Message (texte simple)</span>
                  <textarea
                    value={messageF}
                    onChange={(e) => setMessageF(e.target.value)}
                    placeholder={"Bonjour,\n\nToute l'équipe vous souhaite…"}
                  />
                  <div className="ecf-charcount">{messageF.length} caractères</div>
                </div>
              </div>
            )}
            {besoinA && (
              <div className="ecf-lang">
                <div className="ecf-lang-head en">
                  🇬🇧 Message anglais · {destA} destinataire(s)
                </div>
                <div className="ecf-lang-body">
                  <span className="ecf-mini">Subject</span>
                  <input
                    value={sujetA}
                    onChange={(e) => setSujetA(e.target.value)}
                    placeholder="E.g. Season's greetings"
                  />
                  <div style={{ height: 10 }} />
                  <span className="ecf-mini">Message (plain text)</span>
                  <textarea
                    value={messageA}
                    onChange={(e) => setMessageA(e.target.value)}
                    placeholder={"Hello,\n\nOur whole team wishes you…"}
                  />
                  <div className="ecf-charcount">{messageA.length} caractères</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className={`ecf-msg ${result.erreur || result.nbErr ? "err" : "ok"}`}>
          {result.erreur ? (
            result.erreur
          ) : result.testMode ? (
            <>
              <b>Mode test :</b> {result.nbOk} message(s) de contrôle envoyé(s) aux
              adresses de test. {result.nbCibles} fournisseur(s) auraient été
              contactés en réel.
            </>
          ) : (
            <>
              <b>Envoi réel :</b> {result.nbOk} envoyé(s), {result.nbErr || 0} erreur(s),{" "}
              {result.nbIgnore || 0} ignoré(s) sur {result.nbCibles} fournisseur(s).
            </>
          )}
        </div>
      )}

      {/* Barre d'action collante */}
      <div className="ecf-massbar">
        <span className="recap">
          {params?.testMode ? (
            <span className="ecf-badge test">MODE TEST</span>
          ) : (
            <span className="ecf-badge err">MODE RÉEL</span>
          )}{" "}
          Cible : <b>{nbCibles}</b> fournisseur(s)
        </span>
        <div className="ecf-spacer" />
        {!canSend && (
          <span className="ecf-choice-s">
            Complétez les destinataires et le(s) message(s).
          </span>
        )}
        <button
          className="ecf-btn primary big"
          disabled={!canSend}
          onClick={() => {
            setResult(null);
            setConfirm(true);
          }}
        >
          <HiPaperAirplane /> Envoyer le message groupé
        </button>
      </div>

      {confirm && (
        <Modal onClose={() => setConfirm(false)} overlayClassName="ecf-overlay" contentClassName="ecf-modal">
          <h3>
            <HiPaperAirplane /> Confirmer l'envoi groupé
          </h3>
          <div
            className={`ecf-testbanner ${params?.testMode ? "on" : "off"}`}
            style={{ marginBottom: 12 }}
          >
            <HiShieldCheck />
            {params?.testMode ? (
              <span>
                <b>Mode test :</b> rien n'atteint les fournisseurs — un mail de
                contrôle par langue part vers {(params.testEmails || []).join(", ")}.
              </span>
            ) : (
              <span>
                <b>Mode réel :</b> le message partira à <b>{nbCibles}</b>{" "}
                fournisseur(s) réel(s).
              </span>
            )}
          </div>
          <p>
            Cible : <b>{nbCibles}</b> fournisseur(s)
            {cible === "selection" ? ` (${selNbF} FR, ${selNbA} EN)` : ""}.
          </p>
          <div className="ecf-actions">
            <button className="ecf-btn" onClick={() => setConfirm(false)} disabled={sending}>
              Annuler
            </button>
            <button className="ecf-btn success" onClick={doSend} disabled={sending}>
              <HiPaperAirplane /> {sending ? "Envoi…" : "Confirmer"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  ONGLET EMAILS FOURNISSEURS (CRUD)
// ════════════════════════════════════════════════════════════════════════════
const EmailsTab = ({ dossier }) => {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // objet ou {} pour création
  const { data: emails = [], isLoading } = useGetFournisseurEmailsQuery({
    nomDossierDBF: dossier,
    search,
  });
  const [createEmail] = useCreateFournisseurEmailMutation();
  const [updateEmail] = useUpdateFournisseurEmailMutation();
  const [deleteEmail] = useDeleteFournisseurEmailMutation();
  const [importer, { isLoading: importing }] = useImportReferenceMutation();
  const [importerGlobal, { isLoading: importingGlobal }] =
    useImportReferenceGlobalMutation();
  const [importerExcel, { isLoading: importingXlsx }] =
    useImportEmailsExcelMutation();
  const [deleteBulk, { isLoading: deleting }] = useDeleteEmailsBulkMutation();
  const { userInfo } = useSelector((s) => s.auth);
  const isAdmin = userInfo?.role === "admin";
  const [msg, setMsg] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const fileRef = useRef(null);

  const allSelected = emails.length > 0 && selectedIds.length === emails.length;
  const toggleId = (id) =>
    setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAllIds = () =>
    setSelectedIds(allSelected ? [] : emails.map((e) => e._id));

  // Télécharge le modèle Excel (fetch + blob, avec cookie d'auth).
  const handleDownloadModele = async () => {
    try {
      const res = await fetch(
        `${ENVOI_CDE_URL}/${dossier}/emails/modele-excel`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Téléchargement impossible.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "modele_import_fournisseurs.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg({ type: "err", text: e.message || "Erreur de téléchargement." });
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ""; // reset pour re-import du même fichier
    if (!file) return;
    try {
      const r = await importerExcel({ nomDossierDBF: dossier, file }).unwrap();
      let text = r.message;
      if (r.erreurs?.length)
        text += ` ⚠️ ${r.erreurs.length} ligne(s) ignorée(s) (ex. ligne ${r.erreurs[0].ligne} : ${r.erreurs[0].raison}).`;
      setMsg({ type: r.erreurs?.length ? "err" : "ok", text });
    } catch (err) {
      setMsg({ type: "err", text: err?.data?.message || "Erreur d'import Excel." });
    }
  };

  const handleDeleteSelection = async () => {
    if (
      !window.confirm(
        `Supprimer les ${selectedIds.length} fournisseur(s) sélectionné(s) ?\n\n⚠️ Action IRRÉVERSIBLE — les emails supprimés ne pourront pas être récupérés.`,
      )
    )
      return;
    try {
      const r = await deleteBulk({ nomDossierDBF: dossier, ids: selectedIds }).unwrap();
      setSelectedIds([]);
      setMsg({ type: "ok", text: r.message });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur de suppression." });
    }
  };

  const handleDeleteAll = async () => {
    if (
      !window.confirm(
        `⚠️ SUPPRIMER TOUS les ${emails.length} fournisseurs de cette société ?\n\nAction IRRÉVERSIBLE. Tapez OK pour confirmer.`,
      )
    )
      return;
    // Double confirmation pour une action aussi destructrice.
    if (
      !window.confirm(
        "Dernière confirmation : cette suppression est DÉFINITIVE et ne peut pas être annulée. Continuer ?",
      )
    )
      return;
    try {
      const r = await deleteBulk({ nomDossierDBF: dossier, all: true }).unwrap();
      setSelectedIds([]);
      setMsg({ type: "ok", text: r.message });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur de suppression." });
    }
  };

  const handleImport = async () => {
    if (
      !window.confirm(
        "Importer / mettre à jour la base fournisseurs de référence (migrée depuis Access) pour CETTE société ?\n\n(Astuce : utilisez « Tout importer » pour toutes les sociétés d'un coup.)",
      )
    )
      return;
    try {
      const r = await importer(dossier).unwrap();
      setMsg({ type: "ok", text: r.message });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur d'import." });
    }
  };

  const handleImportGlobal = async () => {
    if (
      !window.confirm(
        "Importer TOUTES les sociétés (base Access complète : 417 emails) ?\n\nRépartit automatiquement les données vers chaque société. À utiliser une fois en prod.",
      )
    )
      return;
    try {
      const r = await importerGlobal().unwrap();
      const detail = (r.parSociete || [])
        .map((s) => `${s.trigramme}: ${s.emails}`)
        .join(", ");
      setMsg({ type: "ok", text: `${r.message} — ${detail}` });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur d'import global." });
    }
  };

  const handleSave = async (form) => {
    try {
      if (form._id) {
        await updateEmail({ nomDossierDBF: dossier, id: form._id, ...form }).unwrap();
      } else {
        await createEmail({ nomDossierDBF: dossier, ...form }).unwrap();
      }
      setEditing(null);
      setMsg({ type: "ok", text: "Enregistré." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur d'enregistrement." });
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Supprimer le fournisseur ${row.fournId} (${row.fournLbl}) ?`))
      return;
    try {
      await deleteEmail({ nomDossierDBF: dossier, id: row._id }).unwrap();
      setMsg({ type: "ok", text: "Supprimé." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur de suppression." });
    }
  };

  return (
    <div>
      <div className="ecf-toolbar">
        <input
          className="ecf-input"
          placeholder="Rechercher (code ou nom fournisseur)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ecf-spacer" />
        <span className="ecf-soc">{emails.length} fournisseur(s)</span>
        <button className="ecf-btn primary" onClick={() => setEditing({})}>
          <HiPlus /> Ajouter
        </button>
      </div>

      {/* Barre outils import / suppression Excel */}
      <div className="ecf-toolbar" style={{ marginTop: 4 }}>
        <button className="ecf-btn" onClick={handleDownloadModele} title="Télécharger un modèle Excel d'exemple">
          <HiDownload /> Modèle Excel
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          className="ecf-btn"
          onClick={() => fileRef.current?.click()}
          disabled={importingXlsx}
          title="Importer des fournisseurs depuis un fichier Excel"
        >
          <HiUpload /> {importingXlsx ? "Import…" : "Importer un Excel"}
        </button>
        <button
          className="ecf-btn"
          onClick={handleImport}
          disabled={importing}
          title="Importer la base de référence (migrée depuis Access) pour la société courante"
        >
          <HiRefresh /> {importing ? "Import…" : "Base de référence"}
        </button>
        {isAdmin && (
          <button
            className="ecf-btn"
            onClick={handleImportGlobal}
            disabled={importingGlobal}
            title="Importer la base Access complète pour TOUTES les sociétés"
          >
            <HiRefresh /> {importingGlobal ? "Import…" : "Tout importer"}
          </button>
        )}
        <div className="ecf-spacer" />
        <button
          className="ecf-btn danger"
          onClick={handleDeleteSelection}
          disabled={selectedIds.length === 0 || deleting}
          title="Supprimer les fournisseurs cochés"
        >
          <HiTrash /> Supprimer la sélection ({selectedIds.length})
        </button>
        <button
          className="ecf-btn danger"
          onClick={handleDeleteAll}
          disabled={emails.length === 0 || deleting}
          title="Supprimer TOUS les fournisseurs de cette société"
        >
          <HiTrash /> Tout supprimer
        </button>
      </div>

      {msg && <div className={`ecf-msg ${msg.type}`}>{msg.text}</div>}

      <div className="ecf-tablewrap">
        <table className="ecf-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="ecf-checkbox"
                  checked={allSelected}
                  onChange={toggleAllIds}
                  title="Tout sélectionner"
                />
              </th>
              <th>Code</th>
              <th>Libellé</th>
              <th>Langue</th>
              <th>Emails</th>
              <th>Transitaire</th>
              <th>CC</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : emails.length === 0 ? (
              <tr>
                <td colSpan={8} className="ecf-empty">
                  Aucun email fournisseur pour cette société.
                </td>
              </tr>
            ) : (
              emails.map((e) => (
                <tr key={e._id}>
                  <td>
                    <input
                      type="checkbox"
                      className="ecf-checkbox"
                      checked={selectedIds.includes(e._id)}
                      onChange={() => toggleId(e._id)}
                    />
                  </td>
                  <td>
                    <b>{e.fournId}</b>
                  </td>
                  <td className="wrap">{e.fournLbl}</td>
                  <td>
                    <span className={`ecf-badge ${e.langue === "A" ? "a" : "f"}`}>
                      {e.langue}
                    </span>
                  </td>
                  <td className="wrap">{(e.emails || []).join(", ")}</td>
                  <td className="wrap">{(e.emailsTransitaire || []).join(", ")}</td>
                  <td className="wrap">{(e.emailsCC || []).join(", ")}</td>
                  <td>
                    <button className="ecf-btn" onClick={() => setEditing(e)}>
                      <HiPencil />
                    </button>{" "}
                    <button className="ecf-btn danger" onClick={() => handleDelete(e)}>
                      <HiTrash />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EmailModal
          initial={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

const EmailModal = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState({
    _id: initial._id,
    fournId: initial.fournId ?? "",
    fournLbl: initial.fournLbl ?? "",
    langue: initial.langue ?? "F",
    emails: (initial.emails || []).join("; "),
    emailsTransitaire: (initial.emailsTransitaire || []).join("; "),
    emailsCC: (initial.emailsCC || []).join("; "),
    actif: initial.actif !== false,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal">
      <h3>
        <HiUserGroup /> {form._id ? "Modifier" : "Ajouter"} un fournisseur
      </h3>
      <div className="ecf-field">
        <label>Code fournisseur (FOURN)</label>
        <input
          type="number"
          value={form.fournId}
          disabled={!!form._id}
          onChange={(e) => set("fournId", e.target.value)}
        />
      </div>
      <div className="ecf-field">
        <label>Libellé</label>
        <input value={form.fournLbl} onChange={(e) => set("fournLbl", e.target.value)} />
      </div>
      <div className="ecf-field">
        <label>Langue du message</label>
        <select value={form.langue} onChange={(e) => set("langue", e.target.value)}>
          <option value="F">Français (F)</option>
          <option value="A">Anglais (A)</option>
        </select>
      </div>
      <div className="ecf-field">
        <label>Emails fournisseur</label>
        <input value={form.emails} onChange={(e) => set("emails", e.target.value)} />
        <div className="ecf-hint">Séparez plusieurs adresses par « ; »</div>
      </div>
      <div className="ecf-field">
        <label>Emails transitaire (en copie)</label>
        <input
          value={form.emailsTransitaire}
          onChange={(e) => set("emailsTransitaire", e.target.value)}
        />
      </div>
      <div className="ecf-field">
        <label>Emails CC supplémentaires</label>
        <input value={form.emailsCC} onChange={(e) => set("emailsCC", e.target.value)} />
      </div>
      <div className="ecf-actions">
        <button className="ecf-btn" onClick={onClose}>
          Annuler
        </button>
        <button
          className="ecf-btn primary"
          onClick={() => onSave(form)}
          disabled={form.fournId === "" || form.fournId === null}
        >
          Enregistrer
        </button>
      </div>
    </Modal>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  ONGLET MODÈLES DE MESSAGE
//
//  Deux axes : le TYPE de mail (envoi de commande / relance) et la LANGUE du
//  fournisseur. Chaque fournisseur reçoit automatiquement le modèle de SA
//  langue (champ « Langue » de sa fiche, onglet Emails fournisseurs).
//
//  La saisie se fait dans un éditeur visuel : aucune connaissance du HTML
//  n'est nécessaire (un mode « code » reste dispo pour les habitués).
// ════════════════════════════════════════════════════════════════════════════
const TYPES_MESSAGE = [
  {
    key: "commande",
    label: "Envoi de commande",
    aide:
      "Mail envoyé avec la commande préparée (onglet « Commandes préparées »). " +
      "Son objet est calculé automatiquement : nom de la société + n° de commande.",
  },
  {
    key: "relance",
    label: "Relance",
    aide:
      "Mail envoyé depuis l'onglet « Historique » quand on relance une ou " +
      "plusieurs commandes déjà envoyées. Objet et corps sont libres.",
  },
  {
    key: "ar",
    label: "Confirmation d'AR",
    aide:
      "Mail envoyé depuis l'onglet « Accusés de réception » quand le " +
      "fournisseur a confirmé la commande. Objet et corps sont libres, et le " +
      "champ {{montant_total}} reprend le montant retenu à la confirmation.",
  },
  {
    key: "facture",
    label: "Demande de facture",
    aide:
      "Mail envoyé depuis l'onglet « Accusés de réception », APRÈS la " +
      "confirmation du fournisseur, pour lui réclamer la facture. Comme la " +
      "relance, les commandes d'un même fournisseur sont regroupées dans un " +
      "seul mail, avec le montant confirmé.",
  },
];

// Remplace les {{champs}} par leur exemple, pour l'aperçu du mail final.
const remplacerVariables = (html, variables) =>
  String(html || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, cle) => {
    const v = variables.find((x) => x.cle === String(cle).toLowerCase());
    return v ? v.exemple : m;
  });

const MessagesTab = ({ dossier }) => {
  const { data } = useGetMessagesFournisseurQuery(dossier);
  const messages = data?.messages || [];
  const defauts = data?.defauts || {};
  const [upsert, { isLoading }] = useUpsertMessageFournisseurMutation();

  const [type, setType] = useState("commande");
  const [langue, setLangue] = useState("F");
  // Brouillon local : null tant que rien n'a été modifié (on affiche alors la
  // valeur enregistrée, ou le modèle par défaut).
  const [brouillon, setBrouillon] = useState(null);
  const [msg, setMsg] = useState(null);

  const current = useMemo(
    () =>
      messages.find(
        (m) => (m.type || "commande") === type && m.langue === langue,
      ),
    [messages, type, langue],
  );
  const hasOwn = !!current;

  const defaut = useMemo(() => {
    if (type === "relance" || type === "ar" || type === "facture")
      return defauts[type]?.[langue] || { message: "", sujet: "" };
    return { message: defauts.commande?.[langue] || "", sujet: "" };
  }, [defauts, type, langue]);

  // Champs insérables : propres à chaque type de mail (l'objet d'une commande
  // est calculé, il n'a donc aucune variable).
  const variables = useMemo(() => {
    if (type === "relance") return data?.variablesRelance || [];
    if (type === "ar") return data?.variablesAr || [];
    if (type === "facture") return data?.variablesFacture || [];
    return [];
  }, [data, type]);

  const valeur = brouillon || {
    message: current?.message || defaut.message,
    sujet: current?.sujet || defaut.sujet,
  };

  // Changer de type/langue repart de la valeur enregistrée correspondante.
  const changer = (patch) => {
    setBrouillon(null);
    setMsg(null);
    if (patch.type !== undefined) setType(patch.type);
    if (patch.langue !== undefined) setLangue(patch.langue);
  };

  const majBrouillon = (patch) => setBrouillon({ ...valeur, ...patch });

  const handleSave = async () => {
    try {
      await upsert({
        nomDossierDBF: dossier,
        type,
        langue,
        message: valeur.message,
        sujet: valeur.sujet,
      }).unwrap();
      setMsg({ type: "ok", text: "Modèle enregistré." });
      setBrouillon(null);
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur." });
    }
  };

  const typeInfo = TYPES_MESSAGE.find((t) => t.key === type);

  return (
    <div>
      <div className="ecf-langtabs">
        {TYPES_MESSAGE.map((t) => (
          <button
            key={t.key}
            className={`ecf-btn ${type === t.key ? "primary" : ""}`}
            onClick={() => changer({ type: t.key })}
          >
            {t.label}
          </button>
        ))}
        <span className="ecf-sepv" />
        {["F", "A"].map((l) => (
          <button
            key={l}
            className={`ecf-btn ${langue === l ? "primary" : ""}`}
            onClick={() => changer({ langue: l })}
          >
            {l === "F" ? "Français" : "Anglais"}
          </button>
        ))}
      </div>

      <div className="ecf-hint" style={{ marginBottom: 10 }}>
        {typeInfo?.aide}
      </div>

      {msg && <div className={`ecf-msg ${msg.type}`}>{msg.text}</div>}
      {!hasOwn && (
        <div
          className="ecf-msg"
          style={{
            background: "rgba(234,179,8,0.12)",
            color: "#eab308",
            border: "1px solid rgba(234,179,8,0.4)",
          }}
        >
          Cette société n'a pas encore de modèle « {typeInfo?.label} /{" "}
          {langue === "F" ? "Français" : "Anglais"} » — le modèle par défaut est
          pré-rempli ci-dessous. Modifiez-le puis enregistrez pour le personnaliser.
        </div>
      )}

      {type !== "commande" && (
        <div className="ecf-field">
          <label>Objet du mail</label>
          <input
            value={valeur.sujet}
            onChange={(e) => majBrouillon({ sujet: e.target.value })}
            placeholder={
              type === "ar"
                ? "Confirmation AR - commande {{commande}} - {{montant_total}}"
                : "Relance - commande(s) {{commandes}}"
            }
          />
          <div className="ecf-hint">
            Les champs entre accolades sont remplacés à l'envoi. Disponibles :{" "}
            {variables.map((v) => `{{${v.cle}}}`).join(", ")}.
          </div>
        </div>
      )}

      <div className="ecf-field">
        <label>Corps du message</label>
        <RichTextEditor
          value={valeur.message}
          onChange={(html) => majBrouillon({ message: html })}
          variables={variables}
          minHeight={320}
          placeholder="Rédigez votre message comme dans un traitement de texte…"
        />
        <div className="ecf-hint">
          Sélectionnez du texte puis utilisez la barre d'outils pour le mettre en
          forme. La signature de la société
          {type === "relance" && " et le tableau récapitulatif des commandes"}
          {type === "ar" &&
            " et le tableau récapitulatif de la commande (avec son montant total)"}
          {type === "facture" &&
            " et le tableau des commandes à facturer (avec le montant confirmé)"}{" "}
          sont ajoutés automatiquement à l'envoi.
        </div>
      </div>

      <div className="ecf-field">
        <label>Aperçu du mail reçu par le fournisseur</label>
        <div
          className="ecf-preview mail"
          dangerouslySetInnerHTML={{
            __html: remplacerVariables(valeur.message, variables),
          }}
        />
        <div className="ecf-hint">
          Les champs automatiques sont affichés ici avec des valeurs d'exemple.
        </div>
      </div>

      <div className="ecf-actions">
        <button className="ecf-btn primary" onClick={handleSave} disabled={isLoading}>
          Enregistrer le modèle
        </button>
        {brouillon && (
          <button className="ecf-btn" onClick={() => setBrouillon(null)}>
            Annuler les modifications
          </button>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  ONGLET RESPONSABLE / CC
// ════════════════════════════════════════════════════════════════════════════
const ResponsableTab = ({ dossier }) => {
  const { data } = useGetResponsableCcQuery(dossier);
  const [upsert, { isLoading }] = useUpsertResponsableCcMutation();
  const [nom, setNom] = useState(null);
  const [emails, setEmails] = useState(null);
  const [msg, setMsg] = useState(null);

  const nomVal = nom === null ? data?.nom || "" : nom;
  const emailsVal =
    emails === null ? (data?.emails || []).join("; ") : emails;

  const handleSave = async () => {
    try {
      await upsert({ nomDossierDBF: dossier, nom: nomVal, emails: emailsVal }).unwrap();
      setMsg({ type: "ok", text: "Enregistré." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur." });
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      {msg && <div className={`ecf-msg ${msg.type}`}>{msg.text}</div>}
      <div className="ecf-field">
        <label>Nom du responsable</label>
        <input value={nomVal} onChange={(e) => setNom(e.target.value)} />
      </div>
      <div className="ecf-field">
        <label>Emails en copie (CC) de chaque envoi</label>
        <input value={emailsVal} onChange={(e) => setEmails(e.target.value)} />
        <div className="ecf-hint">Séparez plusieurs adresses par « ; »</div>
      </div>
      <div className="ecf-actions">
        <button className="ecf-btn primary" onClick={handleSave} disabled={isLoading}>
          Enregistrer
        </button>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  ONGLET HISTORIQUE (+ relance des commandes déjà envoyées)
//
//  On coche une ou plusieurs commandes envoyées puis « Envoyer une relance ».
//  Les commandes sont REGROUPÉES PAR FOURNISSEUR : relancer 3 commandes du même
//  fournisseur envoie UN mail listant les 3, pas 3 mails.
// ════════════════════════════════════════════════════════════════════════════
const TYPE_BADGE = {
  commande: { cls: "f", label: "commande" },
  relance: { cls: "test", label: "relance" },
  ar: { cls: "ok", label: "AR" },
  facture: { cls: "f", label: "facture" },
  masse: { cls: "a", label: "masse" },
};

const HistoriqueTab = ({ dossier, params }) => {
  const [page, setPage] = useState(1);
  const [filtreType, setFiltreType] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]); // n° de commande
  const [showRelance, setShowRelance] = useState(false);
  const [showPurge, setShowPurge] = useState(false);
  const [result, setResult] = useState(null);
  const [purgeResult, setPurgeResult] = useState(null);

  const { userInfo } = useSelector((s) => s.auth);
  const peutPurger = hasModulePermission(userInfo, "envoi_cde_fournisseur", "delete");

  const { data, isLoading, isFetching, refetch } = useGetEnvoiHistoriqueQuery({
    nomDossierDBF: dossier,
    page,
    limit: 50,
    type: filtreType || undefined,
    search: search || undefined,
  });
  const rows = data?.historique || [];
  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  // Relançable = une ligne qui porte de vrais n° de commande partis chez le
  // fournisseur. Une ligne « relance » l'est aussi (on relance une 2e fois) ;
  // un message groupé ne l'est pas, il ne concerne aucune commande.
  // (une confirmation d'AR n'est pas relançable : le fournisseur a déjà répondu)
  const relancable = (h) =>
    ["commande", "relance"].includes(h.type) && h.statut === "envoye" && h.numcde;
  // Une commande peut avoir plusieurs lignes d'historique (envoi + relances) :
  // la sélection porte sur le N° de commande, jamais sur la ligne.
  const numcdesDeLigne = (h) =>
    (h.numcdes && h.numcdes.length ? h.numcdes : [h.numcde]).filter(Boolean);

  const ligneCochee = (h) =>
    numcdesDeLigne(h).every((n) => selected.includes(n));

  const toggleLigne = (h) => {
    const nums = numcdesDeLigne(h);
    setSelected((s) =>
      nums.every((n) => s.includes(n))
        ? s.filter((n) => !nums.includes(n))
        : [...new Set([...s, ...nums])],
    );
  };

  const lignesRelancables = rows.filter(relancable);
  const toutCoche =
    lignesRelancables.length > 0 && lignesRelancables.every(ligneCochee);
  const toggleAll = () => {
    if (toutCoche) {
      const nums = lignesRelancables.flatMap(numcdesDeLigne);
      setSelected((s) => s.filter((n) => !nums.includes(n)));
    } else {
      setSelected((s) => [
        ...new Set([...s, ...lignesRelancables.flatMap(numcdesDeLigne)]),
      ]);
    }
  };

  return (
    <div>
      <div className="ecf-toolbar">
        <input
          className="ecf-input"
          placeholder="Rechercher (n° cmd, fournisseur, objet…)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="ecf-input"
          value={filtreType}
          onChange={(e) => {
            setFiltreType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Type : tous</option>
          <option value="commande">Commandes</option>
          <option value="relance">Relances</option>
          <option value="ar">Confirmations d'AR</option>
          <option value="facture">Demandes de facture</option>
          <option value="masse">Messages groupés</option>
        </select>
        <button className="ecf-btn" onClick={() => refetch()} disabled={isFetching}>
          <HiRefresh /> Rafraîchir
        </button>
        {peutPurger && (
          <button
            className="ecf-btn danger"
            title="Supprimer les vieux envois de l'historique"
            onClick={() => {
              setPurgeResult(null);
              setShowPurge(true);
            }}
          >
            <HiTrash /> Purger…
          </button>
        )}
        <div className="ecf-spacer" />
        <span className="ecf-soc">{data?.total ?? 0} envoi(s)</span>
        <button
          className="ecf-btn primary"
          disabled={selected.length === 0}
          onClick={() => {
            setResult(null);
            setShowRelance(true);
          }}
        >
          <HiPaperAirplane /> Envoyer une relance ({selected.length})
        </button>
        {selected.length > 0 && (
          <button className="ecf-btn" onClick={() => setSelected([])}>
            <HiX /> Vider
          </button>
        )}
      </div>

      {purgeResult && (
        <div className="ecf-msg ok">
          <b>
            <HiCheckCircle /> {purgeResult.message}
          </b>
        </div>
      )}

      {result && (
        <div className={`ecf-msg ${result.nbErr ? "err" : "ok"}`}>
          <b>
            <HiCheckCircle /> {result.nbOk} relance(s) envoyée(s), {result.nbErr}{" "}
            erreur(s).
          </b>
          {result.testMode && " (mode test)"}
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {(result.resultats || []).map((r, i) => (
              <li key={i}>
                {r.fournNom || `Fournisseur ${r.fournId ?? "?"}`} —{" "}
                {(r.numcdes || []).join(", ")} :{" "}
                {r.statut === "envoye"
                  ? `relancé à ${(r.destinataires || []).join(", ")}`
                  : `erreur — ${r.message}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ecf-tablewrap">
        <table className="ecf-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="ecf-checkbox"
                  checked={toutCoche}
                  onChange={toggleAll}
                  title="Tout sélectionner (commandes de cette page)"
                />
              </th>
              <th>Date</th>
              <th>Type</th>
              <th>Réf.</th>
              <th>Fourn.</th>
              <th>Destinataires</th>
              <th>Statut</th>
              <th>Par</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="ecf-empty">
                  Aucun envoi enregistré.
                </td>
              </tr>
            ) : (
              rows.map((h) => {
                const badge = TYPE_BADGE[h.type] || TYPE_BADGE.commande;
                const ok = relancable(h);
                return (
                  <tr key={h._id} className={ok && ligneCochee(h) ? "selectionnee" : ""}>
                    <td>
                      {ok && (
                        <input
                          type="checkbox"
                          className="ecf-checkbox"
                          checked={ligneCochee(h)}
                          onChange={() => toggleLigne(h)}
                        />
                      )}
                    </td>
                    <td>{new Date(h.createdAt).toLocaleString("fr-FR")}</td>
                    <td>
                      <span className={`ecf-badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="wrap">
                      {h.type === "masse"
                        ? `${h.langue} · ${h.nbDestinataires || 0} frs`
                        : h.numcde}
                    </td>
                    <td className="wrap">
                      {h.fournId ? `${h.fournId} ` : ""}
                      {h.fournNom || ""}
                    </td>
                    <td className="wrap">{(h.destinataires || []).join(", ")}</td>
                    <td>
                      {h.statut === "envoye" ? (
                        <span className="ecf-badge ok">envoyé</span>
                      ) : (
                        <span className="ecf-badge err">erreur</span>
                      )}
                      {h.testMode && <span className="ecf-badge test"> test</span>}
                    </td>
                    <td>
                      {h.envoyePar
                        ? `${h.envoyePar.prenom || ""} ${h.envoyePar.nom || ""}`.trim() ||
                          h.envoyePar.email
                        : "—"}
                    </td>
                    <td>
                      {ok && (
                        <button
                          className="ecf-btn"
                          title="Relancer cette commande"
                          onClick={() => {
                            setSelected(numcdesDeLigne(h));
                            setResult(null);
                            setShowRelance(true);
                          }}
                        >
                          <HiPaperAirplane />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="ecf-toolbar" style={{ marginTop: 10 }}>
        <div className="ecf-spacer" />
        <button
          className="ecf-btn"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Précédent
        </button>
        <span className="ecf-soc">
          {page} / {totalPages || 1}
        </span>
        <button
          className="ecf-btn"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
        </button>
      </div>

      {showRelance && (
        <RelanceModal
          dossier={dossier}
          numcdes={selected}
          testInfo={params}
          onClose={() => setShowRelance(false)}
          onDone={(r) => {
            setResult(r);
            setShowRelance(false);
            setSelected([]);
          }}
        />
      )}

      {showPurge && (
        <PurgeHistoriqueModal
          dossier={dossier}
          onClose={() => setShowPurge(false)}
          onDone={(r) => {
            setPurgeResult(r);
            setResult(null);
            setShowPurge(false);
            setSelected([]);
            setPage(1);
          }}
        />
      )}
    </div>
  );
};

// ── Modale de purge : aperçu chiffré puis suppression définitive ─────────────
//
// La purge est toujours bornée par une date. On affiche AVANT de supprimer le
// nombre exact de lignes concernées, parce que l'historique n'est pas qu'un
// journal : les lignes « commande » alimentent l'onglet « Accusés de réception »
// et la date de 1er envoi rappelée dans les relances. Par défaut on épargne donc
// les commandes dont l'AR n'est pas confirmé.
const PERIODES = [
  { value: "3", label: "plus de 3 mois" },
  { value: "6", label: "plus de 6 mois" },
  { value: "12", label: "plus d'un an" },
  { value: "24", label: "plus de 2 ans" },
  { value: "date", label: "antérieurs à une date précise…" },
];

const LIBELLE_TYPE = {
  commande: "Commandes",
  relance: "Relances",
  ar: "Confirmations d'AR",
  facture: "Demandes de facture",
  masse: "Messages groupés",
};

const PurgeHistoriqueModal = ({ dossier, onClose, onDone }) => {
  const [periode, setPeriode] = useState("12");
  const [dateLimite, setDateLimite] = useState("");
  const [types, setTypes] = useState(Object.keys(LIBELLE_TYPE));
  const [garderArNonConfirme, setGarderArNonConfirme] = useState(true);
  const [confirme, setConfirme] = useState(false);
  const [erreur, setErreur] = useState(null);

  const [purger, { isLoading: purgeEnCours }] = usePurgerHistoriqueMutation();

  const criteres =
    periode === "date"
      ? dateLimite
        ? { avant: dateLimite }
        : null
      : { mois: periode };

  const { data: apercu, isFetching } = useGetApercuPurgeHistoriqueQuery(
    { nomDossierDBF: dossier, ...criteres, types, garderArNonConfirme },
    { skip: !criteres || types.length === 0 },
  );

  // Toute modification des critères annule la confirmation déjà donnée.
  const majCritere = (fn) => {
    setConfirme(false);
    setErreur(null);
    fn();
  };

  const toggleType = (t) =>
    majCritere(() =>
      setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t])),
    );

  const nb = apercu?.aSupprimer ?? 0;

  const lancer = async () => {
    if (!criteres) return;
    if (!confirme) {
      setConfirme(true);
      return;
    }
    try {
      const r = await purger({
        nomDossierDBF: dossier,
        ...criteres,
        types,
        garderArNonConfirme,
      }).unwrap();
      onDone(r);
    } catch (e) {
      setErreur(e?.data?.message || "La purge a échoué.");
    }
  };

  return (
    <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal">
      <h3>
        <HiTrash /> Purger l'historique des envois
      </h3>

      {erreur && <div className="ecf-msg err">{erreur}</div>}

      <div className="ecf-field">
        <label>Supprimer les envois…</label>
        <select
          value={periode}
          onChange={(e) => majCritere(() => setPeriode(e.target.value))}
        >
          {PERIODES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {periode === "date" && (
        <div className="ecf-field">
          <label>Antérieurs au</label>
          <input
            type="date"
            value={dateLimite}
            onChange={(e) => majCritere(() => setDateLimite(e.target.value))}
          />
          <div className="ecf-hint">
            Tout ce qui précède ce jour est supprimé ; cette journée est conservée.
          </div>
        </div>
      )}

      <div className="ecf-field">
        <label>Types d'envoi concernés</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {Object.entries(LIBELLE_TYPE).map(([t, lbl]) => (
            <label key={t} className="ecf-check" style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                className="ecf-checkbox"
                checked={types.includes(t)}
                onChange={() => toggleType(t)}
              />
              {lbl}
            </label>
          ))}
        </div>
      </div>

      {types.includes("commande") && (
        <label className="ecf-check">
          <input
            type="checkbox"
            className="ecf-checkbox"
            checked={garderArNonConfirme}
            onChange={(e) =>
              majCritere(() => setGarderArNonConfirme(e.target.checked))
            }
          />
          Conserver les commandes dont l'accusé de réception n'est pas confirmé
        </label>
      )}

      <div className="ecf-msg warn">
        <HiExclamation /> Une commande retirée de l'historique disparaît aussi de
        l'onglet « Accusés de réception » et ne peut plus être relancée. Les
        commandes elles-mêmes (fichiers de l'ERP) ne sont jamais touchées.
      </div>

      <div className="ecf-purge-apercu">
        {!criteres ? (
          <span className="ecf-soc">Choisissez une date pour voir le résultat.</span>
        ) : types.length === 0 ? (
          <span className="ecf-soc">Sélectionnez au moins un type d'envoi.</span>
        ) : isFetching || !apercu ? (
          <span className="ecf-soc">Calcul…</span>
        ) : (
          <>
            <div>
              <b>{nb}</b> envoi(s) seront supprimés — {apercu.restant} conservé(s)
              sur {apercu.totalHistorique}.
            </div>
            {nb > 0 && (
              <div className="ecf-hint">
                {Object.entries(apercu.parType || {})
                  .map(([t, n]) => `${LIBELLE_TYPE[t] || t} : ${n}`)
                  .join(" · ")}
              </div>
            )}
            {apercu.protegees > 0 && (
              <div className="ecf-hint">
                {apercu.protegees} commande(s) conservée(s) : leur AR n'est pas
                confirmé.
              </div>
            )}
            {apercu.plusAncien && (
              <div className="ecf-hint">
                Envoi le plus ancien :{" "}
                {new Date(apercu.plusAncien).toLocaleDateString("fr-FR")}.
              </div>
            )}
          </>
        )}
      </div>

      {confirme && nb > 0 && (
        <div className="ecf-msg err">
          <b>Confirmez :</b> {nb} ligne(s) d'historique vont être supprimées
          définitivement. Cliquez à nouveau sur « Supprimer » pour valider.
        </div>
      )}

      <div className="ecf-actions">
        <button className="ecf-btn" onClick={onClose} disabled={purgeEnCours}>
          Annuler
        </button>
        <button
          className="ecf-btn danger"
          onClick={lancer}
          disabled={purgeEnCours || isFetching || nb === 0}
        >
          <HiTrash />{" "}
          {purgeEnCours
            ? "Suppression…"
            : confirme
              ? `Oui, supprimer ${nb} envoi(s)`
              : `Supprimer (${nb})`}
        </button>
      </div>
    </Modal>
  );
};

// ── Modale de relance : aperçu par fournisseur puis confirmation ─────────────
const RelanceModal = ({ dossier, numcdes, testInfo, onClose, onDone }) => {
  const [apercu, { isLoading: chargement }] = useApercuRelanceMutation();
  const [envoyer, { isLoading: envoi }] = useEnvoyerRelanceMutation();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [avecPieces, setAvecPieces] = useState(true);
  const [ouvert, setOuvert] = useState(null); // fournId dont l'aperçu est déplié

  // Aperçu calculé côté serveur : c'est EXACTEMENT ce qui partira.
  useEffect(() => {
    let annule = false;
    apercu({ nomDossierDBF: dossier, numcdes })
      .unwrap()
      .then((r) => {
        if (!annule) setData(r);
      })
      .catch((e) => {
        if (!annule) setErreur(e?.data?.message || "Impossible de préparer la relance.");
      });
    return () => {
      annule = true;
    };
  }, [dossier, numcdes, apercu]);

  const groupes = data?.groupes || [];
  const valides = groupes.filter((g) => !g.erreur);
  const enErreur = groupes.filter((g) => g.erreur);

  const confirmer = async () => {
    try {
      const r = await envoyer({
        nomDossierDBF: dossier,
        numcdes,
        avecPieces,
      }).unwrap();
      onDone(r);
    } catch (e) {
      setErreur(e?.data?.message || "Erreur d'envoi.");
    }
  };

  return (
    <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal lg">
      <h3>
        <HiPaperAirplane /> Relance — {numcdes.length} commande(s)
        <button className="ecf-btn ecf-spacer" onClick={onClose}>
          <HiX />
        </button>
      </h3>

      {testInfo?.testMode ? (
        <div className="ecf-testbanner on" style={{ marginBottom: 10 }}>
          <HiShieldCheck /> Mode test : les relances partiront vers{" "}
          {(testInfo.testEmails || []).join(", ")} — aucun fournisseur ne sera
          contacté.
        </div>
      ) : (
        <div className="ecf-testbanner off" style={{ marginBottom: 10 }}>
          <HiExclamation /> Mode réel : les relances partiront réellement aux
          fournisseurs.
        </div>
      )}

      {erreur && <div className="ecf-msg err">{erreur}</div>}

      {chargement && !data ? (
        <div className="ecf-empty">Préparation de la relance…</div>
      ) : (
        <>
          {enErreur.length > 0 && (
            <div className="ecf-msg err">
              <b>
                <HiExclamation /> {enErreur.length} fournisseur(s) ne seront pas
                relancés :
              </b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {enErreur.map((g, i) => (
                  <li key={i}>
                    {(g.numcdes || []).join(", ")} — {g.erreur}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="ecf-recip" style={{ marginBottom: 10 }}>
            <span className="tag">
              {valides.length} mail(s) — les commandes d'un même fournisseur sont
              regroupées dans un seul message.
            </span>
          </div>

          <label className="ecf-check">
            <input
              type="checkbox"
              className="ecf-checkbox"
              checked={avecPieces}
              onChange={(e) => setAvecPieces(e.target.checked)}
            />
            Joindre à nouveau chaque commande (Excel + PDF)
          </label>

          <div className="ecf-relance-liste">
            {valides.map((g) => (
              <div className="ecf-relance-card" key={g.fournId}>
                <div className="ecf-relance-head">
                  <b>
                    {g.fournId} — {g.fournNom || "(sans nom)"}
                  </b>
                  <span className={`ecf-badge ${g.langue === "A" ? "a" : "f"}`}>
                    {g.langue === "A" ? "Anglais" : "Français"}
                  </span>
                  <span className="ecf-recip tag">
                    {(g.numcdes || []).length} commande(s) :{" "}
                    {(g.numcdes || []).join(", ")}
                  </span>
                  <button
                    className="ecf-btn ecf-spacer"
                    onClick={() => setOuvert(ouvert === g.fournId ? null : g.fournId)}
                  >
                    <HiEye /> {ouvert === g.fournId ? "Masquer" : "Aperçu"}
                  </button>
                </div>
                <div className="ecf-recip">
                  <div>
                    <span className="tag">Objet :</span> {g.envoi?.sujet}
                  </div>
                  <div>
                    <span className="tag">À :</span> {(g.envoi?.to || []).join(", ")}
                  </div>
                  {(g.envoi?.cc || []).length > 0 && (
                    <div>
                      <span className="tag">Copie :</span>{" "}
                      {(g.envoi.cc || []).join(", ")}
                    </div>
                  )}
                  {g.envoi?.testMode && (
                    <div>
                      <span className="tag">En réel :</span>{" "}
                      {(g.destinatairesReels || []).join(", ")}
                    </div>
                  )}
                </div>
                {ouvert === g.fournId && (
                  <div
                    className="ecf-preview mail"
                    dangerouslySetInnerHTML={{ __html: g.html }}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="ecf-actions">
        <button className="ecf-btn" onClick={onClose}>
          Annuler
        </button>
        <button
          className="ecf-btn primary"
          onClick={confirmer}
          disabled={envoi || valides.length === 0}
        >
          <HiPaperAirplane />{" "}
          {envoi ? "Envoi…" : `Envoyer ${valides.length} relance(s)`}
        </button>
      </div>
    </Modal>
  );
};

// ── Modale de demande de facture ────────────────────────────────────────────
//  Même forme que la relance (regroupement par fournisseur, aperçu du mail réel
//  calculé par le serveur), avec deux différences assumées :
//   - les commandes sans AR confirmé remontent en erreur : on ne réclame pas la
//     facture d'une commande que le fournisseur n'a pas encore acceptée ;
//   - les pièces jointes sont DÉCOCHÉES par défaut (il a déjà la commande).
// ────────────────────────────────────────────────────────────────────────────
const FactureModal = ({ dossier, numcdes, testInfo, onClose, onDone }) => {
  const [apercu, { isLoading: chargement }] = useApercuDemandeFactureMutation();
  const [envoyer, { isLoading: envoi }] = useEnvoyerDemandeFactureMutation();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [avecPieces, setAvecPieces] = useState(false);
  const [ouvert, setOuvert] = useState(null); // fournId dont l'aperçu est déplié

  useEffect(() => {
    let annule = false;
    apercu({ nomDossierDBF: dossier, numcdes })
      .unwrap()
      .then((r) => {
        if (!annule) setData(r);
      })
      .catch((e) => {
        if (!annule)
          setErreur(e?.data?.message || "Impossible de préparer la demande.");
      });
    return () => {
      annule = true;
    };
  }, [dossier, numcdes, apercu]);

  const groupes = data?.groupes || [];
  const valides = groupes.filter((g) => !g.erreur);
  const enErreur = groupes.filter((g) => g.erreur);

  const confirmer = async () => {
    try {
      const r = await envoyer({
        nomDossierDBF: dossier,
        numcdes,
        avecPieces,
      }).unwrap();
      onDone(r);
    } catch (e) {
      setErreur(e?.data?.message || "Erreur d'envoi.");
    }
  };

  return (
    <Modal onClose={onClose} overlayClassName="ecf-overlay" contentClassName="ecf-modal lg">
      <h3>
        <HiDocumentText /> Demande de facture — {numcdes.length} commande(s)
        <button className="ecf-btn ecf-spacer" onClick={onClose}>
          <HiX />
        </button>
      </h3>

      {testInfo?.testMode ? (
        <div className="ecf-testbanner on" style={{ marginBottom: 10 }}>
          <HiShieldCheck /> Mode test : les demandes partiront vers{" "}
          {(testInfo.testEmails || []).join(", ")} — aucun fournisseur ne sera
          contacté.
        </div>
      ) : (
        <div className="ecf-testbanner off" style={{ marginBottom: 10 }}>
          <HiExclamation /> Mode réel : les demandes partiront réellement aux
          fournisseurs.
        </div>
      )}

      {erreur && <div className="ecf-msg err">{erreur}</div>}

      {chargement && !data ? (
        <div className="ecf-empty">Préparation de la demande…</div>
      ) : (
        <>
          {enErreur.length > 0 && (
            <div className="ecf-msg err">
              <b>
                <HiExclamation /> {enErreur.length} commande(s) écartée(s) :
              </b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {enErreur.map((g, i) => (
                  <li key={i}>
                    {(g.numcdes || []).join(", ")} — {g.erreur}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="ecf-recip" style={{ marginBottom: 10 }}>
            <span className="tag">
              {valides.length} mail(s) — les commandes d'un même fournisseur sont
              regroupées dans un seul message, avec le montant confirmé à l'AR.
            </span>
          </div>

          <label className="ecf-check">
            <input
              type="checkbox"
              className="ecf-checkbox"
              checked={avecPieces}
              onChange={(e) => setAvecPieces(e.target.checked)}
            />
            Joindre à nouveau chaque commande (Excel + PDF)
          </label>

          <div className="ecf-relance-liste">
            {valides.map((g) => (
              <div className="ecf-relance-card" key={g.fournId}>
                <div className="ecf-relance-head">
                  <b>
                    {g.fournId} — {g.fournNom || "(sans nom)"}
                  </b>
                  <span className={`ecf-badge ${g.langue === "A" ? "a" : "f"}`}>
                    {g.langue === "A" ? "Anglais" : "Français"}
                  </span>
                  <span className="ecf-recip tag">
                    {(g.numcdes || []).length} commande(s) :{" "}
                    {(g.numcdes || []).join(", ")}
                    {g.montantTotalLibelle ? ` · ${g.montantTotalLibelle}` : ""}
                  </span>
                  <button
                    className="ecf-btn ecf-spacer"
                    onClick={() => setOuvert(ouvert === g.fournId ? null : g.fournId)}
                  >
                    <HiEye /> {ouvert === g.fournId ? "Masquer" : "Aperçu"}
                  </button>
                </div>
                <div className="ecf-recip">
                  <div>
                    <span className="tag">Objet :</span> {g.envoi?.sujet}
                  </div>
                  <div>
                    <span className="tag">À :</span> {(g.envoi?.to || []).join(", ")}
                  </div>
                  {(g.envoi?.cc || []).length > 0 && (
                    <div>
                      <span className="tag">Copie :</span>{" "}
                      {(g.envoi.cc || []).join(", ")}
                    </div>
                  )}
                  {g.envoi?.testMode && (
                    <div>
                      <span className="tag">En réel :</span>{" "}
                      {(g.destinatairesReels || []).join(", ")}
                    </div>
                  )}
                </div>
                {ouvert === g.fournId && (
                  <div
                    className="ecf-preview mail"
                    dangerouslySetInnerHTML={{ __html: g.html }}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="ecf-actions">
        <button className="ecf-btn" onClick={onClose}>
          Annuler
        </button>
        <button
          className="ecf-btn primary"
          onClick={confirmer}
          disabled={envoi || valides.length === 0}
        >
          <HiPaperAirplane />{" "}
          {envoi ? "Envoi…" : `Envoyer ${valides.length} demande(s)`}
        </button>
      </div>
    </Modal>
  );
};

export default EnvoiCdeFournisseurScreen;
