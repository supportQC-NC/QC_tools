// src/screens/admin/AdminJournalCaisseScreen.jsx
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { roundInt, fmtFranc } from "../../utils/format";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import {
  HiCash,
  HiDownload,
  HiDocumentDownload,
  HiChevronLeft,
  HiChevronRight,
  HiDocumentText,
  HiCurrencyDollar,
  HiReceiptRefund,
  HiCreditCard,
  HiCollection,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetJournalCaisseQuery } from "../../slices/journalCaisseApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminJournalCaisseScreen.css";

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => ymd(new Date());
const shiftDay = (dateStr, delta) => {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return ymd(dt);
};

const JOURS_FR = [
  "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi",
];
const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const dateLongueFr = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return `${JOURS_FR[dt.getDay()]} ${dt.getDate()} ${MOIS_FR[dt.getMonth()]} ${dt.getFullYear()}`;
};

const fNum = (n) => (Number(n) || 0).toLocaleString("fr-FR");

const COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4",
  "#a855f7", "#ef4444", "#84cc16", "#f97316", "#14b8a6",
];
const TOOLTIP_STYLE = { background: "#12121a", border: "1px solid #2a2a3a" };

// Table de factures (réutilisée pour chaque moyen + avoirs)
const FacturesTable = ({ factures, avecMoyen = false }) => (
  <div className="jc-table-wrap">
    <table className="jc-table">
      <thead>
        <tr>
          <th>N° facture</th>
          <th>Heure</th>
          <th>Client</th>
          <th className="right">Montant</th>
          <th>N° CH</th>
          {avecMoyen && <th>Moyen</th>}
        </tr>
      </thead>
      <tbody>
        {factures.map((f) => (
          <tr key={`${f.numfact}-${f.typfact}`}>
            <td className="mono">
              {f.numfact}
              {f.typfact === "A" && <span className="jc-badge-a">A</span>}
            </td>
            <td className="mono">{f.heure || "—"}</td>
            <td>
              <span className="jc-client-nom">{f.nom}</span>
              <span className="jc-client-tiers">({f.tiers})</span>
            </td>
            <td className={`right mono ${f.montant < 0 ? "neg" : ""}`}>
              {fmtFranc(f.montant)}
            </td>
            <td className="mono">{f.numCheque || "—"}</td>
            {avecMoyen && <td>{f.moyen}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const AdminJournalCaisseScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";
  const [date, setDate] = useState(today);
  const [filtreDetail, setFiltreDetail] = useState("");

  const { data: entreprises } = useGetEntreprisesQuery();

  const { data, isLoading, isFetching, error } = useGetJournalCaisseQuery(
    { nomDossierDBF: selectedEntreprise, date },
    { skip: !selectedEntreprise || !date },
  );

  const totaux = data?.totaux;
  const groupes = useMemo(() => data?.groupes || [], [data]);
  const avoirs = data?.avoirs || [];
  const details = useMemo(() => data?.details || [], [data]);
  const loading = isLoading || (isFetching && !data);

  // Donut : répartition du montant par moyen (montants positifs uniquement),
  // limité aux 8 plus gros + "Autres" pour rester lisible.
  const donutData = useMemo(() => {
    const positifs = groupes
      .filter((g) => g.total > 0)
      .map((g) => ({ name: g.moyen, value: Math.round(g.total) }))
      .sort((a, b) => b.value - a.value);
    const top = positifs.slice(0, 8);
    const reste = positifs.slice(8).reduce((sum, x) => sum + x.value, 0);
    if (reste > 0) {
      top.push({ name: `Autres (${positifs.length - 8})`, value: reste });
    }
    return top;
  }, [groupes]);
  const donutTotal = useMemo(
    () => donutData.reduce((sum, x) => sum + x.value, 0),
    [donutData],
  );

  // Filtre local des détails
  const detailsFiltres = useMemo(() => {
    const q = filtreDetail.trim().toLowerCase();
    if (!q) return details;
    return details.filter(
      (d) =>
        d.numfact.toLowerCase().includes(q) ||
        d.nart.toLowerCase().includes(q) ||
        d.design.toLowerCase().includes(q) ||
        d.nomClient.toLowerCase().includes(q),
    );
  }, [details, filtreDetail]);

  // Regroupement visuel par facture : n° affiché une seule fois par groupe,
  // séparateur + zébrage alterné PAR FACTURE (lisibilité).
  const detailRows = useMemo(() => {
    let groupe = -1;
    let last = null;
    return detailsFiltres.map((d) => {
      const first = d.numfact !== last;
      if (first) {
        groupe += 1;
        last = d.numfact;
      }
      return { ...d, first, pair: groupe % 2 === 0 };
    });
  }, [detailsFiltres]);

  // Export Excel : 3 onglets fidèles au script Python
  // (SheetJS ne gère pas les remplissages de cellules : pas de lignes grisées)
  const handleExport = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    const enTetes = [
      "Pointage", "NUMFACT", "DATFACT", "MONTANT", "MONTAXES",
      "TIERS", "NOM", "moyen_payment",
    ];
    const ligne = (f) => [
      "☐", f.numfact, f.date, roundInt(f.montant), roundInt(f.montaxes),
      f.tiers, f.nom, f.moyen,
    ];

    // Onglet 1 : toutes les factures du jour (F + A)
    const toutes = groupes.flatMap((g) => g.factures);
    const ws1 = [enTetes, ...toutes.map(ligne)];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(ws1),
      "Factures du Jour",
    );

    // Onglet 2 : factures "Debit" triées par NOM (comme le script)
    const debit = toutes
      .filter((f) => f.moyen === "Debit")
      .sort((a, b) => a.nom.localeCompare(b.nom));
    if (debit.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([enTetes, ...debit.map(ligne)]),
        "Factures Debit",
      );
    }

    // Onglet 3 : détails des factures
    const ws3 = [
      ["NUMFACT", "NART", "DESIGN", "DTVA", "CLIENT", "NOM_CLIENT"],
      ...details.map((d) => [d.numfact, d.nart, d.design, d.dtva, d.client, d.nomClient]),
    ];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(ws3),
      "Détails des Factures",
    );

    XLSX.writeFile(wb, `journal_caisse_${selectedEntreprise}_${data.date}.xlsx`);
  };

  // Export PDF — fidèle au script Python (reportlab) : un tableau par moyen de
  // paiement (en-tête gris, lignes beige, grille) + total, puis section Avoirs.
  const handleExportPdf = () => {
    if (!data) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const ent = (entreprises || []).find(
      (e) => e.nomDossierDBF === selectedEntreprise,
    );
    const trig = ent?.trigramme || selectedEntreprise;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(
      `${trig} - Journal de caisse du ${dateLongueFr(data.date)}.`,
      pageW / 2,
      40,
      { align: "center" },
    );

    let y = 66;
    const styles = {
      fontSize: 8,
      cellPadding: 3,
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      halign: "center",
    };
    const headStyles = {
      fillColor: [128, 128, 128],
      textColor: [245, 245, 245],
      fontStyle: "bold",
    };
    const bodyStyles = { fillColor: [245, 245, 220] }; // beige (comme le script)

    const section = (titre, head, rows, totalLabel, total) => {
      if (y > pageH - 110) {
        doc.addPage();
        y = 40;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(titre, 40, y);
      autoTable(doc, {
        startY: y + 8,
        head: [head],
        body: rows,
        theme: "grid",
        styles,
        headStyles,
        bodyStyles,
        margin: { left: 40, right: 40 },
      });
      y = doc.lastAutoTable.finalY + 16;
      if (y > pageH - 40) {
        doc.addPage();
        y = 40;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`${totalLabel} : ${fmtFranc(total)}`, 40, y);
      y += 28;
    };

    // Un tableau par moyen de paiement
    groupes.forEach((g) => {
      section(
        g.moyen,
        ["N° facture", "Heure", "Tiers", "Montant", "Moyen", "N° CH", "Client"],
        g.factures.map((f) => [
          f.numfact,
          f.heure || "",
          f.tiers,
          fmtFranc(f.montant),
          f.moyen,
          f.numCheque || "",
          f.nom,
        ]),
        "Total MONTANT",
        g.total,
      );
    });

    // Avoirs (montants négatifs, comme le script)
    section(
      "Avoirs",
      ["N° facture", "Heure", "Tiers", "Montant", "N° CH", "Client"],
      avoirs.map((f) => [
        f.numfact,
        f.heure || "",
        f.tiers,
        fmtFranc(f.montant),
        f.numCheque || "",
        f.nom,
      ]),
      "Total MONTANT Avoirs",
      data.totalAvoirs,
    );

    doc.save(`journal_caisse_${selectedEntreprise}_${data.date}.pdf`);
  };

  return (
    <div className="admin-journal-caisse">
      <div className="jc-header">
        <h1>
          <HiCash /> Journal de Caisse
        </h1>
        <div className="jc-actions">
          <div className="jc-day-picker">
            <button
              type="button"
              className="jc-btn icon"
              title="Jour précédent"
              onClick={() => setDate((d) => shiftDay(d, -1))}
            >
              <HiChevronLeft />
            </button>
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
            <button
              type="button"
              className="jc-btn icon"
              title="Jour suivant"
              disabled={date >= today()}
              onClick={() => setDate((d) => shiftDay(d, 1))}
            >
              <HiChevronRight />
            </button>
          </div>

          <button className="jc-btn primary" onClick={handleExport} disabled={!data}>
            <HiDownload /> Excel
          </button>
          <button
            className="jc-btn primary"
            onClick={handleExportPdf}
            disabled={!data}
          >
            <HiDocumentDownload /> PDF
          </button>
        </div>
      </div>

      <div className="jc-note">
        Factures <strong>F</strong> et avoirs <strong>A</strong> du jour, par
        moyen de paiement (champ CHEQUE). Le cache ne conserve que l'année en
        cours et l'année précédente.
      </div>

      {!selectedEntreprise ? (
        <div className="jc-empty">
          Sélectionnez une société dans l'en-tête et choisissez un jour.
        </div>
      ) : loading ? (
        <div className="jc-loading">
          <Loader />
          <p className="jc-hint">
            Lecture des factures et du détail — long au 1ᵉʳ accès, puis mis en
            cache 5 min.
          </p>
        </div>
      ) : error ? (
        <div className="jc-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : data ? (
        <>
          <div className="jc-date-title">Journal du {data.dateFr}</div>

          {/* ===== KPI ===== */}
          <div className="jc-kpis">
            <div className="jc-kpi">
              <div className="jc-kpi-icon"><HiDocumentText /></div>
              <div>
                <span className="jc-kpi-value">{fNum(totaux.nbFactures)}</span>
                <span className="jc-kpi-label">Factures (F)</span>
              </div>
            </div>
            <div className="jc-kpi">
              <div className="jc-kpi-icon"><HiCurrencyDollar /></div>
              <div>
                <span className="jc-kpi-value">{fmtFranc(totaux.montantTotal)}</span>
                <span className="jc-kpi-label">Montant facturé (F)</span>
              </div>
            </div>
            <div className="jc-kpi">
              <div className="jc-kpi-icon warn"><HiReceiptRefund /></div>
              <div>
                <span className="jc-kpi-value">{fNum(totaux.nbAvoirs)}</span>
                <span className="jc-kpi-label">Avoirs (A)</span>
                <span className="jc-kpi-mini">{fmtFranc(totaux.montantAvoirs)}</span>
              </div>
            </div>
            <div className="jc-kpi">
              <div className="jc-kpi-icon net"><HiCurrencyDollar /></div>
              <div>
                <span className="jc-kpi-value">{fmtFranc(totaux.montantNet)}</span>
                <span className="jc-kpi-label">Net (F + avoirs)</span>
              </div>
            </div>
            <div className="jc-kpi">
              <div className="jc-kpi-icon"><HiCreditCard /></div>
              <div>
                <span className="jc-kpi-value">{fNum(totaux.nbMoyens)}</span>
                <span className="jc-kpi-label">Moyens de paiement</span>
              </div>
            </div>
            <div className="jc-kpi">
              <div className="jc-kpi-icon"><HiCollection /></div>
              <div>
                <span className="jc-kpi-value">{fNum(details.length)}</span>
                <span className="jc-kpi-label">Lignes de détail</span>
              </div>
            </div>
          </div>

          {totaux.nbTotal === 0 ? (
            <div className="jc-empty">Aucune facture pour ce jour.</div>
          ) : (
            <>
              {/* ===== Donut répartition par moyen ===== */}
              {donutData.length > 0 && (
                <div className="jc-card donut">
                  <h3>Répartition du montant par moyen de paiement</h3>
                  <div className="jc-donut-layout">
                    <div className="jc-donut-chart">
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie
                            data={donutData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={62}
                            outerRadius={98}
                            paddingAngle={2}
                          >
                            {donutData.map((entry, i) => (
                              <Cell
                                key={entry.name}
                                fill={COLORS[i % COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(v) => fmtFranc(v)}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="jc-donut-legend">
                      {donutData.map((d, i) => (
                        <div className="jc-legend-item" key={d.name}>
                          <i style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="lg-name" title={d.name}>
                            {d.name}
                          </span>
                          <span className="lg-val">{fmtFranc(d.value)}</span>
                          <span className="lg-pct">
                            {donutTotal
                              ? `${((d.value / donutTotal) * 100).toFixed(1)} %`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ===== Un tableau par moyen de paiement (grille) ===== */}
              <div className="jc-groupes">
                {groupes.map((g) => (
                  <div className="jc-card" key={g.moyen}>
                    <div className="jc-card-header">
                      <h3>{g.moyen}</h3>
                      <div className="jc-card-total">
                        {fNum(g.nb)} facture{g.nb > 1 ? "s" : ""} ·{" "}
                        <strong>{fmtFranc(g.total)}</strong>
                      </div>
                    </div>
                    <FacturesTable factures={g.factures} />
                  </div>
                ))}
              </div>

              {/* ===== Avoirs ===== */}
              <div className="jc-card avoirs">
                <div className="jc-card-header">
                  <h3>Avoirs</h3>
                  <div className="jc-card-total">
                    {fNum(avoirs.length)} avoir{avoirs.length > 1 ? "s" : ""} ·{" "}
                    <strong>{fmtFranc(data.totalAvoirs)}</strong>
                  </div>
                </div>
                {avoirs.length === 0 ? (
                  <div className="jc-empty small">Aucun avoir ce jour.</div>
                ) : (
                  <FacturesTable factures={avoirs} />
                )}
              </div>

              {/* ===== Détails des factures ===== */}
              <div className="jc-card">
                <div className="jc-card-header">
                  <h3>Détails des factures</h3>
                  <input
                    type="text"
                    className="jc-filter"
                    placeholder="Filtrer (n° facture, article, désignation, client)…"
                    value={filtreDetail}
                    onChange={(e) => setFiltreDetail(e.target.value)}
                  />
                </div>
                <div className="jc-table-wrap tall">
                  <table className="jc-table">
                    <thead>
                      <tr>
                        <th>N° facture</th>
                        <th>Code article</th>
                        <th>Désignation</th>
                        <th className="right">DTVA</th>
                        <th>Client</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((d, i) => (
                        <tr
                          key={`${d.numfact}-${i}`}
                          className={`${d.first ? "group-start" : ""} ${
                            d.pair ? "g-even" : "g-odd"
                          }`}
                        >
                          <td className="mono fact-cell">
                            {d.first ? d.numfact : ""}
                          </td>
                          <td className="mono">{d.nart || "—"}</td>
                          <td className="wrap">{d.design}</td>
                          <td className="right mono">{fNum(d.dtva)}</td>
                          <td>
                            {d.first ? (
                              <>
                                <span className="jc-client-nom">
                                  {d.nomClient}
                                </span>
                                <span className="jc-client-tiers">
                                  ({d.client})
                                </span>
                              </>
                            ) : (
                              ""
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="jc-card-footer">
                  {fNum(detailsFiltres.length)} ligne
                  {detailsFiltres.length > 1 ? "s" : ""}
                  {filtreDetail ? ` (sur ${fNum(details.length)})` : ""}
                </div>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
};

export default AdminJournalCaisseScreen;