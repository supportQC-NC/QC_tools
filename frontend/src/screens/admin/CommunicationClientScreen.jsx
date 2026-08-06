import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiMail,
  HiEye,
  HiPaperAirplane,
  HiRefresh,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiBeaker,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import {
  useGetNouveautesQuery,
  useSendCatalogMutation,
} from "../../slices/communicationClientApiSlice";
import { BASE_URL } from "../../constants";
import "./CommunicationClientScreen.css";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const monthRange = () => {
  const n = new Date();
  return {
    start: ymd(new Date(n.getFullYear(), n.getMonth(), 1)),
    end: ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)),
  };
};
const weekRange = () => {
  const n = new Date();
  const day = (n.getDay() + 6) % 7; // lundi = 0
  const monday = new Date(n);
  monday.setDate(n.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: ymd(monday), end: ymd(sunday) };
};

const fmtPrix = (v) => {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${Math.trunc(Number(v)).toLocaleString("fr-FR").replace(/[\s,]/g, " ")} XPF`;
};

const CommunicationClientScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [range, setRange] = useState(monthRange());
  const [msg, setMsg] = useState(null); // { type, text }

  const { data, isFetching, isError, error, refetch } = useGetNouveautesQuery(
    { nomDossierDBF, start: range.start, end: range.end },
    { skip: !nomDossierDBF },
  );
  const [sendCatalog, { isLoading: sending }] = useSendCatalogMutation();

  const groupes = useMemo(() => data?.groupes || [], [data]);
  const nbAbonnes = data?.nbAbonnes ?? 0;

  const previewUrl =
    nomDossierDBF &&
    `${BASE_URL}/api/communication-client/${nomDossierDBF}/preview?start=${range.start}&end=${range.end}`;

  // Aperçu email : on RÉCUPÈRE le HTML (avec cookie) puis on ouvre un blob.
  // (Une navigation document directe vers /api n'est pas proxifiée par CRA en dev.)
  const [previewLoading, setPreviewLoading] = useState(false);
  const openPreview = async () => {
    if (!nomDossierDBF) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(previewUrl, { credentials: "include" });
      if (!res.ok) throw new Error();
      const html = await res.text();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setMsg({ type: "err", text: "Aperçu indisponible." });
    } finally {
      setPreviewLoading(false);
    }
  };

  const doSend = async (mode) => {
    setMsg(null);
    if (mode === "abonnes") {
      if (nbAbonnes === 0) {
        setMsg({ type: "err", text: "Aucun client abonné à la newsletter." });
        return;
      }
      if (
        !window.confirm(
          `Envoi RÉEL du catalogue à ${nbAbonnes} client(s) abonné(s). Confirmer ?`,
        )
      )
        return;
    }
    try {
      const r = await sendCatalog({
        nomDossierDBF,
        start: range.start,
        end: range.end,
        mode,
      }).unwrap();
      setMsg({
        type: "ok",
        text:
          r.mode === "test"
            ? `Email de TEST envoyé à support@quincaillerie.nc (${r.total} nouveauté(s)).`
            : `Catalogue envoyé à ${r.nbDestinataires} abonné(s) (${r.total} nouveauté(s)).`,
      });
    } catch (e) {
      setMsg({ type: "err", text: e?.data?.message || "Envoi impossible." });
    }
  };

  return (
    <div className="cc-page">
      <header className="cc-header">
        <div className="cc-header-icon">
          <HiMail />
        </div>
        <div className="cc-header-text">
          <h1>Communication client — Nouveautés</h1>
          <p className="cc-header-subtitle">
            Catalogue des nouveaux produits en stock, envoyé aux clients abonnés
            à la newsletter.
          </p>
        </div>
        {entreprise && (
          <div className="cc-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      {!nomDossierDBF ? (
        <div className="cc-empty">
          <HiExclamationCircle className="cc-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête.</p>
        </div>
      ) : (
        <>
          <div className="cc-toolbar">
            <div className="cc-toolbar-left">
              <div className="cc-presets">
                <button className="cc-btn cc-btn-ghost" onClick={() => setRange(weekRange())}>
                  Cette semaine
                </button>
                <button className="cc-btn cc-btn-ghost" onClick={() => setRange(monthRange())}>
                  Ce mois
                </button>
              </div>
              <div className="cc-field">
                <label>Du</label>
                <input
                  type="date"
                  value={range.start}
                  max={range.end}
                  onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
                />
              </div>
              <div className="cc-field">
                <label>Au</label>
                <input
                  type="date"
                  value={range.end}
                  min={range.start}
                  onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
                />
              </div>
              <div className="cc-stats">
                <div className="cc-stat cc-stat-primary">
                  <span className="cc-stat-value">{data?.total ?? "—"}</span>
                  <span className="cc-stat-label">Nouveautés</span>
                </div>
                <div className="cc-stat">
                  <span className="cc-stat-value">{groupes.length}</span>
                  <span className="cc-stat-label">Fournisseurs</span>
                </div>
                <div className="cc-stat">
                  <span className="cc-stat-value">{nbAbonnes}</span>
                  <span className="cc-stat-label">Abonnés</span>
                </div>
              </div>
            </div>

            <div className="cc-actions">
              <button
                className="cc-btn cc-btn-ghost"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <HiRefresh className={isFetching ? "cc-spin" : ""} /> Actualiser
              </button>
              <button
                className="cc-btn cc-btn-ghost"
                onClick={openPreview}
                disabled={previewLoading || isFetching}
              >
                <HiEye /> {previewLoading ? "Aperçu…" : "Aperçu email"}
              </button>
              <button
                className="cc-btn cc-btn-test"
                onClick={() => doSend("test")}
                disabled={sending || isFetching}
                title="Envoie uniquement à support@quincaillerie.nc"
              >
                <HiBeaker /> {sending ? "Envoi…" : "Envoi de TEST"}
              </button>
              <button
                className="cc-btn cc-btn-send"
                onClick={() => doSend("abonnes")}
                disabled={sending || isFetching || nbAbonnes === 0}
              >
                <HiPaperAirplane /> Envoyer aux abonnés ({nbAbonnes})
              </button>
            </div>
          </div>

          {msg && (
            <div className={`cc-alert ${msg.type === "err" ? "err" : "ok"}`}>
              {msg.text}
            </div>
          )}
          {isError && (
            <div className="cc-alert err">
              {error?.data?.message || "Erreur lors du chargement des nouveautés."}
            </div>
          )}

          <div className="cc-content">
            {isFetching ? (
              <div className="cc-info">Chargement…</div>
            ) : groupes.length === 0 ? (
              <div className="cc-info">Aucune nouveauté sur cette période.</div>
            ) : (
              groupes.map((g) => (
                <div key={g.fourn} className="cc-group">
                  <h3 className="cc-group-title">
                    {g.nom} <span className="cc-group-count">({g.articles.length})</span>
                  </h3>
                  <div className="cc-table-wrap">
                    <table className="cc-table">
                      <colgroup>
                        <col style={{ width: "11%" }} />
                        <col style={{ width: "43%" }} />
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "16%" }} />
                        <col style={{ width: "9%" }} />
                        <col style={{ width: "7%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>NART</th>
                          <th>Désignation</th>
                          <th>Réf.</th>
                          <th>Gencod</th>
                          <th className="cc-num">Prix TTC</th>
                          <th className="cc-num">Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.articles.map((a) => (
                          <tr key={a.nart}>
                            <td className="cc-mono">{a.nart || "—"}</td>
                            <td className="cc-ell" title={a.design}>
                              {a.design || "—"}
                            </td>
                            <td className="cc-muted cc-ell">{a.refer || "—"}</td>
                            <td className="cc-mono cc-muted">{a.gencod || "—"}</td>
                            <td className="cc-num cc-mono">{fmtPrix(a.pvtettc)}</td>
                            <td className="cc-num">{Math.trunc(a.stock)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CommunicationClientScreen;
