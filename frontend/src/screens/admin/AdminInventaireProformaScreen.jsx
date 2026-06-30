// src/screens/admin/AdminInventaireProformaScreen.jsx
import React, { useState } from "react";
import {
  HiClipboardList,
  HiOfficeBuilding,
  HiUser,
  HiSearch,
  HiRefresh,
  HiDocumentText,
  HiCalendar,
  HiChevronRight,
  HiChevronDown,
  HiPrinter,
  HiTable,
  HiDownload,
  HiServer,
} from "react-icons/hi";
import { useSelector, useDispatch } from "react-redux";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetInventaireProformaByTiersQuery } from "../../slices/inventaireProformaApiSlice";
import { setSelectedEntreprise } from "../../slices/inventaireSelectionSlice";
import { BASE_URL } from "../../constants";
import "./AdminInventaireProformaScreen.css";

const AdminInventaireProformaScreen = () => {
  const dispatch = useDispatch();
  const persistedEntreprise = useSelector(
    (s) => s.inventaireSelection.selectedEntreprise,
  );
  const [nomDossierDBF, setNomDossierDBF] = useState(persistedEntreprise || "");
  const [tiersInput, setTiersInput] = useState("");
  const [tiers, setTiers] = useState(""); // tiers validé (déclenche la requête)
  const [dateDebut, setDateDebut] = useState(""); // "à partir du" (DATFACT >= dateDebut)
  const [expanded, setExpanded] = useState(() => new Set()); // NUMFACT dépliés
  const [ficheLoading, setFicheLoading] = useState(""); // NUMFACT en génération
  const [groupBy, setGroupBy] = useState("famille"); // famille | fournisseur
  const [seuil, setSeuil] = useState(""); // seuil écart valeur (XPF)
  const [docLoading, setDocLoading] = useState(false);
  const [excluded, setExcluded] = useState(() => new Set()); // NUMFACT décochés

  // Export .DAT (mode inventaire proforma)
  const [zoneOverrides, setZoneOverrides] = useState({}); // numfact -> zone (modif locale)
  const [datPortee, setDatPortee] = useState("zone"); // "zone" | "general"
  const [datLoading, setDatLoading] = useState(false);
  const [datMsg, setDatMsg] = useState(null); // { type, text }

  const { data: entreprises } = useGetEntreprisesQuery();

  const {
    data: lignesData,
    isFetching: lignesLoading,
    refetch,
  } = useGetInventaireProformaByTiersQuery(
    { nomDossierDBF, tiers, dateDebut },
    { skip: !nomDossierDBF || !tiers },
  );

  const groupes = lignesData?.groupes || [];

  const mappingEntrepots = lignesData?.mappingEntrepots || {
    S1: "S1",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
  };
  const ZONES = ["S1", "S2", "S3", "S4", "S5"];
  const zoneOf = (numfact, fallback) =>
    zoneOverrides[numfact] ?? fallback ?? "S1";

  // Affecte une proforma à une zone/entrepôt (PUT)
  const changeZone = async (numfact, zone) => {
    setZoneOverrides((prev) => ({ ...prev, [numfact]: zone })); // optimiste
    try {
      const res = await fetch(
        `${BASE_URL}/api/inventaire-proforma/${nomDossierDBF}/proforma/${numfact}/zone`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone }),
        },
      );
      if (!res.ok) throw new Error("Échec de l'affectation");
    } catch (e) {
      setDatMsg({ type: "error", text: `Zone non enregistrée : ${e.message}` });
    }
  };

  // Exporte les proformas du tiers en .DAT (mode "serveur" | "download")
  const exportDat = async (mode) => {
    if (!nomDossierDBF || !tiers) return;
    setDatLoading(true);
    setDatMsg(null);
    try {
      const res = await fetch(
        `${BASE_URL}/api/inventaire-proforma/${nomDossierDBF}/tiers/${tiers}/export-dat`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dateDebut, mode, portee: datPortee }),
        },
      );

      if (mode === "serveur") {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Erreur export serveur");
        const noms = (data.fichiers || []).map((f) => f.fichier).join(", ");
        setDatMsg({
          type: "success",
          text: `${data.message}. Dossier : ${data.dossier}${noms ? ` — ${noms}` : ""}`,
        });
      } else {
        if (!res.ok) {
          let msg = "Erreur lors de l'export";
          try {
            const j = await res.json();
            msg = j?.message || msg;
          } catch {
            /* corps non-JSON */
          }
          throw new Error(msg);
        }
        const blob = await res.blob();
        const cd = res.headers.get("content-disposition") || "";
        const m = cd.match(/filename="?([^"]+)"?/);
        const filename =
          (m && m[1]) ||
          (datPortee === "general"
            ? "stock.dat inventaire_general"
            : `inventaire_proforma_${tiers}_dat.zip`);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setDatMsg({ type: "success", text: `Téléchargé : ${filename}` });
      }
    } catch (e) {
      setDatMsg({ type: "error", text: e.message });
    } finally {
      setDatLoading(false);
    }
  };

  // Total global des écarts (XPF) : articles agrégés par NART, proformas cochées.
  const totalEcartGlobal = React.useMemo(() => {
    const artMap = new Map();
    for (const g of groupes) {
      if (excluded.has(g.numfact)) continue;
      for (const l of g.lignes) {
        if (l.isComment || !l.nart) continue;
        const k = l.nart.toUpperCase();
        if (!artMap.has(k))
          artMap.set(k, { qte: 0, stock: l.stock, prev: l.prev });
        artMap.get(k).qte += Number.isFinite(l.qte) ? l.qte : 0;
      }
    }
    let total = 0;
    for (const a of artMap.values()) {
      if (Number.isFinite(a.stock) && Number.isFinite(a.prev))
        total += Math.round((a.qte - a.stock) * a.prev);
    }
    return total;
  }, [groupes, excluded]);

  const onEntrepriseChange = (e) => {
    setNomDossierDBF(e.target.value);
    dispatch(setSelectedEntreprise(e.target.value));
    setTiersInput("");
    setTiers("");
    setExpanded(new Set());
    setExcluded(new Set());
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setTiers(tiersInput.trim());
    setExpanded(new Set());
    setExcluded(new Set());
  };

  const toggleCheck = (numfact) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(numfact)) next.delete(numfact);
      else next.add(numfact);
      return next;
    });
  };

  const toggle = (numfact) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(numfact)) next.delete(numfact);
      else next.add(numfact);
      return next;
    });
  };

  // Génère la feuille de contrôle PDF de la proforma et l'ouvre (cookie auth).
  const genererFiche = async (numfact) => {
    if (!nomDossierDBF) return;
    setFicheLoading(numfact);
    try {
      const url = `${BASE_URL}/api/inventaire-proforma/${nomDossierDBF}/proforma/${numfact}/fiche-controle`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Génération échouée (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `fiche_controle_${numfact}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      alert(e.message || "Impossible de générer la feuille de contrôle");
    } finally {
      setFicheLoading("");
    }
  };

  // Génère le document d'inventaire (PDF paysage ou Excel) du tiers et le télécharge.
  const genererDoc = async (format = "pdf") => {
    if (!nomDossierDBF || !tiers) return;
    const selected = groupes
      .map((g) => g.numfact)
      .filter((nf) => !excluded.has(nf));
    if (selected.length === 0) {
      alert("Sélectionnez au moins une proforma.");
      return;
    }
    setDocLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("groupBy", groupBy);
      params.set("format", format);
      if (seuil) params.set("seuil", seuil);
      if (dateDebut) params.set("dateDebut", dateDebut);
      // N'envoyer la liste que si certaines proformas sont décochées
      if (selected.length < groupes.length)
        params.set("numfacts", selected.join(","));
      const url = `${BASE_URL}/api/inventaire-proforma/${nomDossierDBF}/tiers/${tiers}/inventaire-doc?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let msg = `Génération échouée (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* réponse non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `inventaire_proforma_${tiers}.${format === "xlsx" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      alert(e.message || "Impossible de générer le document");
    } finally {
      setDocLoading(false);
    }
  };

  return (
    <div className="admin-invproforma">
      <div className="admin-invproforma-header">
        <h1>
          <HiClipboardList /> Inventaire Proforma
        </h1>
        <div className="admin-invproforma-actions">
          <div className="select-with-icon">
            <HiOfficeBuilding />
            <select value={nomDossierDBF} onChange={onEntrepriseChange}>
              <option value="">Sélectionner une entreprise…</option>
              {entreprises?.map((e) => (
                <option key={e._id} value={e.nomDossierDBF}>
                  {e.trigramme} - {e.nomComplet}
                </option>
              ))}
            </select>
          </div>

          <form className="client-form" onSubmit={onSubmit}>
            <div className="select-with-icon">
              <HiUser />
              <input
                type="text"
                placeholder="N° de compte (tiers)…"
                value={tiersInput}
                onChange={(e) => setTiersInput(e.target.value)}
                disabled={!nomDossierDBF}
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={!nomDossierDBF || !tiersInput.trim()}
            >
              <HiSearch /> Afficher
            </button>
          </form>

          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!tiers}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {/* Filtre de date : à partir du (DATFACT) */}
      <div className="invproforma-datebar">
        <HiCalendar />
        <label>
          À partir du
          <input
            type="date"
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
            disabled={!nomDossierDBF}
          />
        </label>
        {dateDebut && (
          <button
            type="button"
            className="btn-clear-date"
            onClick={() => setDateDebut("")}
            disabled={!nomDossierDBF}
          >
            Réinitialiser la date
          </button>
        )}
      </div>

      {!nomDossierDBF ? (
        <div className="admin-invproforma-placeholder">
          <HiOfficeBuilding />
          <p>Sélectionnez une entreprise pour commencer.</p>
        </div>
      ) : !tiers ? (
        <div className="admin-invproforma-placeholder">
          <HiUser />
          <p>Saisissez un numéro de compte (tiers) puis « Afficher ».</p>
        </div>
      ) : lignesLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : groupes.length === 0 ? (
        <div className="admin-invproforma-placeholder">
          <HiDocumentText />
          <p>
            Aucune proforma pour le tiers {tiers}
            {dateDebut ? ` à partir du ${dateDebut}` : ""}.
          </p>
        </div>
      ) : (
        <>
          <div className="admin-invproforma-summary">
            Tiers <strong>{tiers}</strong>
            {lignesData.nom ? <> — {lignesData.nom}</> : null} ·{" "}
            {lignesData.totalProformas} proforma
            {lignesData.totalProformas > 1 ? "s" : ""} ·{" "}
            {lignesData.totalLignes} ligne
            {lignesData.totalLignes > 1 ? "s" : ""}
            {dateDebut ? <> · à partir du {dateDebut}</> : null}
          </div>

          <div className="invproforma-docbar">
            <label>
              Regrouper par
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                <option value="famille">Famille (2 1ers car. NART)</option>
                <option value="fournisseur">Fournisseur</option>
              </select>
            </label>
            <label>
              Seuil écart (XPF)
              <input
                type="number"
                min="0"
                step="1"
                value={seuil}
                onChange={(e) => setSeuil(e.target.value)}
                placeholder="0"
              />
            </label>
            <span className="docbar-total">
              Total écarts :{" "}
              <strong
                className={
                  totalEcartGlobal > 0
                    ? "ecart-pos"
                    : totalEcartGlobal < 0
                      ? "ecart-neg"
                      : ""
                }
              >
                {totalEcartGlobal > 0 ? "+" : ""}
                {totalEcartGlobal.toLocaleString("fr-FR")} XPF
              </strong>
            </span>
            <button
              type="button"
              className="btn-primary"
              onClick={() => genererDoc("pdf")}
              disabled={docLoading}
              title="Document d'inventaire (PDF paysage)"
            >
              <HiPrinter /> {docLoading ? "Génération…" : "PDF"}
            </button>
            <button
              type="button"
              className="btn-excel"
              onClick={() => genererDoc("xlsx")}
              disabled={docLoading}
              title="Document d'inventaire (Excel)"
            >
              <HiTable /> {docLoading ? "Génération…" : "Excel"}
            </button>
          </div>

          {/* Export .DAT (format réappro) */}
          <div className="invproforma-dat-bar">
            <span className="dat-bar-label">
              <HiServer /> Export .DAT
            </span>
            <select
              className="dat-portee-select"
              value={datPortee}
              onChange={(e) => setDatPortee(e.target.value)}
              title="Un fichier par entrepôt, ou un seul fichier général"
            >
              <option value="zone">Un fichier par zone</option>
              <option value="general">Un seul fichier général</option>
            </select>
            <button
              type="button"
              className="btn-primary"
              onClick={() => exportDat("serveur")}
              disabled={datLoading}
              title="Déposer le(s) .DAT sur le serveur configuré"
            >
              <HiServer /> {datLoading ? "Export…" : "Sur le serveur"}
            </button>
            <button
              type="button"
              className="btn-excel"
              onClick={() => exportDat("download")}
              disabled={datLoading}
              title="Télécharger sur mon poste (ZIP si plusieurs zones)"
            >
              <HiDownload /> {datLoading ? "Export…" : "Télécharger"}
            </button>
            {datMsg ? (
              <span
                className={`dat-bar-msg ${datMsg.type === "error" ? "error" : "success"}`}
              >
                {datMsg.text}
              </span>
            ) : null}
          </div>

          <div className="admin-invproforma-list">
            {groupes.map((g) => {
              const isOpen = expanded.has(g.numfact);

              // Anomalies de la proforma : XX (qté > stock) et D (doublons)
              let countXX = 0;
              const doublonNarts = new Set();
              for (const l of g.lignes) {
                if (l.isComment) continue;
                if (
                  Number.isFinite(l.qte) &&
                  Number.isFinite(l.stock) &&
                  l.qte > l.stock
                )
                  countXX += 1;
                if (l.doublon && l.nart)
                  doublonNarts.add(l.nart.toUpperCase());
              }
              const countD = doublonNarts.size;

              return (
                <div
                  key={g.numfact}
                  className={`proforma-group${excluded.has(g.numfact) ? " excluded" : ""}`}
                >
                  <div className="proforma-group-bar">
                    <input
                      type="checkbox"
                      className="proforma-check"
                      checked={!excluded.has(g.numfact)}
                      onChange={() => toggleCheck(g.numfact)}
                      title="Inclure cette proforma dans le document généré"
                    />
                    <button
                      type="button"
                      className="proforma-group-header"
                      onClick={() => toggle(g.numfact)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <HiChevronDown /> : <HiChevronRight />}
                      <span className="proforma-numfact">
                        Proforma {g.numfact}
                      </span>
                      {g.texte ? (
                        <span className="proforma-obs" title={g.texte}>
                          {g.texte}
                        </span>
                      ) : null}
                      <span className="proforma-flags">
                        <span className="flag-xx" title="Quantités excédentaires (qté > stock)">
                          XX {countXX}
                        </span>
                        <span className="flag-d" title="Articles bipés sur plusieurs proformas">
                          D {countD}
                        </span>
                      </span>
                      <span className="proforma-nb">
                        {g.nbLignes} ligne{g.nbLignes > 1 ? "s" : ""}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="btn-fiche"
                      onClick={() => genererFiche(g.numfact)}
                      disabled={ficheLoading === g.numfact}
                      title="Générer la feuille de contrôle (PDF)"
                    >
                      <HiPrinter />{" "}
                      {ficheLoading === g.numfact ? "…" : "Fiche de contrôle"}
                    </button>

                    <select
                      className="proforma-zone-select"
                      value={zoneOf(g.numfact, g.zone)}
                      onChange={(e) => changeZone(g.numfact, e.target.value)}
                      title="Entrepôt/zone pour l'export .DAT"
                    >
                      {ZONES.map((z) => (
                        <option key={z} value={z}>
                          {z} — {mappingEntrepots[z] || z}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isOpen && (
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th className="col-nl">NL</th>
                          <th className="col-nart">NART</th>
                          <th className="col-att-screen">ATT</th>
                          <th>Désignation</th>
                          <th className="col-qte">Qté comptée</th>
                          <th className="col-stock">Stock théo.</th>
                          <th className="col-ecart">Écart</th>
                          <th className="col-ecartval">Écart (XPF)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.lignes.map((l, idx) => {
                          const qteNum = Number.isFinite(l.qte) ? l.qte : null;
                          const hasStock =
                            l.stock !== null &&
                            l.stock !== undefined &&
                            Number.isFinite(l.stock);
                          const ecart =
                            qteNum !== null && hasStock
                              ? qteNum - l.stock
                              : null;
                          const ecartClass =
                            ecart === null
                              ? ""
                              : ecart > 0
                                ? "ecart-pos"
                                : ecart < 0
                                  ? "ecart-neg"
                                  : "ecart-zero";
                          const prevNum = Number.isFinite(l.prev)
                            ? l.prev
                            : null;
                          const ecartValeur =
                            ecart !== null && prevNum !== null
                              ? Math.round(ecart * prevNum)
                              : null;
                          const ecartValClass =
                            ecartValeur === null
                              ? ""
                              : ecartValeur > 0
                                ? "ecart-pos"
                                : ecartValeur < 0
                                  ? "ecart-neg"
                                  : "ecart-zero";
                          const isXX =
                            qteNum !== null && hasStock && qteNum > l.stock;
                          const isD = !!l.doublon;
                          const attText = [isD ? "D" : null, isXX ? "XX" : null]
                            .filter(Boolean)
                            .join(" ");
                          const rowClass = l.isComment
                            ? "row-comment"
                            : isXX
                              ? "row-xx"
                              : isD
                                ? "row-d"
                                : "";
                          return (
                            <tr
                              key={`${g.numfact}-${l.nl}-${idx}`}
                              className={rowClass}
                            >
                              <td className="num-cell">{l.nl}</td>
                              <td className="mono">{l.nart || "—"}</td>
                              <td
                                className={`att-cell ${isXX ? "att-xx" : isD ? "att-d" : ""}`}
                              >
                                {attText}
                              </td>
                              <td className="desig-cell">
                                {l.design}
                                {l.detail && l.detail.length > 1 ? (
                                  <span
                                    className="bip-badge"
                                    title={l.detail
                                      .map(
                                        (d) =>
                                          `${d.texte || d.numfact} (${d.numfact}) : ${d.qte}`,
                                      )
                                      .join("\n")}
                                  >
                                    ⎘ {l.detail.length} proformas
                                  </span>
                                ) : null}
                              </td>
                              <td className="num-cell">
                                {l.isComment || qteNum === null ? "—" : qteNum}
                              </td>
                              <td className="num-cell">
                                {hasStock ? l.stock : "—"}
                              </td>
                              <td className={`num-cell ${ecartClass}`}>
                                {ecart === null
                                  ? "—"
                                  : ecart > 0
                                    ? `+${ecart}`
                                    : ecart}
                              </td>
                              <td className={`num-cell ${ecartValClass}`}>
                                {ecartValeur === null
                                  ? "—"
                                  : `${ecartValeur > 0 ? "+" : ""}${ecartValeur.toLocaleString("fr-FR")} XPF`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminInventaireProformaScreen;