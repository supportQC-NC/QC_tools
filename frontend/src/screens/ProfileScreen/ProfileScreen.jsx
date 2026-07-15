// src/screens/ProfileScreen/ProfileScreen.jsx
import React, { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import {
  useGetProfileQuery,
  useUpdateProfileMutation,
} from "../../slices/userApiSlice";
import {
  useGetReportOptionsQuery,
  useGetMySubscriptionsQuery,
  useTestConfigMutation,
  useCreateSubscriptionMutation,
  useDeleteSubscriptionMutation,
  useUpdateSubscriptionMutation,
  useTestSubscriptionMutation,
} from "../../slices/reportSubscriptionApiSlice";
import { setCredentials } from "../../slices/authSlice";
import "./ProfileScreen.css";

const JOURS = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

const PERIODE_LABELS = {
  jour_precedent: "Jour précédent (veille)",
  jour_meme: "Jour même",
  semaine_precedente: "Semaine précédente",
  semaine_en_cours: "Semaine en cours",
  mois_precedent: "Mois précédent",
  mois_en_cours: "Mois en cours",
  actuel: "État actuel",
};

const pad2 = (n) => String(n).padStart(2, "0");

const resumePlanning = (s) => {
  const heure = `${pad2(s.heure)}h${pad2(s.minute)}`;
  if (s.frequence === "journalier") return `Chaque jour à ${heure}`;
  if (s.frequence === "hebdomadaire")
    return `Chaque ${JOURS[s.jourDeSemaine] || "?"} à ${heure}`;
  return `Le ${s.jourDuMois} de chaque mois à ${heure}`;
};

const FREQ_LABELS = {
  journalier: "Journalière",
  hebdomadaire: "Hebdomadaire",
  mensuel: "Mensuelle",
};

// ISO -> "JJ/MM à HHhMM"
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} à ${pad2(d.getHours())}h${pad2(d.getMinutes())}`;
};

// ── Petites icônes SVG (aucune dépendance) ──────────────────────────────────
const IconUser = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconMail = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 5L2 7" />
  </svg>
);
const IconInbox = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const ProfileScreen = () => {
  const dispatch = useDispatch();

  // ─────────────────────────── Profil ───────────────────────────
  const { data: profile } = useGetProfileQuery();
  const [updateProfile, { isLoading: savingProfile }] =
    useUpdateProfileMutation();

  const [form, setForm] = useState({
    nom: "",
    prenom: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [profileMsg, setProfileMsg] = useState(null);

  useMemo(() => {
    if (profile) {
      setForm((f) => ({
        ...f,
        nom: profile.nom || "",
        prenom: profile.prenom || "",
        email: profile.email || "",
      }));
    }
  }, [profile]);

  const onField = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submitProfile = async (e) => {
    e.preventDefault();
    setProfileMsg(null);
    if (form.password && form.password !== form.confirm) {
      setProfileMsg({ type: "error", text: "Les mots de passe ne correspondent pas." });
      return;
    }
    try {
      const payload = { nom: form.nom, prenom: form.prenom, email: form.email };
      if (form.password) payload.password = form.password;
      const updated = await updateProfile(payload).unwrap();
      dispatch(setCredentials(updated));
      setForm((f) => ({ ...f, password: "", confirm: "" }));
      setProfileMsg({ type: "success", text: "Profil mis à jour." });
    } catch (err) {
      setProfileMsg({
        type: "error",
        text: err?.data?.message || "Erreur lors de la mise à jour.",
      });
    }
  };

  // ─────────────────────────── Rapports ───────────────────────────
  const { data: options } = useGetReportOptionsQuery();
  const { data: subscriptions } = useGetMySubscriptionsQuery();
  const [testConfig, { isLoading: testingConfig }] = useTestConfigMutation();
  const [createSub, { isLoading: creating }] = useCreateSubscriptionMutation();
  const [deleteSub] = useDeleteSubscriptionMutation();
  const [updateSub] = useUpdateSubscriptionMutation();
  const [testSub, { isLoading: testing }] = useTestSubscriptionMutation();

  const reports = options?.reports || [];
  const entreprises = options?.entreprises || [];
  const showReports = reports.length > 0;

  const [sub, setSub] = useState({
    reportKey: "",
    entreprise: "",
    frequence: "mensuel",
    jourDuMois: 2,
    jourDeSemaine: 1,
    heure: 12,
    minute: 0,
    periode: "",
    emailDestination: "",
  });
  const [subMsg, setSubMsg] = useState(null);
  const [testingId, setTestingId] = useState(null);

  const selectedReport = reports.find((r) => r.key === sub.reportKey);
  const periodes = selectedReport?.periodes || [];

  const onSub = (k) => (e) => setSub((s) => ({ ...s, [k]: e.target.value }));

  // Choix du rapport : règle aussi la période par défaut (dropdown jamais vide).
  const onReport = (e) => {
    const key = e.target.value;
    const r = reports.find((x) => x.key === key);
    setSub((s) => ({ ...s, reportKey: key, periode: r?.periodeDefaut || "" }));
  };

  const buildPayload = () => ({
    reportKey: sub.reportKey,
    entreprise: sub.entreprise,
    frequence: sub.frequence,
    jourDuMois: Number(sub.jourDuMois),
    jourDeSemaine: Number(sub.jourDeSemaine),
    heure: Number(sub.heure),
    minute: Number(sub.minute),
    periode: sub.periode || selectedReport?.periodeDefaut,
    emailDestination: sub.emailDestination.trim(),
  });

  const submitSub = async (e) => {
    e.preventDefault();
    setSubMsg(null);
    if (!sub.reportKey || !sub.entreprise) {
      setSubMsg({ type: "error", text: "Choisissez un rapport et une entreprise." });
      return;
    }
    try {
      await createSub(buildPayload()).unwrap();
      setSubMsg({ type: "success", text: "Abonnement créé." });
      setSub((s) => ({ ...s, emailDestination: "" }));
    } catch (err) {
      setSubMsg({
        type: "error",
        text: err?.data?.message || "Erreur lors de la création.",
      });
    }
  };

  // Test à la volée AVANT création.
  const onTestConfig = async () => {
    setSubMsg(null);
    if (!sub.reportKey || !sub.entreprise) {
      setSubMsg({ type: "error", text: "Choisissez un rapport et une entreprise." });
      return;
    }
    try {
      await testConfig({
        reportKey: sub.reportKey,
        entreprise: sub.entreprise,
        periode: sub.periode || selectedReport?.periodeDefaut,
        emailDestination: sub.emailDestination.trim(),
      }).unwrap();
      setSubMsg({ type: "success", text: "Rapport de test envoyé, vérifiez votre boîte mail." });
    } catch (err) {
      setSubMsg({
        type: "error",
        text: err?.data?.message || "Échec de l'envoi de test.",
      });
    }
  };

  const onTest = async (id) => {
    setSubMsg(null);
    setTestingId(id);
    try {
      await testSub(id).unwrap();
      setSubMsg({ type: "success", text: "Rapport de test envoyé." });
    } catch (err) {
      setSubMsg({
        type: "error",
        text: err?.data?.message || "Échec de l'envoi de test.",
      });
    } finally {
      setTestingId(null);
    }
  };

  const onToggle = async (s) => {
    try {
      await updateSub({ id: s._id, actif: !s.actif }).unwrap();
    } catch (_) {
      /* silencieux */
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("Supprimer cet abonnement ?")) return;
    try {
      await deleteSub(id).unwrap();
    } catch (_) {
      /* silencieux */
    }
  };

  // ── Éléments d'affichage du bandeau ──
  const initials =
    ((profile?.prenom?.[0] || "") + (profile?.nom?.[0] || "")).toUpperCase() ||
    (profile?.email?.[0] || "?").toUpperCase();
  const fullName = [profile?.prenom, profile?.nom].filter(Boolean).join(" ");
  const roleLabel = profile?.isSuperAdmin
    ? "Super Admin"
    : profile?.isAdmin
      ? "Admin"
      : typeof profile?.role === "string" && profile.role
        ? profile.role
        : "Utilisateur";

  return (
    <div className="profile-page">
      {/* ─── Bandeau de profil ─── */}
      <div className="profile-hero">
        <div className="profile-avatar">{initials}</div>
        <div className="profile-hero-info">
          <h1 className="profile-hero-name">{fullName || "Mon profil"}</h1>
          {profile?.email && (
            <div className="profile-hero-email">{profile.email}</div>
          )}
        </div>
        <span className="profile-role">{roleLabel}</span>
      </div>

      <div className="profile-columns">
        {/* ─── Carte : informations du compte ─── */}
        <section className="profile-card profile-card-account">
          <div className="card-head">
            <span className="card-head-icon"><IconUser /></span>
            <h2>Informations du compte</h2>
          </div>
          {profileMsg && (
            <div className={`profile-banner ${profileMsg.type}`}>
              {profileMsg.text}
            </div>
          )}
          <form onSubmit={submitProfile} className="profile-form">
            <div className="profile-grid">
              <div className="form-group">
                <label>Prénom</label>
                <input value={form.prenom} onChange={onField("prenom")} />
              </div>
              <div className="form-group">
                <label>Nom</label>
                <input value={form.nom} onChange={onField("nom")} />
              </div>
              <div className="form-group full">
                <label>Email</label>
                <input type="email" value={form.email} onChange={onField("email")} />
              </div>
              <div className="form-group">
                <label>Nouveau mot de passe</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={onField("password")}
                  placeholder="Laisser vide pour ne pas changer"
                />
              </div>
              <div className="form-group">
                <label>Confirmer</label>
                <input
                  type="password"
                  value={form.confirm}
                  onChange={onField("confirm")}
                  placeholder="Confirmer le mot de passe"
                />
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={savingProfile}>
              {savingProfile ? "Enregistrement..." : "Enregistrer"}
            </button>
          </form>
        </section>

        {/* ─── Carte : abonnements aux rapports ─── */}
        {showReports && (
          <section className="profile-card profile-card-reports">
            <div className="card-head">
              <span className="card-head-icon"><IconMail /></span>
              <h2>Rapports par email</h2>
            </div>
            <p className="profile-sub">
              Recevez automatiquement des rapports Excel dans votre boîte mail selon
              la planification de votre choix.
            </p>

            {subMsg && (
              <div className={`profile-banner ${subMsg.type}`}>{subMsg.text}</div>
            )}

            {entreprises.length === 0 ? (
              <div className="profile-banner error">
                Aucune entreprise ne vous est attribuée pour ces rapports.
              </div>
            ) : (
              <form onSubmit={submitSub} className="profile-form">
                <div className="profile-grid">
                  <div className="form-group">
                    <label>Rapport</label>
                    <select value={sub.reportKey} onChange={onReport}>
                      <option value="">— Choisir —</option>
                      {reports.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Entreprise</label>
                    <select value={sub.entreprise} onChange={onSub("entreprise")}>
                      <option value="">— Choisir —</option>
                      {entreprises.map((e) => (
                        <option key={e._id} value={e._id}>
                          {e.nom || e.nomDossierDBF}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Fréquence</label>
                    <select value={sub.frequence} onChange={onSub("frequence")}>
                      <option value="journalier">Journalière</option>
                      <option value="hebdomadaire">Hebdomadaire</option>
                      <option value="mensuel">Mensuelle</option>
                    </select>
                  </div>

                  {sub.frequence === "mensuel" && (
                    <div className="form-group">
                      <label>Jour du mois (1–28)</label>
                      <input
                        type="number"
                        min="1"
                        max="28"
                        value={sub.jourDuMois}
                        onChange={onSub("jourDuMois")}
                      />
                    </div>
                  )}
                  {sub.frequence === "hebdomadaire" && (
                    <div className="form-group">
                      <label>Jour de la semaine</label>
                      <select value={sub.jourDeSemaine} onChange={onSub("jourDeSemaine")}>
                        {JOURS.map((j, i) => (
                          <option key={i} value={i}>
                            {j}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {sub.frequence === "journalier" && (
                    <div className="form-group">
                      <label>&nbsp;</label>
                      <span className="daily-note">Envoi tous les jours</span>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Heure</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={sub.heure}
                      onChange={onSub("heure")}
                    />
                  </div>
                  <div className="form-group">
                    <label>Minute</label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={sub.minute}
                      onChange={onSub("minute")}
                    />
                  </div>

                  <div className="form-group">
                    <label>Données</label>
                    <select
                      value={sub.periode}
                      onChange={onSub("periode")}
                      disabled={!selectedReport}
                    >
                      {!selectedReport && (
                        <option value="">Choisissez d'abord un rapport</option>
                      )}
                      {periodes.map((p) => (
                        <option key={p} value={p}>
                          {PERIODE_LABELS[p] || p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group full">
                    <label>Email de destination (optionnel)</label>
                    <input
                      type="email"
                      value={sub.emailDestination}
                      onChange={onSub("emailDestination")}
                      placeholder={profile?.email || "votre email par défaut"}
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn-primary" disabled={creating}>
                    {creating ? "Création..." : "Créer l'abonnement"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={onTestConfig}
                    disabled={testingConfig}
                  >
                    {testingConfig ? "Envoi..." : "Tester l'envoi maintenant"}
                  </button>
                </div>
              </form>
            )}

            {/* Liste des abonnements existants */}
            <div className="sub-section-title">Mes abonnements</div>
            {subscriptions?.length > 0 ? (
              <div className="sub-list">
                {subscriptions.map((s) => (
                  <div key={s._id} className={`sub-item ${s.actif ? "" : "paused"}`}>
                    <div className="sub-head">
                      <div className="sub-report-wrap">
                        <span className="sub-report">
                          {reports.find((r) => r.key === s.reportKey)?.label ||
                            s.reportKey}
                        </span>
                        <span className="sub-ent">
                          {s.entreprise?.nom || s.entreprise?.nomDossierDBF || "—"}
                        </span>
                      </div>
                      <span className="sub-freq-pill">
                        {FREQ_LABELS[s.frequence] || s.frequence}
                      </span>
                    </div>

                    <div className="sub-details">
                      <div className="sub-line">
                        <span className="sub-key">Planning</span>
                        {resumePlanning(s)}
                      </div>
                      <div className="sub-line">
                        <span className="sub-key">Données</span>
                        {PERIODE_LABELS[s.periode] || s.periode}
                      </div>
                      <div className="sub-line">
                        <span className="sub-key">Envoi à</span>
                        <span className="sub-email">
                          {s.emailDestination || profile?.email || "votre adresse"}
                        </span>
                      </div>
                      {s.actif && s.nextRunAt && (
                        <div className="sub-line">
                          <span className="sub-key">Prochain</span>
                          {fmtDateTime(s.nextRunAt)}
                        </div>
                      )}
                    </div>

                    <div className="sub-foot">
                      <div className="sub-meta">
                        {s.lastRun?.at && (
                          <span
                            className={`sub-badge ${
                              s.lastRun.status === "success" ? "ok" : "ko"
                            }`}
                            title={s.lastRun.message}
                          >
                            {s.lastRun.status === "success"
                              ? "Dernier envoi OK"
                              : "Dernier envoi en échec"}
                          </span>
                        )}
                        {!s.actif && <span className="sub-badge paused">En pause</span>}
                      </div>
                      <div className="sub-actions">
                        <button
                          className="btn-mini"
                          onClick={() => onTest(s._id)}
                          disabled={testing && testingId === s._id}
                        >
                          {testing && testingId === s._id ? "Envoi..." : "Tester"}
                        </button>
                        <button className="btn-mini" onClick={() => onToggle(s)}>
                          {s.actif ? "Pause" : "Activer"}
                        </button>
                        <button
                          className="btn-mini danger"
                          onClick={() => onDelete(s._id)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sub-empty">
                <IconInbox />
                <span>Aucun abonnement pour l'instant.</span>
                <small>Créez-en un ci-dessus pour recevoir vos rapports par email.</small>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default ProfileScreen;