// src/screens/InstallAppScreen.jsx
// Page PUBLIQUE : affiche le QR d'installation de l'app collecteur + la version.
// L'upload d'un nouveau QR (avec version auto-incrémentée) est réservé aux admins.
import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { HiQrcode, HiUpload, HiRefresh } from "react-icons/hi";
import {
  useGetCurrentAppReleaseQuery,
  useCreateAppReleaseMutation,
} from "../slices/appReleaseApiSlice";
import "./InstallAppScreen.css";

const QR_MAX_PX = 1000; // garde le QR net et scannable

const nextVersion = (prev) => {
  if (!prev) return "1.0.1";
  const parts = String(prev).trim().split(".");
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    parts[2] = String(Number(parts[2]) + 1);
    return parts.join(".");
  }
  const m = String(prev).match(/^(.*?)(\d+)\s*$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  return "1.0.1";
};

const InstallAppScreen = () => {
  const { userInfo } = useSelector((state) => state.auth || {});
  const isAdmin = userInfo?.role === "admin";

  const { data, isLoading, refetch, isFetching } =
    useGetCurrentAppReleaseQuery();
  const [createAppRelease, { isLoading: creating }] =
    useCreateAppReleaseMutation();

  const [newQr, setNewQr] = useState("");
  const [newVersion, setNewVersion] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const currentVersion = data && !data.empty ? data.version : null;
  const proposed = useMemo(() => nextVersion(currentVersion), [currentVersion]);

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    setErr("");
    setMsg("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Le QR doit être une image (PNG/JPG).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > QR_MAX_PX || h > QR_MAX_PX) {
          const ratio = Math.min(QR_MAX_PX / w, QR_MAX_PX / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        setNewQr(canvas.toDataURL("image/png"));
        setNewVersion(proposed);
      };
      img.onerror = () => setErr("Image illisible.");
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handlePublish = async () => {
    setErr("");
    setMsg("");
    if (!newQr) {
      setErr("Choisissez d'abord une image de QR.");
      return;
    }
    try {
      const r = await createAppRelease({
        qr: newQr,
        version: newVersion || undefined,
        note,
      }).unwrap();
      setMsg(`Version ${r.version} publiée.`);
      setNewQr("");
      setNewVersion("");
      setNote("");
    } catch (e) {
      setErr(e?.data?.message || "Échec de la publication.");
    }
  };

  return (
    <div className="install-app">
      {/* ─── Bandeau ─── */}
      <div className="ia-hero">
        <div className="ia-hero-icon">
          <HiQrcode />
        </div>
        <div className="ia-hero-info">
          <h1>Installer l'application collecteur</h1>
          <p>
            Scannez le QR code avec un collecteur pour installer ou mettre à jour
            l'application.
          </p>
        </div>
        {currentVersion && (
          <span className="ia-hero-version">v{currentVersion}</span>
        )}
      </div>

      {/* ─── Layout large ─── */}
      <div className="ia-layout">
        {/* Carte QR (publique) */}
        <div className="ia-card ia-card-qr">
          <div className="ia-card-head">QR d'installation</div>

          {isLoading ? (
            <p className="ia-muted">Chargement…</p>
          ) : data && !data.empty ? (
            <>
              <div className="ia-qr">
                <img src={data.qr} alt="QR d'installation" />
              </div>
              <div className="ia-version">
                Version&nbsp;<strong>{data.version}</strong>
              </div>
              {data.note ? <p className="ia-note">{data.note}</p> : null}
            </>
          ) : (
            <div className="ia-empty">
              <HiQrcode />
              <span>Aucun QR d'installation publié pour l'instant.</span>
            </div>
          )}

          <button className="ia-refresh" onClick={refetch} disabled={isFetching}>
            <HiRefresh className={isFetching ? "spin" : ""} /> Rafraîchir
          </button>
        </div>

        {/* Colonne de droite : formulaire admin OU guide d'installation */}
        {isAdmin ? (
          <div className="ia-card ia-admin">
            <div className="ia-card-head">Publier un nouveau QR (admin)</div>
            <p className="ia-muted">
              Version courante : <strong>{currentVersion || "aucune"}</strong> ·
              prochaine version proposée : <strong>{proposed}</strong>
            </p>

            {err && <div className="ia-err">{err}</div>}
            {msg && <div className="ia-ok">{msg}</div>}

            <label className="ia-upload">
              <HiUpload /> Choisir l'image du QR
              <input type="file" accept="image/*" onChange={handleFile} hidden />
            </label>

            {newQr && (
              <div className="ia-preview">
                <img src={newQr} alt="Aperçu QR" />
              </div>
            )}

            <div className="ia-field">
              <label>Version</label>
              <input
                type="text"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                placeholder={proposed}
              />
              <span className="ia-hint">
                Pré-remplie automatiquement ({proposed}) — modifiable si besoin.
              </span>
            </div>

            <div className="ia-field">
              <label>Note (optionnel)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Changelog, remarque…"
              />
            </div>

            <button
              className="ia-publish"
              onClick={handlePublish}
              disabled={creating || !newQr}
            >
              {creating ? "Publication…" : "Publier cette version"}
            </button>
          </div>
        ) : (
          <div className="ia-card ia-steps">
            <div className="ia-card-head">Comment installer</div>
            <ol className="ia-steps-list">
              <li>
                <span className="ia-step-num">1</span>
                <div>
                  <strong>Ouvrez l'appareil photo</strong> du collecteur (ou un
                  lecteur de QR code).
                </div>
              </li>
              <li>
                <span className="ia-step-num">2</span>
                <div>
                  <strong>Scannez le QR code</strong> affiché à gauche.
                </div>
              </li>
              <li>
                <span className="ia-step-num">3</span>
                <div>
                  <strong>Installez</strong> l'application quand le téléchargement
                  vous est proposé.
                </div>
              </li>
              <li>
                <span className="ia-step-num">4</span>
                <div>
                  <strong>Ouvrez l'app</strong> et connectez-vous avec vos
                  identifiants.
                </div>
              </li>
            </ol>
            <p className="ia-help">
              En cas de mise à jour, réinstallez simplement via le QR le plus
              récent : vos données restent en place.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default InstallAppScreen;