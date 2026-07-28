// src/components/Admin/MailAutomations.jsx
//
// Automatisations façon Brevo : un déclencheur (« nouveau client ») + une
// SÉQUENCE d'emails avec délais (ex. email de bienvenue). Éditeur multi-étapes
// réutilisant le designer par blocs. Activation SÉCURISÉE (les clients existants
// ne sont jamais recontactés) + envoi de TEST vers des adresses sûres.
import React, { useRef, useState } from "react";
import {
  HiPlus,
  HiTrash,
  HiArrowLeft,
  HiLightningBolt,
  HiPlay,
  HiPause,
  HiPaperAirplane,
  HiClock,
  HiExclamation,
  HiUpload,
  HiUserAdd,
} from "react-icons/hi";
import {
  useGetAutomationsQuery,
  useCreateAutomationMutation,
  useUpdateAutomationMutation,
  useDeleteAutomationMutation,
  useActivateAutomationMutation,
  useDeactivateAutomationMutation,
  useTestAutomationMutation,
  useAddAutomationContactsMutation,
  useImportAutomationContactsMutation,
} from "../../slices/mailingApiSlice";
import MailBlockDesigner from "./MailBlockDesigner";
import SpamCheckField from "./SpamCheckField";

const TEST_EMAILS = "communication@quincaillerie.nc\nsupport@quincaillerie.nc\nkrysto.contact@gmail.com";

const parseEmails = (t) => [
  ...new Set(
    String(t || "")
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
];

const TRIGGERS = {
  nouveau_client: "Nouveau client (détecté dans la base DBF)",
  liste: "Liste de contacts (import CSV/Excel ou ajout manuel)",
};

// Parse "email, nom" par ligne (séparateurs , ; ou tabulation).
const parseContacts = (t) =>
  String(t || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/[,;\t]/).map((p) => p.trim());
      const email = parts.find((p) => p.includes("@")) || parts[0] || "";
      const nom = parts.find((p) => p && !p.includes("@")) || "";
      return { email: email.toLowerCase(), nom };
    })
    .filter((c) => c.email.includes("@"));

const welcomeDesign = (brand) => ({
  blocks: [
    { kind: "heading", text: "Bienvenue chez nous ! 👋", fontSize: 26, color: brand?.primary || "#111111", align: "center", bold: true },
    { kind: "text", text: "Bonjour {{nom|cher client}},\n\nMerci de nous faire confiance. Découvrez nos produits et nos services, et n'hésitez pas à nous contacter pour toute question.", fontSize: 15, color: "#333333", align: "left" },
    { kind: "button", label: "Découvrir la boutique", link: "https://", bg: brand?.primary || "#2f7bef", color: "#ffffff", align: "center" },
  ],
  settings: { bg: "#f2f4f7", cardBg: "#ffffff", contentWidth: 600 },
});

const newStep = (brand, first) => ({
  subject: first ? "Bienvenue chez nous !" : "Un message pour vous",
  delayDays: first ? 0 : 3,
  design: first ? welcomeDesign(brand) : { blocks: [{ kind: "heading", text: "Votre titre", fontSize: 24, color: "#111", align: "center" }], settings: { bg: "#f2f4f7", cardBg: "#fff", contentWidth: 600 } },
});

const emptyForm = (brand) => ({
  nom: "",
  description: "",
  triggerType: "nouveau_client",
  steps: [newStep(brand, true)],
});

