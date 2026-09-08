// src/screens/admin/AdminAgentsInventaireScreen.jsx
//
// Agents de l'inventaire — la liste des personnes qui ont travaillé sur
// l'inventaire, et ce que chacune a produit.
//
// L'écran réunit les DEUX façons de participer, jusque-là invisibles l'une
// pour l'autre :
//   · le collecteur (zones bipées, articles, unités, temps effectif) ;
//   · les coupons détachables rapportés au poste (papillonnage / bipage /
//     contrôle), dont l'agent est désigné au moment du scan.
// Un renfort venu d'une autre société du groupe apparaît donc ici comme les
// autres : la liste des agents n'est pas bornée à la société de l'inventaire.
import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiUserGroup,
  HiRefresh,
  HiDownload,
  HiSearch,
  HiChevronRight,
  HiChevronDown,
  HiClipboardCheck,
} from "react-icons/hi";
import * as XLSX from "xlsx";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetAgentsInventaireQuery } from "../../slices/inventaireCollecteApiSlice";
import "./AdminAgentsInventaireScreen.css";

// Même formateur de durée que le suivi bipage et les stats réappro : un seul
// vocabulaire dans toute l'application.
const fmtDuree = (ms) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s <= 0) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m} min ${rs} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${String(rm).padStart(2, "0")}` : `${h} h`;
};

const fmtDateHeure = (v) =>
  v
    ? new Date(v).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

const AdminAgentsInventaireScreen = () => {
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";

  const [session, setSession] = useState("active");
  const [search, setSearch] = useState("");
  const [ouverts, setOuverts] = useState({});

  const { data, isLoading, isFetching, refetch } = useGetAgentsInventaireQuery(
    { entrepriseId: selectedEntreprise, session },
    { skip: !selectedEntreprise, pollingInterval: 30000 },
  );

  const agents = useMemo(() => {
    const liste = data?.agents || [];
    const q = search.trim().toLowerCase();
    if (!q) return liste;
    return liste.filter(
      (a) =>
        (a.nom || "").toLowerCase().includes(q) ||
        (a.email || "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const totaux = data?.totaux;

  const basculer = (cle) => setOuverts((p) => ({ ...p, [cle]: !p[cle] }));

  const exporterExcel = () => {
    if (!agents.length) return;
    const lignes = agents.map((a) => ({
      Agent: a.nom,
      "E-mail": a.email || "",
      "Zones bipées": a.nbZones,
      Terminées: a.nbTermines,
      "En cours": a.nbEnCours,
      Papillonnage: a.phases?.papillonnage || 0,
      "Bipage (coupon)": a.phases?.bipage || 0,
      Contrôle: a.phases?.controle || 0,
      "Coupons validés": a.totalPhases,
      Articles: a.totalArticles,
      Unités: a.totalQuantite,
      "Temps effectif": fmtDuree(a.tempsActifMs),
      "Temps effectif (s)": Math.round((a.tempsActifMs || 0) / 1000),
      "Temps brut": fmtDuree(a.tempsBrutMs),
      "Moyenne / zone": fmtDuree(a.moyenneParZoneMs),
      "Première activité": fmtDateHeure(a.premiereActiviteAt),
      "Dernière activité": fmtDateHeure(a.derniereActiviteAt),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignes), "Agents");
    // Deuxième feuille : le détail zone par zone, qui justifie les totaux.
    const detail = agents.flatMap((a) =>
      (a.zones || []).map((z) => ({
        Agent: a.nom,
        Zone: z.code,
        Libellé: z.libelle || "",
        Emplacement: z.type || "",
        État: z.status === "exporte" ? "Terminé" : "En cours",
        Articles: z.totalArticles,
        "Temps effectif": fmtDuree(z.tempsActifMs),
        Quand: fmtDateHeure(z.at),
      })),
    );
    if (detail.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(detail),
        "Zones par agent",
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `agents_inventaire_${stamp}.xlsx`);
  };

  return (
    <div className="agents-inv">
      <div className="agents-inv-header">
        <h1>
          <HiUserGroup /> Agents de l'inventaire
        </h1>
        <div className="agents-inv-actions">
          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!selectedEntreprise || isFetching}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="agents-inv-placeholder">
          <HiUserGroup />
          <p>Sélectionnez une société pour voir les agents de l'inventaire.</p>
        </div>
      ) : isLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : (
        <>
          <div className="agents-inv-toolbar">
            <select
              className="filter-select"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              title="Inventaire concerné"
            >
              <option value="active">Inventaire en cours</option>
              <option value="toutes">Tous les inventaires</option>
              {(data?.sessions || []).map((s) => (
                <option key={s._id} value={s._id}>
                  {s.nom} {s.statut === "archive" ? "(archivé)" : ""}
                </option>
              ))}
            </select>

            <div className="search-box">
              <HiSearch />
              <input
                type="text"
                placeholder="Nom, e-mail…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <span className="agents-inv-count">
              {agents.length} agent{agents.length > 1 ? "s" : ""}
              {isFetching ? " …" : ""}
            </span>

            <button
              className="btn-primary"
              onClick={exporterExcel}
              disabled={!agents.length}
            >
              <HiDownload /> Excel
            </button>
          </div>

          {totaux && (
            <div className="agents-inv-kpis">
              <div className="kpi">
                <span className="kpi-val">{totaux.nbAgents}</span>
                <span className="kpi-lbl">agents</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{totaux.nbZones}</span>
                <span className="kpi-lbl">zones bipées</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">
                  <HiClipboardCheck /> {totaux.nbPhases}
                </span>
                <span className="kpi-lbl">coupons validés</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{totaux.totalArticles}</span>
                <span className="kpi-lbl">articles</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{totaux.totalQuantite}</span>
                <span className="kpi-lbl">unités</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{fmtDuree(totaux.tempsActifMs)}</span>
                <span className="kpi-lbl">temps effectif cumulé</span>
              </div>
            </div>
          )}

          <div className="agents-inv-tablewrap">
            <table className="admin-table agents-inv-table">
              <thead>
                <tr>
                  <th className="col-agent">Agent</th>
                  <th className="num">Zones bipées</th>
                  <th
                    className="num"
                    title="Coupons papillonnage / bipage / contrôle validés à son nom"
                  >
                    Coupons
                  </th>
                  <th className="num">Articles</th>
                  <th className="num">Unités</th>
                  <th
                    className="num"
                    title="Somme des intervalles de travail, pauses exclues"
                  >
                    Temps effectif
                  </th>
                  <th
                    className="num"
                    title="De l'entrée dans la zone au dépôt, pauses comprises"
                  >
                    Temps brut
                  </th>
                  <th className="num">Moy. / zone</th>
                  <th>Activité</th>
                </tr>
              </thead>
              <tbody>
                {agents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="vide">
                      Personne n'a encore travaillé sur cet inventaire. Les agents
                      apparaissent dès qu'une zone est ouverte sur le collecteur
                      ou qu'un coupon est scanné à leur nom.
                    </td>
                  </tr>
                ) : (
                  agents.map((a) => {
                    const cle = String(a.user || a.nom);
                    const ouvert = !!ouverts[cle];
                    const depliable = !!a.zones?.length;
                    return (
                      <React.Fragment key={cle}>
                        <tr
                          className={`agent-row ${ouvert ? "ouvert" : ""} ${
                            depliable ? "depliable" : ""
                          }`}
                          onClick={() => depliable && basculer(cle)}
                        >
                          <td className="col-agent">
                            <div className="agent-nom">
                              {depliable ? (
                                ouvert ? (
                                  <HiChevronDown />
                                ) : (
                                  <HiChevronRight />
                                )
                              ) : (
                                <span className="chevron-vide" />
                              )}
                              {a.nom}
                            </div>
                            {a.email && (
                              <div className="agent-mail">{a.email}</div>
                            )}
                          </td>
                          <td className="num strong">
                            {a.nbZones}
                            {a.nbEnCours > 0 && (
                              <span
                                className="badge-encours"
                                title="Zones encore ouvertes sur le collecteur"
                              >
                                {a.nbEnCours} en cours
                              </span>
                            )}
                          </td>
                          <td className="num">
                            {a.totalPhases}
                            {a.totalPhases > 0 && (
                              <span className="phases-detail">
                                {a.phases.papillonnage}P · {a.phases.bipage}B ·{" "}
                                {a.phases.controle}C
                              </span>
                            )}
                          </td>
                          <td className="num">{a.totalArticles}</td>
                          <td className="num">{a.totalQuantite}</td>
                          <td className="num strong">
                            {fmtDuree(a.tempsActifMs)}
                          </td>
                          <td className="num dim">{fmtDuree(a.tempsBrutMs)}</td>
                          <td className="num dim">
                            {fmtDuree(a.moyenneParZoneMs)}
                          </td>
                          <td className="col-activite">
                            <div>{fmtDateHeure(a.premiereActiviteAt)}</div>
                            <div className="dim">
                              → {fmtDateHeure(a.derniereActiviteAt)}
                            </div>
                          </td>
                        </tr>
                        {ouvert && (
                          <tr className="agent-detail">
                            <td colSpan={9}>
                              <table className="detail-table">
                                <thead>
                                  <tr>
                                    <th>Zone</th>
                                    <th>Emplacement</th>
                                    <th>État</th>
                                    <th className="num">Articles</th>
                                    <th className="num">Temps effectif</th>
                                    <th>Quand</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {a.zones.map((z, i) => (
                                    <tr key={`${z.code}-${i}`}>
                                      <td>
                                        <b>{z.code}</b>
                                        {z.libelle ? ` · ${z.libelle}` : ""}
                                      </td>
                                      <td>{z.type || "—"}</td>
                                      <td>
                                        {z.status === "exporte" ? (
                                          "Terminé"
                                        ) : (
                                          <span className="badge-encours">
                                            en cours
                                          </span>
                                        )}
                                      </td>
                                      <td className="num">{z.totalArticles}</td>
                                      <td className="num">
                                        {fmtDuree(z.tempsActifMs)}
                                      </td>
                                      <td>{fmtDateHeure(z.at)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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

          <p className="agents-inv-legende">
            Les <b>zones bipées</b> et les temps viennent du collecteur ; les{" "}
            <b>coupons</b> (P = papillonnage, B = bipage, C = contrôle) viennent
            des coupons détachables scannés sur l'écran « Progression
            d'inventaire », où l'agent est désigné au moment du scan. Le{" "}
            <b>temps effectif</b> ignore les silences de plus de{" "}
            {Math.round((data?.seuilPauseMs || 0) / 60000)} minutes, considérés
            comme des pauses. Cliquez sur une ligne pour voir le détail de ses
            zones.
          </p>
        </>
      )}
    </div>
  );
};

export default AdminAgentsInventaireScreen;
