import React, { useMemo, useState } from "react";
import { HiPlus, HiPencil, HiTrash, HiX, HiCheck } from "react-icons/hi";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import {
  useGetConfigResourceQuery,
  useCreateConfigResourceMutation,
  useUpdateConfigResourceMutation,
  useDeleteConfigResourceMutation,
} from "../../slices/configRapportsApiSlice";
import "../../screens/admin/ConfigRapportsScreen.css";

// Table CRUD générique d'une ressource de config rapports, embarquée dans la
// config entreprise. `scoped` -> filtrée + rattachée à `entrepriseId`.
// type de champ : text | number | bool | mails (array<->";") | user
const userLabel = (u) =>
  u ? `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "—" : "—";

const displayValue = (item, field) => {
  const v = item[field.name];
  if (field.type === "bool") return v ? "✓" : "";
  if (field.type === "mails") return Array.isArray(v) ? v.join(" ; ") : "";
  if (field.type === "user") return item.user ? userLabel(item.user) : "—";
  return v == null ? "" : String(v);
};

const ConfigResourceTable = ({ resource, fields, scoped, entrepriseId, label }) => {
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

  const openCreate = () => {
    const blank = {};
    fields.forEach((f) => {
      blank[f.name] = f.type === "bool" ? false : "";
    });
    setForm(blank);
    setError("");
    setModal({ mode: "create" });
  };

  const openEdit = (item) => {
    const f = {};
    fields.forEach((fld) => {
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
    for (const fld of fields) {
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
    for (const fld of fields) {
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
        <button className="cr-btn cr-btn-add" onClick={openCreate}>
          <HiPlus /> Ajouter
        </button>
      </div>

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
              {fields.map((f) => (
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
