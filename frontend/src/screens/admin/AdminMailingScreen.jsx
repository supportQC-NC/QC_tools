// src/screens/admin/AdminMailingScreen.jsx
//
// Outil de MAILING clients : sélection depuis le DBF (email = ADMAIL, filtres
// CATEGORIE / PROFES) ou CSV, éditeur d'email par blocs, envoi de test, puis
// envoi PAR LOTS (25 / pause 60 min) en tâche de fond. Module gaté "mailing".
import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiMail,
  HiPlus,
  HiTrash,
  HiPaperAirplane,
  HiPlay,
  HiPause,
  HiArrowLeft,
  HiSearch,
  HiUserGroup,
  HiChartBar,
  HiLightningBolt,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntrepriseId,
} from "../../slices/entrepriseGlobalSlice";
import {
  useGetMailFiltersQuery,
  useGetRecipientsCountQuery,
  useGetCampaignsQuery,
  useCreateCampaignMutation,
  useUpdateCampaignMutation,
  useDeleteCampaignMutation,
  useTestCampaignMutation,
  useLaunchCampaignMutation,
  usePauseCampaignMutation,
  useResumeCampaignMutation,
  useGetSegmentsQuery,
  useGetSegmentCountQuery,
} from "../../slices/mailingApiSlice";
import MailBlockDesigner from "../../components/Admin/MailBlockDesigner";
import MailSegments from "../../components/Admin/MailSegments";
import MailStats from "../../components/Admin/MailStats";
import MailAutomations from "../../components/Admin/MailAutomations";
import SpamCheckField from "../../components/Admin/SpamCheckField";
import "./AdminMailingScreen.css";

