import React, { useState, useMemo, useRef } from "react";
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
  useGetMessagesFournisseurQuery,
  useUpsertMessageFournisseurMutation,
  useGetResponsableCcQuery,
  useUpsertResponsableCcMutation,
  useGetEnvoiHistoriqueQuery,
} from "../../slices/envoiCdeApiSlice";
import { ENVOI_CDE_URL } from "../../constants";
import Modal from "../../components/ui/Modal/Modal";
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
const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " F";

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
      {tab === "masse" && <MasseTab dossier={dossier} params={params} />}
      {tab === "emails" && <EmailsTab dossier={dossier} />}
      {tab === "messages" && <MessagesTab dossier={dossier} />}
      {tab === "responsable" && <ResponsableTab dossier={dossier} />}
      {tab === "historique" && <HistoriqueTab dossier={dossier} />}
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
              <th className="ecf-right">Coût achat prév.</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : commandes.length === 0 ? (
              <tr>
                <td colSpan={10} className="ecf-empty">
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
                  <td className="ecf-right">{fmtMoney(c.COUT_ACHAT_PREV)}</td>
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
            <span className="tag">Coût achat prév. :</span> {fmtMoney(data.montantPrev)}
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
                  </tr>
                ))}
              </tbody>
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
// ════════════════════════════════════════════════════════════════════════════
const MessagesTab = ({ dossier }) => {
  const { data } = useGetMessagesFournisseurQuery(dossier);
  const messages = data?.messages || [];
  const defauts = data?.defauts || {};
  const [upsert, { isLoading }] = useUpsertMessageFournisseurMutation();
  const [langue, setLangue] = useState("F");
  const [text, setText] = useState(null);
  const [msg, setMsg] = useState(null);

  const current = useMemo(
    () => messages.find((m) => m.langue === langue),
    [messages, langue],
  );
  const hasOwn = !!current;
  // Si la société n'a pas de modèle pour cette langue, on pré-remplit le défaut.
  const value =
    text === null ? current?.message || defauts[langue] || "" : text;

  const handleSave = async () => {
    try {
      await upsert({ nomDossierDBF: dossier, langue, message: value }).unwrap();
      setMsg({ type: "ok", text: "Modèle enregistré." });
      setText(null);
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur." });
    }
  };

  return (
    <div>
      <div className="ecf-langtabs">
        {["F", "A"].map((l) => (
          <button
            key={l}
            className={`ecf-btn ${langue === l ? "primary" : ""}`}
            onClick={() => {
              setLangue(l);
              setText(null);
              setMsg(null);
            }}
          >
            {l === "F" ? "Français" : "Anglais"}
          </button>
        ))}
      </div>
      {msg && <div className={`ecf-msg ${msg.type}`}>{msg.text}</div>}
      {!hasOwn && (
        <div className="ecf-msg" style={{ background: "rgba(234,179,8,0.12)", color: "#eab308", border: "1px solid rgba(234,179,8,0.4)" }}>
          Cette société n'a pas encore de modèle « {langue === "F" ? "Français" : "Anglais"} » —
          le modèle par défaut est pré-rempli ci-dessous. Enregistrez pour le personnaliser.
        </div>
      )}
      <div className="ecf-field">
        <label>Corps HTML du message (langue {langue})</label>
        <textarea
          style={{ minHeight: 280 }}
          value={value}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="ecf-hint">
          Une signature société est automatiquement ajoutée à l'envoi.
        </div>
      </div>
      <div className="ecf-field">
        <label>Aperçu</label>
        <div className="ecf-preview" dangerouslySetInnerHTML={{ __html: value }} />
      </div>
      <div className="ecf-actions">
        <button className="ecf-btn primary" onClick={handleSave} disabled={isLoading}>
          Enregistrer le modèle
        </button>
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
//  ONGLET HISTORIQUE
// ════════════════════════════════════════════════════════════════════════════
const HistoriqueTab = ({ dossier }) => {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetEnvoiHistoriqueQuery({
    nomDossierDBF: dossier,
    page,
    limit: 50,
  });
  const rows = data?.historique || [];
  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  return (
    <div>
      <div className="ecf-toolbar">
        <span className="ecf-soc">{data?.total ?? 0} envoi(s)</span>
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
      <div className="ecf-tablewrap">
        <table className="ecf-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Réf.</th>
              <th>Fourn.</th>
              <th>Destinataires</th>
              <th>Statut</th>
              <th>Par</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="ecf-empty">
                  Aucun envoi enregistré.
                </td>
              </tr>
            ) : (
              rows.map((h) => (
                <tr key={h._id}>
                  <td>{new Date(h.createdAt).toLocaleString("fr-FR")}</td>
                  <td>
                    {h.type === "masse" ? (
                      <span className="ecf-badge a">masse</span>
                    ) : (
                      <span className="ecf-badge f">commande</span>
                    )}
                  </td>
                  <td>{h.type === "masse" ? `${h.langue} · ${h.nbDestinataires || 0} frs` : h.numcde}</td>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default EnvoiCdeFournisseurScreen;
