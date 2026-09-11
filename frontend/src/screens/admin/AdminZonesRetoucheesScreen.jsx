// src/screens/admin/AdminZonesRetoucheesScreen.jsx
//
// CLASSEMENT DE TOUTES LES ZONES par nombre de lignes retouchées à la main,
// de la plus retouchée à la moins retouchée.
//
// Complément de la carte du tableau de bord, qui ne montre que le haut du
// classement et seulement les zones à problème. Ici on voit TOUT, y compris
// les zones à zéro et celles qui n'ont aucune ligne bipée — l'absence de
// comptage est elle-même une information.
//
// Pas d'entrée de menu : on y arrive depuis le tableau de bord, comme pour
// « Agents de l'inventaire ».
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  HiPencilAlt,
  HiRefresh,
  HiSearch,
  HiArrowLeft,
  HiDownload,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetStatsZonesRetoucheesQuery } from "../../slices/bipageApiSlice";
import "./AdminInventaireDashboardScreen.css";
import "./AdminZonesRetoucheesScreen.css";

const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

const AdminZonesRetoucheesScreen = () => {
  const entrepriseId = useSelector(selectGlobalEntrepriseId) || "";
  // `tout=1` : le listing veut TOUTES les zones, pas seulement celles à
  // problème — c'est ce qui le distingue de la carte du tableau de bord.
  const { data, isLoading, isFetching, refetch } =
    useGetStatsZonesRetoucheesQuery(
      { entrepriseId, tout: true },
      { skip: !entrepriseId },
    );

  const [emplacement, setEmplacement] = useState("");
  const [recherche, setRecherche] = useState("");
  const [masquerZero, setMasquerZero] = useState(false);

  const emplacements = useMemo(() => data?.emplacements || [], [data]);

  // Une seule liste à plat, tous emplacements confondus : c'est la question
  // posée — « la plus retouchée de tout l'inventaire ». Le filtre par
  // emplacement reste disponible pour comparer dock et magasin.
  const zones = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return emplacements
      .filter((e) => !emplacement || e.emplacement === emplacement)
      .flatMap((e) => e.zones)
      .filter((z) => (masquerZero ? z.touchees > 0 : true))
      .filter((z) => {
        if (!q) return true;
        return [z.code, z.libelle]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort(
        (a, b) =>
          b.touchees - a.touchees ||
          b.pct - a.pct ||
          b.lignes - a.lignes ||
          a.code.localeCompare(b.code, "fr", { numeric: true }),
      );
  }, [emplacements, emplacement, recherche, masquerZero]);

  // Export : le classement sert aussi à transmettre une consigne de recomptage.
  const exporterCsv = () => {
    const entetes = [
      "Emplacement",
      "Zone",
      "Libelle",
      "Lignes",
      "Ajoutees",
      "Corrigees",
      "Retouchees",
      "Part %",
    ];
    const echapper = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lignes = zones.map((z) =>
      [
        z.emplacement,
        z.code,
        z.libelle,
        z.lignes,
        z.ajoutees,
        z.modifiees,
        z.touchees,
        z.pct,
      ]
        .map(echapper)
        .join(";"),
    );
    // BOM : sans lui Excel lit le fichier en ANSI et casse les accents.
    const blob = new Blob(
      ["﻿" + [entetes.map(echapper).join(";"), ...lignes].join("\r\n")],
      { type: "text/csv;charset=utf-8;" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zones_retouchees.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!entrepriseId) {
    return (
      <div className="invd-screen">
        <div className="invd-vide">
          <HiPencilAlt />
          <p>Sélectionnez une société dans l'en-tête.</p>
        </div>
      </div>
    );
  }

  const totaux = data?.totaux;
  const nomsEmplacements = emplacements.map((e) => e.emplacement);

  return (
    <div className="invd-screen">
      <div className="invd-head">
        <h1>
          <HiPencilAlt /> Zones les plus retouchées
        </h1>
        <button
          className="invd-icon-btn"
          onClick={refetch}
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          <HiRefresh className={isFetching ? "invd-spin" : ""} />
        </button>
      </div>

      <p className="invd-sous">
        <Link className="invd-lien zr-retour" to="/admin/inventaire-dashboard">
          <HiArrowLeft /> Tableau de bord
        </Link>
        {data?.session?.nom ? ` · ${data.session.nom}` : ""}
      </p>

      {!data?.active ? (
        <div className="invd-vide">
          <HiPencilAlt />
          <p>Aucun inventaire actif.</p>
        </div>
      ) : (
        <>
          <p className="invd-carte-aide zr-aide">
            Toutes les zones de l'inventaire, de la plus retouchée à la moins
            retouchée. <b>Ajoutées</b> = lignes créées à la main depuis l'écran
            des bipages ; <b>corrigées</b> = lignes du terrain dont le NART ou
            la quantité a été repris. La <b>part</b> rapporte les reprises au
            nombre de lignes de la zone.{" "}
            {totaux ? (
              <>
                Au total : <b>{fmtInt(totaux.touchees)}</b> ligne(s) retouchée(s)
                sur {fmtInt(totaux.lignes)}.
              </>
            ) : null}
          </p>

          <div className="zr-barre">
            <div className="zr-search">
              <HiSearch />
              <input
                type="text"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Code ou libellé de zone…"
              />
            </div>

            <label className="zr-champ">
              <span>Emplacement</span>
              <select
                value={emplacement}
                onChange={(e) => setEmplacement(e.target.value)}
              >
                <option value="">Tous</option>
                {nomsEmplacements.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="zr-check">
              <input
                type="checkbox"
                checked={masquerZero}
                onChange={(e) => setMasquerZero(e.target.checked)}
              />
              Masquer les zones sans reprise
            </label>

            <span className="zr-compte">
              {fmtInt(zones.length)} zone{zones.length > 1 ? "s" : ""}
            </span>

            <button
              className="btn-primary zr-export"
              onClick={exporterCsv}
              disabled={zones.length === 0}
            >
              <HiDownload /> Export CSV
            </button>
          </div>

          <div className="zr-table-wrap">
            <table className="invd-table zr-table">
              <thead>
                <tr>
                  <th className="zr-rang">#</th>
                  <th>Zone</th>
                  <th>Emplacement</th>
                  <th className="invd-num">Lignes</th>
                  <th className="invd-num">Ajoutées</th>
                  <th className="invd-num">Corrigées</th>
                  <th className="invd-num">Retouchées</th>
                  <th className="invd-num">Part</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="zr-vide">
                      Chargement…
                    </td>
                  </tr>
                ) : zones.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="zr-vide">
                      Aucune zone ne correspond.
                    </td>
                  </tr>
                ) : (
                  zones.map((z, i) => (
                    <tr
                      key={`${z.emplacement}-${z.code}`}
                      className={z.touchees === 0 ? "zr-ligne-zero" : ""}
                    >
                      {/* Le rang suit le tri affiché : il n'a de sens que sur
                          la liste telle qu'elle est filtrée. */}
                      <td className="zr-rang">{i + 1}</td>
                      <td>
                        <span className="invd-zone-code">{z.code}</span>
                        {z.libelle && (
                          <span className="invd-zone-lib">{z.libelle}</span>
                        )}
                      </td>
                      <td className="zr-empl">{z.emplacement}</td>
                      <td className="invd-num">
                        {z.lignes === 0 ? (
                          <span className="zr-nil" title="Aucune ligne bipée">
                            —
                          </span>
                        ) : (
                          fmtInt(z.lignes)
                        )}
                      </td>
                      <td className="invd-num">{fmtInt(z.ajoutees)}</td>
                      <td className="invd-num">{fmtInt(z.modifiees)}</td>
                      <td className="invd-num zr-fort">{fmtInt(z.touchees)}</td>
                      <td className="invd-num">
                        <span
                          className={`invd-part${
                            z.pct >= 25 ? " invd-part-fort" : ""
                          }`}
                        >
                          {z.lignes === 0 ? "—" : `${z.pct} %`}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminZonesRetoucheesScreen;
