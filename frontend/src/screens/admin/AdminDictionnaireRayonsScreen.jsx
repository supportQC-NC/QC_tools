// src/screens/admin/AdminDictionnaireRayonsScreen.jsx
//
// Dictionnaire des RAYONS (fichier « <TRIG>_dictionnaire_rayons.xlsx » sur le
// partage « collecteur »). Deux usages :
//   1) Éditer le fichier (GISM1 / libellé / métrage) et l'enregistrer ;
//   2) Générer des étiquettes A8 (QR ou code-barres) découpées en SOUS-ZONES :
//      métrage N → N sous-zones « <GISM1>_A, _B, … » (toujours au moins « _A »).
// Société lue depuis la sélection GLOBALE (Header).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HiTag,
  HiOfficeBuilding,
  HiPlus,
  HiTrash,
  HiSave,
  HiRefresh,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { BASE_URL } from "../../constants";
import "./AdminDictionnaireRayonsScreen.css";

// Nb de sous-zones d'un métrage (toujours au moins 1 → « _A »).
const nbSousZones = (metrage) => Math.max(1, Math.round(Number(metrage) || 0));

// Suffixe de sous-zone bijectif base 26 : 0→A, 25→Z, 26→AA (miroir du backend).
const letterSuffix = (n) => {
  let s = "";
  let x = Math.max(0, Math.floor(n)) + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

// Codes des sous-zones d'une zone (ex. au_M / 8 → au_M_A … au_M_H).
const subZoneCodes = (gism1, metrage) => {
  const code = String(gism1 || "").trim();
  if (!code) return [];
  const n = nbSousZones(metrage);
  return Array.from({ length: n }, (_, i) => `${code}_${letterSuffix(i)}`);
};

const AdminDictionnaireRayonsScreen = () => {
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  const globalEntrepriseId = useSelector(selectGlobalEntrepriseId);
  const entrepriseData = entreprises?.find((e) => e._id === globalEntrepriseId);
  const nomDossierDBF = entrepriseData?.nomDossierDBF;

  const idRef = useRef(1);
  const withId = (r) => ({ _id: idRef.current++, ...r });

  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [fichier, setFichier] = useState("");
  const [exists, setExists] = useState(true);
  const [codeType, setCodeType] = useState("barcode"); // "barcode" | "qr"

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);

  const erreurReponse = async (res, base) => {
    let msg = `${base} (${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) msg = j.message;
    } catch {
      /* non-JSON */
    }
    return new Error(msg);
  };

  // ── Chargement du dictionnaire ───────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!nomDossierDBF) return;
    setError("");
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/dictionnaire-rayons/${nomDossierDBF}`,
        { credentials: "include" },
      );
      if (!res.ok) throw await erreurReponse(res, "Lecture échouée");
      const data = await res.json();
      idRef.current = 1;
      setRows((data.rows || []).map(withId));
      setFichier(data.fichier || "");
      setExists(!!data.exists);
      setDirty(false);
    } catch (e) {
      setError(e.message || "Impossible de lire le dictionnaire.");
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomDossierDBF]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Édition ──────────────────────────────────────────────────────────────────
  const updateRow = (id, field, value) => {
    setRows((prev) =>
      prev.map((r) => (r._id === id ? { ...r, [field]: value } : r)),
    );
    setDirty(true);
  };
  const addRow = () => {
    setRows((prev) => [...prev, withId({ gism1: "", libelle: "", metrage: 0 })]);
    setDirty(true);
  };
  const deleteRow = (id) => {
    setRows((prev) => prev.filter((r) => r._id !== id));
    setDirty(true);
  };

  const totalSousZones = useMemo(
    () =>
      rows.reduce(
        (n, r) => n + (String(r.gism1).trim() ? nbSousZones(r.metrage) : 0),
        0,
      ),
    [rows],
  );
  const nbCodes = rows.filter((r) => String(r.gism1).trim()).length;

  // ── Enregistrement ───────────────────────────────────────────────────────────
  const save = async () => {
    if (!nomDossierDBF) return setError("Sélectionnez une société dans l'en-tête.");
    setError("");
    setInfo(null);
    setSaving(true);
    try {
      const payload = {
        rows: rows.map((r) => ({
          gism1: String(r.gism1 || "").trim(),
          libelle: String(r.libelle || "").trim(),
          metrage: Math.max(0, Math.round(Number(r.metrage) || 0)),
        })),
      };
      const res = await fetch(
        `${BASE_URL}/api/dictionnaire-rayons/${nomDossierDBF}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw await erreurReponse(res, "Enregistrement échoué");
      const data = await res.json();
      setDirty(false);
      setExists(true);
      setInfo(data.message || "Dictionnaire enregistré.");
      load();
    } catch (e) {
      setError(e.message || "Impossible d'enregistrer.");
    } finally {
      setSaving(false);
    }
  };

  // ── Génération des étiquettes (à partir du fichier ENREGISTRÉ) ───────────────
  const generer = async () => {
    if (!nomDossierDBF) return setError("Sélectionnez une société dans l'en-tête.");
    setError("");
    setInfo(null);
    setGenerating(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/dictionnaire-rayons/${nomDossierDBF}/etiquettes`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codeType }),
        },
      );
      if (!res.ok) throw await erreurReponse(res, "Génération échouée");
      const nb = res.headers.get("X-Etiquettes");
      const tronque = res.headers.get("X-Tronque") === "1";
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `etiquettes_rayons_${codeType}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      setInfo(
        `${nb ?? "?"} étiquette(s) générée(s) au format A8` +
          (tronque ? " (tronqué à 5000)." : "."),
      );
    } catch (e) {
      setError(e.message || "Impossible de générer les étiquettes.");
    } finally {
      setGenerating(false);
    }
  };

  if (loadingEntreprises) {
    return (
      <div className="dicr-screen">
        <div className="dicr-placeholder">Chargement des entreprises…</div>
      </div>
    );
  }

  return (
    <div className="dicr-screen">
      <div className="dicr-header">
        <h1>
          <HiTag /> Dictionnaire des rayons
        </h1>
        <p>
          Éditez le fichier des rayons (code GISM1 + libellé + métrage), puis
          générez les étiquettes A8 en QR ou code-barres. Le métrage découpe
          chaque rayon en sous-zones (<code>_A</code>, <code>_B</code>…) : un
          rayon de métrage 8 donne 8 sous-zones, un rayon de métrage 0 en donne 1
          (<code>_A</code>).
        </p>
      </div>

      {!nomDossierDBF && (
        <div className="dicr-card">
          <p className="dicr-hint">
            <HiOfficeBuilding /> Sélectionnez une société dans l'en-tête pour
            continuer.
          </p>
        </div>
      )}

      {nomDossierDBF && (
        <>
          {fichier && (
            <div className="dicr-filepath" title={fichier}>
              Fichier : <code>{fichier}</code>
              {!exists && <span className="dicr-badge-new"> (sera créé)</span>}
            </div>
          )}

          {error && <div className="dicr-error">{error}</div>}
          {info && <div className="dicr-info">{info}</div>}

          {/* ── Éditeur ─────────────────────────────────────────────── */}
          <div className="dicr-card">
            <div className="dicr-card-head">
              <label className="dicr-label">
                Rayons ({nbCodes}) · {totalSousZones} sous-zone(s)
              </label>
              <div className="dicr-head-actions">
                <button
                  type="button"
                  className="dicr-btn"
                  onClick={load}
                  disabled={loading}
                  title="Recharger depuis le fichier"
                >
                  <HiRefresh /> {loading ? "…" : "Recharger"}
                </button>
                <button type="button" className="dicr-btn" onClick={addRow}>
                  <HiPlus /> Ajouter une ligne
                </button>
              </div>
            </div>

            <div className="dicr-table-wrap">
              <table className="dicr-table">
                <thead>
                  <tr>
                    <th className="dicr-col-code">GISM1 (code)</th>
                    <th>Libellé</th>
                    <th className="dicr-col-metr">Métrage</th>
                    <th className="dicr-col-sz">Sous-zones</th>
                    <th className="dicr-col-act"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="dicr-empty">
                        {loading
                          ? "Chargement…"
                          : "Aucune ligne. Cliquez « Ajouter une ligne »."}
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const hasCode = String(r.gism1).trim() !== "";
                      const sz = hasCode ? subZoneCodes(r.gism1, r.metrage) : [];
                      return (
                        <React.Fragment key={r._id}>
                          <tr className="dicr-zone-row">
                            <td>
                              <input
                                className="dicr-in mono"
                                value={r.gism1}
                                onChange={(e) =>
                                  updateRow(r._id, "gism1", e.target.value)
                                }
                                placeholder="ex : au_M"
                              />
                            </td>
                            <td>
                              <input
                                className="dicr-in"
                                value={r.libelle}
                                onChange={(e) =>
                                  updateRow(r._id, "libelle", e.target.value)
                                }
                                placeholder="ex : AU M precompte"
                              />
                            </td>
                            <td>
                              <input
                                className="dicr-in dicr-in-num"
                                type="number"
                                min="0"
                                step="1"
                                value={r.metrage}
                                onChange={(e) =>
                                  updateRow(r._id, "metrage", e.target.value)
                                }
                              />
                            </td>
                            <td className="dicr-sz-cell">
                              {hasCode ? sz.length : "—"}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="dicr-del"
                                onClick={() => deleteRow(r._id)}
                                title="Supprimer la ligne"
                              >
                                <HiTrash />
                              </button>
                            </td>
                          </tr>
                          {hasCode && (
                            <tr className="dicr-subzone-row">
                              <td colSpan={5}>
                                <div className="dicr-subzones">
                                  <span className="dicr-sz-arrow">↳</span>
                                  {sz.map((c) => (
                                    <span key={c} className="dicr-sz-chip">
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="dicr-actions">
              <button
                type="button"
                className="dicr-save"
                onClick={save}
                disabled={saving || !dirty}
                title={dirty ? "Enregistrer le fichier" : "Aucune modification"}
              >
                <HiSave /> {saving ? "Enregistrement…" : "Enregistrer le fichier"}
              </button>
            </div>
          </div>

          {/* ── Étiquettes ─────────────────────────────────────────── */}
          <div className="dicr-card">
            <label className="dicr-label">Étiquettes (A8, par sous-zone)</label>
            <div className="dicr-types">
              <button
                type="button"
                className={`dicr-type-btn ${codeType === "barcode" ? "active" : ""}`}
                onClick={() => setCodeType("barcode")}
              >
                ▐▍▐ Code-barres (Code128)
              </button>
              <button
                type="button"
                className={`dicr-type-btn ${codeType === "qr" ? "active" : ""}`}
                onClick={() => setCodeType("qr")}
              >
                ▣ QR code
              </button>
            </div>
            <span className="dicr-hint-inline">
              Génère {totalSousZones} étiquette(s) à partir du fichier{" "}
              <strong>enregistré</strong>.
              {dirty ? " Enregistrez d'abord vos modifications." : ""}
            </span>

            <div className="dicr-actions">
              <button
                type="button"
                className="dicr-generate"
                onClick={generer}
                disabled={generating || dirty || nbCodes === 0}
              >
                <HiTag /> {generating ? "Génération…" : "Générer les étiquettes (A8)"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDictionnaireRayonsScreen;
