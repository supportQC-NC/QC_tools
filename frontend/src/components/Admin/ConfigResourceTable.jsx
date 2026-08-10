import React, { useMemo, useRef, useState } from "react";
import {
  HiPlus,
  HiPencil,
  HiTrash,
  HiX,
  HiCheck,
  HiTable,
  HiUpload,
} from "react-icons/hi";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import {
  useGetConfigResourceQuery,
  useCreateConfigResourceMutation,
  useUpdateConfigResourceMutation,
  useDeleteConfigResourceMutation,
  useImportConfigResourceMutation,
} from "../../slices/configRapportsApiSlice";
import { BASE_URL } from "../../constants";
import "../../screens/admin/ConfigRapportsScreen.css";

// Table CRUD générique d'une ressource de config rapports, embarquée dans la
// config entreprise. `scoped` -> filtrée + rattachée à `entrepriseId`.
// type de champ : text | number | bool | mails (array<->";") | user
//                 | readonly-number | readonly-date (affichés, non saisissables)
// `extraActions` : noeud rendu à côté du bouton « Ajouter ».
const userLabel = (u) =>
  u ? `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "—" : "—";

const displayValue = (item, field) => {
  const v = item[field.name];
  if (field.type === "bool") return v ? "✓" : "";
  if (field.type === "mails") return Array.isArray(v) ? v.join(" ; ") : "";
  if (field.type === "user") return item.user ? userLabel(item.user) : "—";
  if (field.type === "readonly-number") {
    return v == null ? "—" : Number(v).toLocaleString("fr-FR");
  }
  if (field.type === "readonly-date") {
    return v ? new Date(v).toLocaleDateString("fr-FR") : "—";
  }
  return v == null ? "" : String(v);
};

// Champs non saisissables : exclus du formulaire et du corps envoyé à l'API.
const isReadOnly = (f) =>
  f.type === "readonly-number" || f.type === "readonly-date";

const ConfigResourceTable = ({
  resource,
  fields,
  scoped,
  entrepriseId,
  label,
  extraActions = null,
  excel = false,
}) => {
  const fileRef = useRef(null);
  const [importRes, { isLoading: importing }] = useImportConfigResourceMutation();
  const [exportEnCours, setExportEnCours] = useState(false);
  const [excelMsg, setExcelMsg] = useState(null); // { ok, message }
  const { data: usersData } = useGetUsersQuery();
  const users = useMemo(
    () => (Array.isArray(usersData) ? usersData : usersData?.users || []),
    [usersData],
  );

  const { data: items = [], isFetching } = useGetConfigResourceQuery(
    { resource, entrepriseId: scoped ? entrepriseId : undefined },
    { skip: scoped && !entrepriseId },
  );

  const [createRes, { isLoading: creating }] = useCreateConfigResourceMutation();
  const [updateRes, { isLoading: updating }] = useUpdateConfigResourceMutation();
  const [deleteRes] = useDeleteConfigResourceMutation();

  const [modal, setModal] = useState(null); // { mode, item } | null
  const [form, setForm] = useState({});
  const [error, setError] = useState("");

  // Champs réellement éditables (le reste n'est qu'affiché dans la table).
  const editableFields = useMemo(() => fields.filter((f) => !isReadOnly(f)), [fields]);

  const openCreate = () => {
    const blank = {};
    editableFields.forEach((f) => {
      blank[f.name] = f.type === "bool" ? false : "";
    });
    setForm(blank);
    setError("");
    setModal({ mode: "create" });
  };

  const openEdit = (item) => {
    const f = {};
    editableFields.forEach((fld) => {
      const v = item[fld.name];
      if (fld.type === "mails") f[fld.name] = Array.isArray(v) ? v.join("; ") : "";
      else if (fld.type === "user") f[fld.name] = item.user?._id || "";
      else if (fld.type === "bool") f[fld.name] = !!v;
      else f[fld.name] = v == null ? "" : v;
    });
    setForm(f);
    setError("");
    setModal({ mode: "edit", item });
  };

  const setField = (name, value) => setForm((p) => ({ ...p, [name]: value }));

  const buildBody = () => {
    const body = {};
    for (const fld of editableFields) {
      const v = form[fld.name];
      if (fld.type === "number") {
        body[fld.name] = v === "" || v == null ? null : Number(v);
      } else if (fld.type === "bool") {
        body[fld.name] = !!v;
      } else if (fld.type === "mails") {
        body[fld.name] = String(v || "")
          .split(/[;,\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (fld.type === "user") {
        body[fld.name] = v || null;
      } else {
        body[fld.name] = v ?? "";
      }
    }
    // société fixée pour les ressources scopées
    if (scoped && entrepriseId) body.entreprise = entrepriseId;
    return body;
  };

  const save = async () => {
    setError("");
    for (const fld of editableFields) {
      if (fld.required) {
        const v = form[fld.name];
        if (v === "" || v == null) {
          setError(`Champ requis : ${fld.label}`);
          return;
        }
      }
    }
    try {
      const body = buildBody();
      if (modal.mode === "create") {
        await createRes({ resource, body }).unwrap();
      } else {
        await updateRes({ resource, id: modal.item._id, body }).unwrap();
      }
      setModal(null);
    } catch (e) {
      setError(e?.data?.message || "Enregistrement impossible (doublon ?).");
    }
  };

  // Télécharge le classeur de la liste (cookie d'auth -> fetch credentials).
  const exporterExcel = async () => {
    setExcelMsg(null);
    setExportEnCours(true);
    try {
      const qs = entrepriseId ? `?entrepriseId=${entrepriseId}` : "";
      const url = `${BASE_URL}/api/config-rapports/${resource}/export${qs}`;
      const rep = await fetch(url, { credentials: "include" });
      if (!rep.ok) {
        let msg = `Export échoué (${rep.status})`;
        try {
          const j = await rep.json();
          if (j?.message) msg = j.message;
        } catch {
          /* réponse non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await rep.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${resource}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      setExcelMsg({ ok: false, message: e.message || "Export impossible." });
    } finally {
      setExportEnCours(false);
    }
  };

  const importerExcel = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de réimporter le même fichier
    if (!file) return;
    setExcelMsg(null);
    try {
      const r = await importRes({ resource, file, entrepriseId }).unwrap();
      setExcelMsg({ ok: true, message: r.message, detail: r.erreurs });
    } catch (err) {
      setExcelMsg({
        ok: false,
        message: err?.data?.message || "Import impossible.",
      });
    }
  };

  const remove = async (item) => {
    if (!window.confirm("Supprimer cet enregistrement ?")) return;
    try {
      await deleteRes({ resource, id: item._id }).unwrap();
    } catch {
      /* ignore */
    }
  };

  if (scoped && !entrepriseId) {
    return (
      <p className="cr-td-info">
        Enregistrez d'abord l'entreprise pour gérer cette section.
      </p>
    );
  }

  return (
    <div className="cr-embed">
      <div className="cr-content-head">
        <h2>{label}</h2>
        <div className="cr-head-actions">
          <button className="cr-btn cr-btn-add" onClick={openCreate}>
            <HiPlus /> Ajouter
          </button>
          {excel && (
            <>
              <button
                type="button"
                className="cr-btn cr-btn-scan"
                onClick={exporterExcel}
                disabled={exportEnCours}
                title="Télécharger la liste en Excel pour la compléter"
              >
                <HiTable /> {exportEnCours ? "Export…" : "Exporter Excel"}
              </button>
              <button
                type="button"
                className="cr-btn cr-btn-scan"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                title="Réimporter le fichier complété (aucune suppression)"
              >
                <HiUpload /> {importing ? "Import…" : "Importer Excel"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm"
                onChange={importerExcel}
                style={{ display: "none" }}
              />
            </>
          )}
          {extraActions}
        </div>
      </div>

      {excelMsg && (
        <div className={`cr-excel-msg ${excelMsg.ok ? "ok" : "ko"}`}>
          <span>{excelMsg.message}</span>
          {excelMsg.detail?.length > 0 && (
            <ul>
              {excelMsg.detail.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="cr-table-wrap">
        <table className="cr-table">
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f.name}>{f.label}</th>
              ))}
              <th className="cr-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isFetching ? (
              <tr>
                <td colSpan={fields.length + 1} className="cr-td-info">
                  Chargement…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 1} className="cr-td-info">
                  Aucun enregistrement.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item._id}>
                  {fields.map((f) => (
                    <td key={f.name} className={f.type === "bool" ? "cr-bool" : ""}>
                      {f.type === "bool" ? (
                        item[f.name] ? (
                          <HiCheck className="cr-check" />
                        ) : (
                          ""
                        )
                      ) : (
                        displayValue(item, f)
                      )}
                    </td>
                  ))}
                  <td className="cr-actions-col">
                    <button
                      className="cr-icon-btn"
                      title="Modifier"
                      onClick={() => openEdit(item)}
                    >
                      <HiPencil />
                    </button>
                    <button
                      className="cr-icon-btn cr-danger"
                      title="Supprimer"
                      onClick={() => remove(item)}
                    >
                      <HiTrash />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="cr-count">{items.length} enregistrement(s)</p>

      {modal && (
        <div className="cr-modal-overlay" onClick={() => setModal(null)}>
          <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cr-modal-head">
              <h3>
                {modal.mode === "create" ? "Ajouter" : "Modifier"} — {label}
              </h3>
              <button className="cr-icon-btn" onClick={() => setModal(null)}>
                <HiX />
              </button>
            </div>
            <div className="cr-modal-body">
              {editableFields.map((f) => (
                <div key={f.name} className="cr-field">
                  <label>
                    {f.label}
                    {f.required && <span className="cr-req"> *</span>}
                  </label>
                  {f.type === "bool" ? (
                    <input
                      type="checkbox"
                      checked={!!form[f.name]}
                      onChange={(e) => setField(f.name, e.target.checked)}
                    />
                  ) : f.type === "user" ? (
                    <select
                      value={form[f.name] || ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                    >
                      <option value="">— aucun —</option>
                      {users.map((u) => (
                        <option key={u._id} value={u._id}>
                          {userLabel(u)}
                          {u.email ? ` (${u.email})` : ""}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "number" ? (
                    <input
                      type="number"
                      value={form[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                    />
                  ) : f.type === "mails" ? (
                    <input
                      type="text"
                      placeholder="email1@x.nc ; email2@x.nc"
                      value={form[f.name] || ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      value={form[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                    />
                  )}
                </div>
              ))}
              {error && <div className="cr-modal-err">{error}</div>}
            </div>
            <div className="cr-modal-foot">
              <button className="cr-btn cr-btn-ghost" onClick={() => setModal(null)}>
                Annuler
              </button>
              <button
                className="cr-btn cr-btn-save"
                onClick={save}
                disabled={creating || updating}
              >
                {creating || updating ? "…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfigResourceTable;
