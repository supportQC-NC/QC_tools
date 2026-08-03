import React, { useState, useMemo } from "react";
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
  useCreateFournisseurEmailMutation,
  useUpdateFournisseurEmailMutation,
  useDeleteFournisseurEmailMutation,
  useGetMessagesFournisseurQuery,
  useUpsertMessageFournisseurMutation,
  useGetResponsableCcQuery,
  useUpsertResponsableCcMutation,
  useGetEnvoiHistoriqueQuery,
} from "../../slices/envoiCdeApiSlice";
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
              <th>Bateau</th>
              <th className="ecf-right">Lignes</th>
              <th className="ecf-right">Coût achat prév.</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : commandes.length === 0 ? (
              <tr>
                <td colSpan={9} className="ecf-empty">
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
    <div className="ecf-overlay" onClick={onClose}>
      <div className="ecf-modal lg" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
};

// ── Modale aperçu email ──────────────────────────────────────────────────────
const ApercuModal = ({ dossier, numcde, onClose }) => {
  const { data, isLoading, error } = useGetApercuEnvoiQuery({
    nomDossierDBF: dossier,
    numcde,
  });
  return (
    <div className="ecf-overlay" onClick={onClose}>
      <div className="ecf-modal lg" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
};

// ── Modale confirmation envoi ────────────────────────────────────────────────
const SendModal = ({ commandes, testInfo, sending, onConfirm, onClose }) => (
  <div className="ecf-overlay" onClick={onClose}>
    <div className="ecf-modal" onClick={(e) => e.stopPropagation()}>
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
    </div>
  </div>
);

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
  const [msg, setMsg] = useState(null);

  const handleImport = async () => {
    if (
      !window.confirm(
        "Importer / mettre à jour la base fournisseurs de référence (migrée depuis Access) pour cette société ?\n\nLes fiches existantes seront mises à jour, les manquantes créées.",
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
        <button
          className="ecf-btn"
          onClick={handleImport}
          disabled={importing}
          title="Importer la base migrée depuis Access (fichier de référence)"
        >
          <HiRefresh /> {importing ? "Import…" : "Importer la base de référence"}
        </button>
        <button className="ecf-btn primary" onClick={() => setEditing({})}>
          <HiPlus /> Ajouter
        </button>
      </div>

      {msg && <div className={`ecf-msg ${msg.type}`}>{msg.text}</div>}

      <div className="ecf-tablewrap">
        <table className="ecf-table">
          <thead>
            <tr>
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
                <td colSpan={7} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : emails.length === 0 ? (
              <tr>
                <td colSpan={7} className="ecf-empty">
                  Aucun email fournisseur pour cette société.
                </td>
              </tr>
            ) : (
              emails.map((e) => (
                <tr key={e._id}>
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
    <div className="ecf-overlay" onClick={onClose}>
      <div className="ecf-modal" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
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
          Une signature société est automatiquement ajoutée à l'envoi.{" "}
          <button
            className="ecf-btn"
            style={{ padding: "2px 8px", fontSize: "0.75rem" }}
            onClick={() => setText(defauts[langue] || "")}
          >
            Charger le modèle par défaut
          </button>
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
              <th>N° Cmd</th>
              <th>Fourn.</th>
              <th>Destinataires</th>
              <th>Statut</th>
              <th>Par</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="ecf-empty">
                  Chargement…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="ecf-empty">
                  Aucun envoi enregistré.
                </td>
              </tr>
            ) : (
              rows.map((h) => (
                <tr key={h._id}>
                  <td>{new Date(h.createdAt).toLocaleString("fr-FR")}</td>
                  <td>{h.numcde}</td>
                  <td className="wrap">
                    {h.fournId} {h.fournNom ? `— ${h.fournNom}` : ""}
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