const MailAutomations = ({ entrepriseId, brand }) => {
  const { data: automations = [] } = useGetAutomationsQuery(entrepriseId, { skip: !entrepriseId });
  const [createAutomation] = useCreateAutomationMutation();
  const [updateAutomation] = useUpdateAutomationMutation();
  const [deleteAutomation] = useDeleteAutomationMutation();
  const [activateAutomation] = useActivateAutomationMutation();
  const [deactivateAutomation] = useDeactivateAutomationMutation();
  const [testAutomation, { isLoading: testing }] = useTestAutomationMutation();
  const [addContacts] = useAddAutomationContactsMutation();
  const [importContacts, { isLoading: importing }] = useImportAutomationContactsMutation();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm(brand));
  const [step, setStep] = useState(0);
  const [testText, setTestText] = useState(TEST_EMAILS);
  const [contactsText, setContactsText] = useState("");
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const openNew = () => { setForm(emptyForm(brand)); setStep(0); setEditing({}); setMsg(null); };
  const openEdit = (a) => {
    setForm({
      nom: a.nom || "",
      description: a.description || "",
      triggerType: a.trigger?.type || "nouveau_client",
      steps: a.steps?.length ? a.steps.map((s) => ({ subject: s.subject || "", delayDays: s.delayDays || 0, design: s.design || { blocks: [] } })) : [newStep(brand, true)],
    });
    setStep(0);
    setEditing(a);
    setMsg(null);
  };

  const patchStep = (i, patch) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, newStep(brand, false)] }));
  const removeStep = (i) =>
    setForm((f) => {
      const steps = f.steps.filter((_, idx) => idx !== i);
      return { ...f, steps: steps.length ? steps : [newStep(brand, true)] };
    });

  const persist = async () => {
    if (!form.nom.trim()) { setMsg({ type: "err", text: "Donnez un nom à l'automatisation." }); return null; }
    const payload = {
      nom: form.nom.trim(),
      description: form.description,
      trigger: { type: form.triggerType },
      steps: form.steps,
    };
    if (editing?._id) {
      const up = await updateAutomation({ id: editing._id, ...payload }).unwrap();
      setEditing(up);
      return up;
    }
    const created = await createAutomation({ entrepriseId, ...payload }).unwrap();
    setEditing(created);
    return created;
  };

  const onSave = async () => {
    setMsg(null);
    try { await persist(); setMsg({ type: "ok", text: "Automatisation enregistrée." }); }
    catch (e) { setMsg({ type: "err", text: e?.data?.message || e.message }); }
  };

  const onTest = async () => {
    setMsg(null);
    const emails = parseEmails(testText);
    if (!emails.length) { setMsg({ type: "err", text: "Saisissez au moins un email de test." }); return; }
    try {
      const a = await persist();
      if (!a) return;
      const r = await testAutomation({ id: a._id, emails }).unwrap();
      setMsg({ type: "ok", text: `Test envoyé : ${r.steps} étape(s) × ${emails.length} adresse(s) (${r.sent} ok, ${r.failed} échec).` });
    } catch (e) { setMsg({ type: "err", text: e?.data?.message || e.message }); }
  };

  const onAddManual = async () => {
    setMsg(null);
    const contacts = parseContacts(contactsText);
    if (!contacts.length) { setMsg({ type: "err", text: "Aucun email valide (format : email, nom par ligne)." }); return; }
    try {
      const a = await persist();
      if (!a) return;
      const r = await addContacts({ id: a._id, contacts }).unwrap();
      setContactsText("");
      setMsg({ type: "ok", text: `${r.added} contact(s) ajouté(s)${r.skipped ? `, ${r.skipped} déjà présent(s)` : ""}${r.invalid ? `, ${r.invalid} invalide(s)` : ""}. ${a.active ? "Emails de bienvenue en cours d'envoi." : "Activez l'automatisation pour lancer les envois."}` });
    } catch (e) { setMsg({ type: "err", text: e?.data?.message || e.message }); }
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    try {
      const a = await persist();
      if (!a) return;
      const r = await importContacts({ id: a._id, file }).unwrap();
      setMsg({ type: "ok", text: `Fichier importé : ${r.parsed} ligne(s), ${r.added} ajouté(s)${r.skipped ? `, ${r.skipped} déjà présent(s)` : ""}${r.invalid ? `, ${r.invalid} invalide(s)` : ""}. ${a.active ? "Envois en cours." : "Activez l'automatisation pour lancer les envois."}` });
    } catch (e2) { setMsg({ type: "err", text: e2?.data?.message || e2.message }); }
  };

  const onActivate = async (a) => {
    const conf =
      a.trigger?.type === "liste"
        ? "Activer cette automatisation ?\n\nLes contacts ajoutés/importés à la liste recevront la séquence de bienvenue (vrais emails)."
        : "Activer cette automatisation ?\n\nLes clients EXISTANTS ne recevront rien. Seuls les NOUVEAUX clients détectés après activation entreront dans le parcours.";
    if (!window.confirm(conf)) return;
    try {
      const r = await activateAutomation(a._id).unwrap();
      setMsg({ type: "ok", text: `Activée. ${r.seeded} contacts existants marqués (non recontactés).` });
    } catch (e) { alert(e?.data?.message || "Activation impossible"); }
  };
  const onDeactivate = async (a) => {
    try { await deactivateAutomation(a._id).unwrap(); } catch (e) { alert(e?.data?.message || "Erreur"); }
  };
  const onDelete = async (a) => {
    if (!window.confirm(`Supprimer l'automatisation « ${a.nom} » ?`)) return;
    try { await deleteAutomation(a._id).unwrap(); } catch (e) { alert(e?.data?.message || "Suppression impossible"); }
  };

  // ── Éditeur ──
  if (editing) {
    const s = form.steps[Math.min(step, form.steps.length - 1)];
    const si = Math.min(step, form.steps.length - 1);
    return (
      <div>
        <div className="ml-head">
          <button className="ml-back" onClick={() => setEditing(null)}><HiArrowLeft /> Automatisations</button>
          <div className="ml-editor-actions">
            <button className="ml-ghost" onClick={onSave}>Enregistrer</button>
          </div>
        </div>
        {msg && <div className={`ml-msg ml-msg--${msg.type}`}>{msg.text}</div>}

        <div className="ml-card ml-block">
          <div className="ml-fields">
            <label>Nom de l'automatisation<input value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} placeholder="Ex : Email de bienvenue" /></label>
            <label>Description<input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Ex : accueil des nouveaux clients" /></label>
            <label>Déclencheur
              <select className="ml-select" value={form.triggerType} onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value }))}>
                {Object.entries(TRIGGERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Parcours : étapes */}
        <div className="ml-card ml-block">
          <div className="ml-section-title">Parcours ({form.steps.length} étape{form.steps.length > 1 ? "s" : ""})</div>
          <div className="auto-steps">
            {form.steps.map((st, i) => (
              <div key={i} className={`auto-step ${si === i ? "on" : ""}`} onClick={() => setStep(i)}>
                <div className="auto-step-delay"><HiClock /> {st.delayDays ? `J+${st.delayDays}` : "Immédiat"}</div>
                <div className="auto-step-name">Étape {i + 1}</div>
                <div className="auto-step-subj">{st.subject || "(sans objet)"}</div>
                {form.steps.length > 1 && (
                  <button className="auto-step-del" onClick={(e) => { e.stopPropagation(); removeStep(i); if (step >= i) setStep(Math.max(0, step - 1)); }}><HiTrash /></button>
                )}
              </div>
            ))}
            <button className="auto-step-add" onClick={addStep}><HiPlus /> Ajouter une étape</button>
          </div>
        </div>

        {/* Édition de l'étape sélectionnée */}
        <div className="ml-card ml-block">
          <div className="ml-section-title">Étape {si + 1}</div>
          <div className="ml-fields">
            <SpamCheckField label="Objet de l'email" value={s.subject} onChange={(v) => patchStep(si, { subject: v })} placeholder="Ex : Bienvenue chez nous" />
            <label>Délai avant envoi (jours après l'étape précédente)<input type="number" min="0" value={s.delayDays} onChange={(e) => patchStep(si, { delayDays: parseInt(e.target.value, 10) || 0 })} /></label>
          </div>
          <div style={{ marginTop: 12 }}>
            <MailBlockDesigner value={s.design} onChange={(design) => patchStep(si, { design })} brand={brand} />
          </div>
        </div>

        {/* Contacts (mode liste) */}
        {form.triggerType === "liste" && (
          <div className="ml-card ml-block">
            <div className="ml-section-title">Contacts de la liste</div>
            <div className="ml-muted" style={{ marginBottom: 10 }}>
              Ajoutez des clients (email + nom). Chaque NOUVEAU contact ajouté reçoit la séquence de bienvenue{editing?.active ? "" : " dès que l'automatisation est activée"}.
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={onImportFile} />
            <button className="ml-ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
              <HiUpload /> {importing ? "Import…" : "Importer un fichier CSV / Excel"}
            </button>
            <div className="ml-muted" style={{ margin: "8px 0" }}>Colonnes attendues : <b>email</b> et <b>nom</b>.</div>
            <div className="seg-sub">Ou ajout manuel (un par ligne : <code>email, nom</code>)</div>
            <textarea className="ml-textarea" rows={3} value={contactsText} onChange={(e) => setContactsText(e.target.value)} placeholder={"client@exemple.nc, Quincaillerie Untel\nautre@exemple.nc, Client Deux"} />
            <button className="ml-ghost" onClick={onAddManual}><HiUserAdd /> Ajouter à la liste</button>
          </div>
        )}

        {/* Test */}
        <div className="ml-card ml-block">
          <div className="ml-section-title">Tester l'automatisation</div>
          <div className="ml-muted" style={{ marginBottom: 8 }}>Envoie toutes les étapes immédiatement aux adresses ci-dessous (jamais la base clients).</div>
          <textarea className="ml-textarea" rows={2} value={testText} onChange={(e) => setTestText(e.target.value)} />
          <button className="ml-ghost" onClick={onTest} disabled={testing}><HiPaperAirplane /> {testing ? "Envoi…" : "Envoyer un test"}</button>
        </div>
      </div>
    );
  }

  // ── Liste ──
  return (
    <div>
      <div className="ml-head">
        <h1><HiLightningBolt /> Automatisations</h1>
        <button className="ml-primary" onClick={openNew} disabled={!entrepriseId}><HiPlus /> Nouvelle automatisation</button>
      </div>
      <div className="auto-note"><HiExclamation /> Une automatisation active enverra de VRAIS emails aux nouveaux clients détectés. Les clients déjà présents à l'activation ne sont jamais recontactés.</div>
      {!entrepriseId && <div className="ml-hint">Sélectionnez une société dans l'en-tête.</div>}
      {automations.length === 0 ? (
        <div className="ml-empty">Aucune automatisation. Créez un « email de bienvenue » pour accueillir vos nouveaux clients.</div>
      ) : (
        <div className="ml-list">
          {automations.map((a) => (
            <div key={a._id} className="ml-card">
              <div className="ml-card-main" onClick={() => openEdit(a)}>
                <div className="ml-card-top">
                  <span className="ml-card-name">{a.nom}</span>
                  <span className={`ml-status ${a.active ? "ml-status--en_cours" : ""}`}>{a.active ? "Active" : "Inactive"}</span>
                </div>
                <div className="ml-card-sub">
                  {TRIGGERS[a.trigger?.type] || a.trigger?.type} · {a.steps?.length || 0} étape(s)
                  {" · "}{a.enrolledCount || 0} inscrit(s) · {a.sentCount || 0} envoyé(s)
                </div>
              </div>
              <div className="ml-card-actions">
                {a.active ? (
                  <button title="Désactiver" onClick={() => onDeactivate(a)}><HiPause /></button>
                ) : (
                  <button title="Activer" onClick={() => onActivate(a)}><HiPlay /></button>
                )}
                <button title="Supprimer" onClick={() => onDelete(a)}><HiTrash /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MailAutomations;
