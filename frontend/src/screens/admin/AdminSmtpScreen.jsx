import React, { useState, useEffect } from "react";
import { HiMail } from "react-icons/hi";
import { SMTP_MODULE_SCOPES } from "../../config/smtpScopes";
import {
  useGetSmtpConfigsQuery,
  useSaveSmtpConfigMutation,
  useResetSmtpConfigMutation,
  useTestSmtpConfigMutation,
} from "../../slices/smtpConfigApiSlice";
import "./AdminSmtpScreen.css";

const initForm = (c) => ({
  fromName: c?.fromName || "",
  fromEmail: c?.fromEmail || "",
  host: c?.host || "",
  port: c?.port || "",
  secure: c?.secure || "",
  user: c?.user || "",
});

// ── Carte de configuration d'un scope (global ou module) ─────────────────────
const SmtpCard = ({ scope, label, env, config, isGlobal }) => {
  const [save, { isLoading: saving }] = useSaveSmtpConfigMutation();
  const [reset] = useResetSmtpConfigMutation();
  const [test, { isLoading: testing }] = useTestSmtpConfigMutation();

  const [form, setForm] = useState(initForm(config));
  const [pwd, setPwd] = useState("");
  const [adv, setAdv] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    setForm(initForm(config));
    setPwd("");
  }, [config]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const actif = !!config; // une surcharge existe pour ce scope
  // Placeholders : pour le global on montre les valeurs .env ; pour un module,
  // on indique l'héritage.
  const ph = (field, envVal) =>
    isGlobal ? envVal || "(défaut .env)" : "hérite du global / défaut";

  const doSave = async () => {
    try {
      const body = { scope, ...form };
      if (pwd) body.password = pwd;
      await save(body).unwrap();
      setPwd("");
      setMsg({ type: "ok", text: "Enregistré. Cette configuration prend le dessus sur le .env." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur." });
    }
  };
  const doReset = async () => {
    if (!window.confirm("Réinitialiser ? On revient au paramètre par défaut (.env / global)."))
      return;
    try {
      await reset(scope).unwrap();
      setMsg({ type: "ok", text: "Réinitialisé (retour au défaut)." });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Erreur." });
    }
  };
  const doTest = async () => {
    if (!testEmail.trim()) {
      setMsg({ type: "err", text: "Renseignez une adresse de test." });
      return;
    }
    try {
      const r = await test({ scope, email: testEmail.trim() }).unwrap();
      setMsg({ type: "ok", text: r.message });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Échec du test." });
    }
  };

  return (
    <div className={`smtp-card ${isGlobal ? "global" : ""}`}>
      <div className="smtp-card-head">
        <h2>{label}</h2>
        <span className={`smtp-badge ${actif ? "actif" : "defaut"}`}>
          {actif ? "surcharge active" : "défaut (.env/global)"}
        </span>
      </div>

      {/* From (le plus courant) */}
      <div className="smtp-row">
        <div className="smtp-field">
          <label>Nom expéditeur (From name)</label>
          <input
            value={form.fromName}
            placeholder={ph("fromName", env?.fromName)}
            onChange={(e) => set("fromName", e.target.value)}
          />
        </div>
        <div className="smtp-field">
          <label>Email expéditeur (From email)</label>
          <input
            value={form.fromEmail}
            placeholder={ph("fromEmail", env?.fromEmail)}
            onChange={(e) => set("fromEmail", e.target.value)}
          />
          <div className="smtp-hint">Laisser vide = utilise l'utilisateur SMTP.</div>
        </div>
      </div>

      <button className="smtp-adv-toggle" onClick={() => setAdv((a) => !a)}>
        {adv ? "▼" : "▶"} Serveur SMTP (avancé)
      </button>

      {adv && (
        <>
          <div className="smtp-row">
            <div className="smtp-field">
              <label>Serveur (host)</label>
              <input value={form.host} placeholder={ph("host", env?.host)} onChange={(e) => set("host", e.target.value)} />
            </div>
            <div className="smtp-field">
              <label>Port</label>
              <input value={form.port} placeholder={ph("port", env?.port)} onChange={(e) => set("port", e.target.value)} />
            </div>
            <div className="smtp-field">
              <label>Sécurité</label>
              <select value={form.secure} onChange={(e) => set("secure", e.target.value)}>
                <option value="">Défaut{isGlobal && env ? ` (${env.secure})` : ""}</option>
                <option value="ssl">SSL (465)</option>
                <option value="tls">TLS / STARTTLS (587)</option>
              </select>
            </div>
          </div>
          <div className="smtp-row">
            <div className="smtp-field">
              <label>Utilisateur SMTP</label>
              <input value={form.user} placeholder={ph("user", env?.user)} onChange={(e) => set("user", e.target.value)} />
            </div>
            <div className="smtp-field">
              <label>Mot de passe SMTP</label>
              <input
                type="password"
                value={pwd}
                placeholder={config?.hasPassword ? "•••••• (inchangé)" : "hérite du défaut"}
                onChange={(e) => setPwd(e.target.value)}
              />
              <div className="smtp-hint">Laisser vide = ne pas changer.</div>
            </div>
          </div>
        </>
      )}

      <div className="smtp-actions">
        <button className="smtp-btn primary" onClick={doSave} disabled={saving}>
          Enregistrer
        </button>
        <button className="smtp-btn danger" onClick={doReset} disabled={!actif}>
          Réinitialiser
        </button>
        <div className="smtp-test">
          <input
            placeholder="email de test…"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
          />
          <button className="smtp-btn" onClick={doTest} disabled={testing}>
            {testing ? "Envoi…" : "Tester"}
          </button>
        </div>
      </div>
      {msg && <div className={`smtp-msg ${msg.type}`}>{msg.text}</div>}
    </div>
  );
};

const AdminSmtpScreen = () => {
  const { data, isLoading } = useGetSmtpConfigsQuery();

  if (isLoading || !data) {
    return (
      <div className="smtp-wrap">
        <h1>
          <HiMail /> Paramètres Email (SMTP)
        </h1>
        <p className="smtp-intro">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="smtp-wrap">
      <h1>
        <HiMail /> Paramètres Email (SMTP)
      </h1>
      <div className="smtp-intro">
        Les paramètres du <b>.env</b> restent le <b>défaut</b> (dev &amp; prod) et ne
        sont jamais modifiés ici. Toute valeur saisie ci-dessous <b>prend le dessus</b>{" "}
        : ordre de priorité <b>module &gt; global &gt; .env</b>. Un champ vide = hérité.
      </div>

      <SmtpCard
        scope="global"
        label="SMTP général (global)"
        env={data.env}
        config={data.configs?.global}
        isGlobal
      />

      {SMTP_MODULE_SCOPES.map((s) => (
        <SmtpCard
          key={s.key}
          scope={s.key}
          label={`Module : ${s.label}`}
          env={data.env}
          config={data.configs?.[s.key]}
        />
      ))}
    </div>
  );
};

export default AdminSmtpScreen;