const parseEmails = (t) => [
  ...new Set(
    String(t || "")
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
];

const STATUS = {
  brouillon: "Brouillon",
  test_envoye: "Test envoyé",
  en_cours: "En cours",
  pause: "En pause",
  termine: "Terminée",
  erreur: "Erreur",
};

// Petite liste à cocher recherchable ({ code, count }).
const CheckList = ({ items, selected, onToggle, color }) => {
  const [q, setQ] = useState("");
  const filtered = (items || []).filter((i) =>
    i.code.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="ml-checklist">
      <div className="ml-search">
        <HiSearch />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" />
      </div>
      <div className="ml-checklist-items">
        {filtered.length === 0 && <div className="ml-muted">Aucune valeur.</div>}
        {filtered.map((i) => (
          <label key={i.code} className="ml-check">
            <input type="checkbox" checked={selected.includes(i.code)} onChange={() => onToggle(i.code)} />
            <span>{i.code}</span>
            <span className="ml-count" style={{ color }}>{i.count}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

// ⚠️ Adresses de test SÛRES — ne JAMAIS tester l'envoi avec la base clients.
const TEST_EMAILS = "communication@quincaillerie.nc\nsupport@quincaillerie.nc\nkrysto.contact@gmail.com";

const emptyForm = () => ({
  nom: "",
  subject: "",
  replyTo: "",
  design: { blocks: [], settings: { bg: "#f2f4f7", contentWidth: 600 } },
  scopeType: "tous",
  categories: [],
  profes: [],
  csvText: "",
  segmentId: "",
  testText: TEST_EMAILS,
});

const AdminMailingScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entrepriseId = useSelector(selectGlobalEntrepriseId);

  const { data: campaigns = [] } = useGetCampaignsQuery(undefined, {
    pollingInterval: 15000,
  });
  const [createCampaign] = useCreateCampaignMutation();
  const [updateCampaign] = useUpdateCampaignMutation();
  const [deleteCampaign] = useDeleteCampaignMutation();
  const [testCampaign, { isLoading: testing }] = useTestCampaignMutation();
  const [launchCampaign, { isLoading: launching }] = useLaunchCampaignMutation();
  const [pauseCampaign] = usePauseCampaignMutation();
  const [resumeCampaign] = useResumeCampaignMutation();

  const [tab, setTab] = useState("campagnes"); // campagnes | segments
  const [statsFor, setStatsFor] = useState(null); // campagne dont on voit les stats
  const [editing, setEditing] = useState(null); // null = liste ; sinon campagne
  const [form, setForm] = useState(emptyForm());
  const [msg, setMsg] = useState(null);

  const { data: filters } = useGetMailFiltersQuery(nomDossierDBF, {
    skip: !nomDossierDBF,
  });

  // Segments de la société (pour cibler une campagne).
  const { data: segments = [] } = useGetSegmentsQuery(entrepriseId, {
    skip: !entrepriseId || !editing,
  });

  // Comptage des destinataires (hors CSV/segment, comptés autrement).
  const { data: countData } = useGetRecipientsCountQuery(
    {
      nomDossierDBF,
      categories: form.scopeType === "categorie" ? form.categories : [],
      profes: form.scopeType === "profes" ? form.profes : [],
    },
    {
      skip:
        !nomDossierDBF ||
        !editing ||
        form.scopeType === "csv" ||
        form.scopeType === "segment",
    },
  );
  const { data: segCount } = useGetSegmentCountQuery(form.segmentId, {
    skip: form.scopeType !== "segment" || !form.segmentId,
  });
  const recipientCount =
    form.scopeType === "csv"
      ? parseEmails(form.csvText).length
      : form.scopeType === "segment"
        ? segCount?.count ?? "…"
        : countData?.count ?? "…";

  const openNew = () => {
    setMsg(null);
    setForm(emptyForm());
    setEditing({});
  };
  const openEdit = (c) => {
    setMsg(null);
    setForm({
      nom: c.nom || "",
      subject: c.subject || "",
      replyTo: c.replyTo || "",
      design: c.design || { blocks: [] },
      scopeType: c.scope?.type || "tous",
      categories: c.scope?.categories || [],
      profes: c.scope?.profes || [],
      csvText: (c.scope?.csvEmails || []).join("\n"),
      segmentId: c.scope?.segmentId || "",
      testText: (c.testEmails || []).length ? c.testEmails.join("\n") : TEST_EMAILS,
    });
    setEditing(c);
  };

  const buildScope = () => ({
    type: form.scopeType,
    categories: form.categories,
    profes: form.profes,
    csvEmails: parseEmails(form.csvText),
    segmentId: form.segmentId || undefined,
  });

  const ensureSaved = async () => {
    if (!entrepriseId) throw new Error("Sélectionnez une société dans l'en-tête.");
    if (!form.nom.trim()) throw new Error("Donnez un nom à la campagne.");
    const payload = {
      nom: form.nom.trim(),
      subject: form.subject,
      replyTo: form.replyTo,
      design: form.design,
      scope: buildScope(),
      batchSize: 25,
      pauseMinutes: 60,
    };
    if (editing?._id) {
      const up = await updateCampaign({ id: editing._id, ...payload }).unwrap();
      setEditing(up);
      return editing._id;
    }
    const created = await createCampaign({ entrepriseId, ...payload }).unwrap();
    setEditing(created);
    return created._id;
  };

  const onSave = async () => {
    setMsg(null);
    try {
      await ensureSaved();
      setMsg({ type: "ok", text: "Campagne enregistrée." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || e.message });
    }
  };

  const onTest = async () => {
    setMsg(null);
    const emails = parseEmails(form.testText);
    if (emails.length === 0) {
      setMsg({ type: "err", text: "Saisissez au moins un email de test." });
      return;
    }
    try {
      const id = await ensureSaved();
      const res = await testCampaign({ id, emails }).unwrap();
      setMsg({ type: "ok", text: `Test envoyé (${res.sent} ok, ${res.failed} échec).` });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || e.message });
    }
  };

  const onLaunch = async () => {
    setMsg(null);
    if (
      !window.confirm(
        `Lancer l'envoi à ${recipientCount} destinataire(s) ? Envoi par lots de 25 avec 1 h de pause entre chaque lot.`,
      )
    )
      return;
    try {
      const id = await ensureSaved();
      const res = await launchCampaign(id).unwrap();
      setMsg({
        type: "ok",
        text: `Campagne lancée : ${res.total} destinataire(s), lots de ${res.batchSize} / pause ${res.pauseMinutes} min.`,
      });
      setEditing(null);
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || e.message });
    }
  };

  const onDelete = async (c) => {
    if (!window.confirm(`Supprimer la campagne « ${c.nom} » ?`)) return;
    try {
      await deleteCampaign(c._id).unwrap();
    } catch (e) {
      alert(e?.data?.message || "Suppression impossible");
    }
  };

  const toggle = (key, code) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(code)
        ? f[key].filter((c) => c !== code)
        : [...f[key], code],
    }));

  // ─────────────────────────── Vue STATISTIQUES ───────────────────────────
  if (statsFor) {
    return (
      <div className="ml-screen ml-screen--wide">
        <MailStats campaign={statsFor} onClose={() => setStatsFor(null)} />
      </div>
    );
  }

  // ─────────────────────────── Vue LISTE ───────────────────────────
  if (!editing) {
    const launched = (c) =>
      c.status === "en_cours" || c.status === "pause" || c.status === "termine";
    return (
      <div className="ml-screen">
        <div className="ml-head">
          <h1><HiMail /> Mailing clients</h1>
          {tab === "campagnes" && (
            <button className="ml-primary" onClick={openNew}><HiPlus /> Nouvelle campagne</button>
          )}
        </div>

        <div className="ml-tabs">
          <button className={`ml-tab ${tab === "campagnes" ? "on" : ""}`} onClick={() => setTab("campagnes")}><HiMail /> Campagnes</button>
          <button className={`ml-tab ${tab === "segments" ? "on" : ""}`} onClick={() => setTab("segments")}><HiUserGroup /> Segments</button>
          <button className={`ml-tab ${tab === "automatisations" ? "on" : ""}`} onClick={() => setTab("automatisations")}><HiLightningBolt /> Automatisations</button>
        </div>

        {!nomDossierDBF && (
          <div className="ml-hint">Sélectionnez une société dans l'en-tête.</div>
        )}

        {tab === "segments" ? (
          <MailSegments entrepriseId={entrepriseId} filters={filters} />
        ) : tab === "automatisations" ? (
          <MailAutomations entrepriseId={entrepriseId} brand={filters?.brand} />
        ) : campaigns.length === 0 ? (
          <div className="ml-empty">Aucune campagne pour l'instant.</div>
        ) : (
          <div className="ml-list">
            {campaigns.map((c) => {
              const total = c.recipientsTotal || 0;
              const pct = total ? Math.round((c.sentCount / total) * 100) : 0;
              return (
                <div key={c._id} className="ml-card">
                  <div className="ml-card-main" onClick={() => openEdit(c)}>
                    <div className="ml-card-top">
                      <span className="ml-card-name">{c.nom}</span>
                      <span className={`ml-status ml-status--${c.status}`}>{STATUS[c.status] || c.status}</span>
                    </div>
                    <div className="ml-card-sub">
                      {c.entreprise?.trigramme ? `${c.entreprise.trigramme} · ` : ""}
                      {c.subject || "(sans objet)"}
                    </div>
                    {launched(c) && (
                      <div className="ml-progress">
                        <div className="ml-progress-bar"><span style={{ width: `${pct}%` }} /></div>
                        <span className="ml-progress-txt">{c.sentCount}/{total} envoyés{c.failedCount ? ` · ${c.failedCount} échec` : ""}</span>
                      </div>
                    )}
                  </div>
                  <div className="ml-card-actions">
                    {launched(c) && (
                      <button title="Statistiques" onClick={() => setStatsFor(c)}><HiChartBar /></button>
                    )}
                    {c.status === "en_cours" && (
                      <button title="Pause" onClick={() => pauseCampaign(c._id)}><HiPause /></button>
                    )}
                    {c.status === "pause" && (
                      <button title="Reprendre" onClick={() => resumeCampaign(c._id)}><HiPlay /></button>
                    )}
                    <button title="Supprimer" onClick={() => onDelete(c)}><HiTrash /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────── Vue ÉDITEUR ───────────────────────────
  return (
    <div className="ml-screen ml-screen--wide">
      <div className="ml-head">
        <button className="ml-back" onClick={() => setEditing(null)}><HiArrowLeft /> Campagnes</button>
        <div className="ml-editor-actions">
          <button className="ml-ghost" onClick={onSave}>Enregistrer</button>
          <button className="ml-primary" onClick={onLaunch} disabled={launching}>
            {launching ? "Lancement…" : "🚀 Lancer la campagne"}
          </button>
        </div>
      </div>

      {msg && <div className={`ml-msg ml-msg--${msg.type}`}>{msg.text}</div>}

      <div className="ml-card ml-block">
        <div className="ml-fields">
          <SpamCheckField label="Nom (interne)" value={form.nom} onChange={(v) => setForm((f) => ({ ...f, nom: v }))} placeholder="Ex : Promo rentrée" />
          <SpamCheckField label="Objet de l'email" value={form.subject} onChange={(v) => setForm((f) => ({ ...f, subject: v }))} placeholder="Ex : Nos nouveautés cette semaine" />
          <label>Répondre à (Reply-To)<input value={form.replyTo} onChange={(e) => setForm((f) => ({ ...f, replyTo: e.target.value }))} placeholder="contact@…" /></label>
        </div>
      </div>

      {/* Designer d'email */}
      <div className="ml-card ml-block">
        <div className="ml-section-title">Contenu de l'email</div>
        <MailBlockDesigner value={form.design} onChange={(design) => setForm((f) => ({ ...f, design }))} brand={filters?.brand} />
      </div>

      {/* Destinataires */}
      <div className="ml-card ml-block">
        <div className="ml-section-title">Destinataires <span className="ml-recount">≈ {recipientCount} email(s)</span></div>
        <div className="ml-scopes">
          {[
            ["tous", "Tous les clients"],
            ["segment", "Segment"],
            ["categorie", "Par catégorie"],
            ["profes", "Par profession"],
            ["csv", "Liste CSV / emails"],
          ].map(([v, l]) => (
            <button key={v} type="button" className={`ml-scope ${form.scopeType === v ? "on" : ""}`} onClick={() => setForm((f) => ({ ...f, scopeType: v }))}>{l}</button>
          ))}
        </div>
        {form.scopeType === "segment" && (
          segments.length === 0 ? (
            <div className="ml-muted">Aucun segment pour cette société. Créez-en un dans l'onglet « Segments ».</div>
          ) : (
            <select className="ml-select" value={form.segmentId} onChange={(e) => setForm((f) => ({ ...f, segmentId: e.target.value }))}>
              <option value="">— Choisir un segment —</option>
              {segments.map((s) => (
                <option key={s._id} value={s._id}>{s.nom}{s.description ? ` — ${s.description}` : ""}</option>
              ))}
            </select>
          )
        )}
        {form.scopeType === "categorie" && (
          <CheckList items={filters?.categories} selected={form.categories} onToggle={(c) => toggle("categories", c)} color="#34d399" />
        )}
        {form.scopeType === "profes" && (
          <CheckList items={filters?.professions} selected={form.profes} onToggle={(c) => toggle("profes", c)} color="#c084fc" />
        )}
        {form.scopeType === "csv" && (
          <textarea className="ml-textarea" rows={5} value={form.csvText} onChange={(e) => setForm((f) => ({ ...f, csvText: e.target.value }))} placeholder="Un email par ligne (ou séparés par , ou ;)" />
        )}
        {form.scopeType === "tous" && (
          <div className="ml-muted">Tous les clients ayant un email renseigné ({filters?.totalAvecEmail ?? "…"} au total). Les clients sans email sont ignorés.</div>
        )}
      </div>

      {/* Test */}
      <div className="ml-card ml-block">
        <div className="ml-section-title">Envoi de test</div>
        <textarea className="ml-textarea" rows={2} value={form.testText} onChange={(e) => setForm((f) => ({ ...f, testText: e.target.value }))} placeholder="Vos emails de test (un par ligne)" />
        <button className="ml-ghost" onClick={onTest} disabled={testing}>
          <HiPaperAirplane /> {testing ? "Envoi…" : "Envoyer un test"}
        </button>
      </div>
    </div>
  );
};

export default AdminMailingScreen;
