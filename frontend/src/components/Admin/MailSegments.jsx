// src/components/Admin/MailSegments.jsx
//
// Gestion des SEGMENTS de clients : nom + description + cible (catégories /
// professions du DBF ET/OU emails importés en masse via CSV). Réutilisables pour
// cibler des campagnes. Scopé par société (entrepriseId).
import React, { useState } from "react";
import {
  HiPlus,
  HiTrash,
  HiPencil,
  HiSearch,
  HiUserGroup,
  HiArrowLeft,
} from "react-icons/hi";
import {
  useGetSegmentsQuery,
  useCreateSegmentMutation,
  useUpdateSegmentMutation,
  useDeleteSegmentMutation,
  useGetSegmentCountQuery,
} from "../../slices/mailingApiSlice";

const parseEmails = (t) => [
  ...new Set(
    String(t || "")
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
];

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

const SegmentCount = ({ id }) => {
  const { data } = useGetSegmentCountQuery(id);
  return <span className="seg-count">{data ? `${data.count} destinataire(s)` : "…"}</span>;
};

const emptyForm = () => ({ nom: "", description: "", categories: [], profes: [], csvText: "" });

const MailSegments = ({ entrepriseId, filters }) => {
  const { data: segments = [] } = useGetSegmentsQuery(entrepriseId, { skip: !entrepriseId });
  const [createSegment] = useCreateSegmentMutation();
  const [updateSegment] = useUpdateSegmentMutation();
  const [deleteSegment] = useDeleteSegmentMutation();

  const [editing, setEditing] = useState(null); // null | {} (new) | segment
  const [form, setForm] = useState(emptyForm());
  const [msg, setMsg] = useState(null);

  const openNew = () => { setForm(emptyForm()); setEditing({}); setMsg(null); };
  const openEdit = (s) => {
    setForm({
      nom: s.nom || "",
      description: s.description || "",
      categories: s.categories || [],
      profes: s.profes || [],
      csvText: (s.csvEmails || []).join("\n"),
    });
    setEditing(s);
    setMsg(null);
  };

  const toggle = (key, code) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(code) ? f[key].filter((c) => c !== code) : [...f[key], code],
    }));

  const save = async () => {
    if (!form.nom.trim()) { setMsg({ type: "err", text: "Donnez un nom au segment." }); return; }
    const payload = {
      nom: form.nom.trim(),
      description: form.description,
      categories: form.categories,
      profes: form.profes,
      csvEmails: parseEmails(form.csvText),
    };
    try {
      if (editing?._id) await updateSegment({ id: editing._id, ...payload }).unwrap();
      else await createSegment({ entrepriseId, ...payload }).unwrap();
      setEditing(null);
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || e.message });
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Supprimer le segment « ${s.nom} » ?`)) return;
    try { await deleteSegment(s._id).unwrap(); } catch (e) { alert(e?.data?.message || "Suppression impossible"); }
  };

  // ── Formulaire ──
  if (editing) {
    const csvCount = parseEmails(form.csvText).length;
    return (
      <div>
        <div className="ml-head">
          <button className="ml-back" onClick={() => setEditing(null)}><HiArrowLeft /> Segments</button>
          <button className="ml-primary" onClick={save}>Enregistrer le segment</button>
        </div>
        {msg && <div className={`ml-msg ml-msg--${msg.type}`}>{msg.text}</div>}

        <div className="ml-card ml-block">
          <div className="ml-fields">
            <label>Nom du segment<input value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} placeholder="Ex : Pros du bâtiment" /></label>
            <label>Description courte<input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Ex : entreprises BTP actives" /></label>
          </div>
        </div>

        <div className="ml-card ml-block">
          <div className="ml-section-title">Cible du segment</div>
          <div className="ml-muted" style={{ marginBottom: 10 }}>
            Combinez les critères : les clients sont filtrés par catégorie/profession, et/ou vous importez une liste d'emails.
          </div>
          <div className="seg-grid">
            <div>
              <div className="seg-sub">Par catégorie</div>
              <CheckList items={filters?.categories} selected={form.categories} onToggle={(c) => toggle("categories", c)} color="#34d399" />
            </div>
            <div>
              <div className="seg-sub">Par profession</div>
              <CheckList items={filters?.professions} selected={form.profes} onToggle={(c) => toggle("profes", c)} color="#c084fc" />
            </div>
          </div>
          <div className="seg-sub" style={{ marginTop: 12 }}>Import CSV / emails en masse ({csvCount})</div>
          <textarea className="ml-textarea" rows={5} value={form.csvText} onChange={(e) => setForm((f) => ({ ...f, csvText: e.target.value }))} placeholder="Un email par ligne (ou séparés par , ou ;)" />
        </div>
      </div>
    );
  }

  // ── Liste ──
  return (
    <div>
      <div className="ml-head">
        <h1><HiUserGroup /> Segments de clients</h1>
        <button className="ml-primary" onClick={openNew} disabled={!entrepriseId}><HiPlus /> Nouveau segment</button>
      </div>
      {!entrepriseId && <div className="ml-hint">Sélectionnez une société dans l'en-tête.</div>}
      {segments.length === 0 ? (
        <div className="ml-empty">Aucun segment. Créez-en un pour cibler vos campagnes.</div>
      ) : (
        <div className="ml-list">
          {segments.map((s) => (
            <div key={s._id} className="ml-card">
              <div className="ml-card-main" onClick={() => openEdit(s)}>
                <div className="ml-card-top">
                  <span className="ml-card-name">{s.nom}</span>
                  <SegmentCount id={s._id} />
                </div>
                <div className="ml-card-sub">
                  {s.description || "—"}
                  {(s.categories?.length || s.profes?.length || s.csvEmails?.length) ? (
                    <span className="seg-tags">
                      {s.categories?.length ? ` · ${s.categories.length} catégorie(s)` : ""}
                      {s.profes?.length ? ` · ${s.profes.length} profession(s)` : ""}
                      {s.csvEmails?.length ? ` · ${s.csvEmails.length} email(s) importé(s)` : ""}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="ml-card-actions">
                <button title="Modifier" onClick={() => openEdit(s)}><HiPencil /></button>
                <button title="Supprimer" onClick={() => remove(s)}><HiTrash /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MailSegments;
