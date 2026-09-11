// src/screens/admin/AdminEcartsZonesScreen.jsx
//
// CLASSEMENT DES ÉCARTS DE STOCK PAR ZONE, du plus gros au plus petit.
//
// Complément de la carte du tableau de bord, qui n'en montre que les dix
// premières. Ici : toutes les zones déposées, avec un filtre sur le SENS de
// l'écart — manquants seuls, excédents seuls, ou les deux.
//
// Écart = quantité comptée − stock théorique (ΣS1..S5 du DBF), valorisé au
// prix d'achat. Le calcul vient du même endpoint que le récap (mode `resume`),
// il n'est pas refait ici : une seule vérité sur les écarts.
//
// Pas d'entrée de menu : on y arrive depuis le tableau de bord.
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  HiScale,
  HiRefresh,
  HiSearch,
  HiArrowLeft,
  HiDownload,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetRecapZonesResumeQuery } from "../../slices/inventaireCollecteApiSlice";
import "./AdminInventaireDashboardScreen.css";
// Coque de listing (barre de filtres, tableau défilant) partagée avec le
// classement des zones retouchées : les deux écrans doivent se ressembler.
import "./AdminZonesRetoucheesScreen.css";

const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

const fmtXpf = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const signe = n > 0 ? "+" : "";
  return `${signe}${Math.round(n).toLocaleString("fr-FR")} F`;
};

const fmtEcart = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const signe = n > 0 ? "+" : "";
  return `${signe}${n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}`;
};

const AdminEcartsZonesScreen = () => {
  const entrepriseId = useSelector(selectGlobalEntrepriseId) || "";
  const { data, isLoading, isFetching, refetch } = useGetRecapZonesResumeQuery(
    entrepriseId,
    { skip: !entrepriseId },
  );

  const [sens, setSens] = useState("tous"); // tous | manquants | excedents
  const [emplacement, setEmplacement] = useState("");
  const [recherche, setRecherche] = useState("");
  const [classerPar, setClasserPar] = useState("valeur"); // valeur | quantite
  const [masquerNuls, setMasquerNuls] = useState(false);

  const toutes = useMemo(() => data?.zones || [], [data]);

  const emplacements = useMemo(
    () => [...new Set(toutes.map((z) => z.zoneType).filter(Boolean))].sort(),
    [toutes],
  );

  const zones = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    // Le critère de classement décide aussi du critère de filtrage : filtrer
    // les « manquants » sur la valeur alors qu'on classe sur les quantités
    // donnerait une liste incohérente avec sa propre colonne de tri.
    const cle = (z) =>
      classerPar === "valeur" ? z.totalEcartXpf : z.totalEcart;

    return toutes
      .filter((z) => !emplacement || z.zoneType === emplacement)
      .filter((z) => {
        const v = cle(z);
        if (sens === "manquants") return v < 0;
        if (sens === "excedents") return v > 0;
        return masquerNuls ? v !== 0 : true;
      })
      .filter((z) => {
        if (!q) return true;
        return [z.zoneCode, z.zoneLibelle]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      // Toujours du plus gros au plus petit EN VALEUR ABSOLUE : avec un filtre
      // sur un seul sens, cela revient au tri naturel ; sans filtre, cela met
      // en tête les écarts les plus lourds quel que soit leur signe.
      .sort(
        (a, b) =>
          Math.abs(cle(b)) - Math.abs(cle(a)) ||
          a.zoneCode.localeCompare(b.zoneCode, "fr", { numeric: true }),
      );
  }, [toutes, sens, emplacement, recherche, classerPar, masquerNuls]);

  // Totaux de ce qui est AFFICHÉ : avec un filtre sur le sens, le total global
  // de la réponse ne voudrait plus rien dire à l'écran.
  const totauxAffiches = useMemo(
    () =>
      zones.reduce(
        (acc, z) => {
          acc.xpf += z.totalEcartXpf;
          acc.unites += z.totalEcart;
          acc.articles += z.nbEcarts;
          return acc;
        },
        { xpf: 0, unites: 0, articles: 0 },
      ),
    [zones],
  );

  const exporterCsv = () => {
    const entetes = [
      "Zone",
      "Libelle",
      "Emplacement",
      "Articles",
      "Articles en ecart",
      "Ecart unites",
      "Ecart XPF",
    ];
    const echapper = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lignes = zones.map((z) =>
      [
        z.zoneCode,
        z.zoneLibelle,
        z.zoneType,
        z.totalArticles,
        z.nbEcarts,
        z.totalEcart,
        Math.round(z.totalEcartXpf),
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
    a.download = "ecarts_par_zone.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!entrepriseId) {
    return (
      <div className="invd-screen">
        <div className="invd-vide">
          <HiScale />
          <p>Sélectionnez une société dans l'en-tête.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="invd-screen">
      <div className="invd-head">
        <h1>
          <HiScale /> Écarts de stock par zone
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

      <p className="invd-carte-aide zr-aide">
        <b>Écart</b> = quantité comptée − stock théorique, valorisé au prix
        d'achat. Un <span className="invd-ec-moins">manquant</span> est négatif,
        un <span className="invd-ec-plus">excédent</span> positif. Le classement
        va du plus gros au plus petit, sans regarder le signe — sauf si vous
        filtrez sur un sens.
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
          <span>Sens de l'écart</span>
          <select value={sens} onChange={(e) => setSens(e.target.value)}>
            <option value="tous">Tous</option>
            <option value="manquants">Manquants seulement</option>
            <option value="excedents">Excédents seulement</option>
          </select>
        </label>

        <label className="zr-champ">
          <span>Classer par</span>
          <select
            value={classerPar}
            onChange={(e) => setClasserPar(e.target.value)}
          >
            <option value="valeur">Valeur (F)</option>
            <option value="quantite">Quantité (unités)</option>
          </select>
        </label>

        <label className="zr-champ">
          <span>Emplacement</span>
          <select
            value={emplacement}
            onChange={(e) => setEmplacement(e.target.value)}
          >
            <option value="">Tous</option>
            {emplacements.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {/* Sans effet quand un sens est déjà choisi : le filtre sur le signe
            écarte déjà les zones à zéro. */}
        {sens === "tous" && (
          <label className="zr-check">
            <input
              type="checkbox"
              checked={masquerNuls}
              onChange={(e) => setMasquerNuls(e.target.checked)}
            />
            Masquer les zones sans écart
          </label>
        )}

        <span className="zr-compte">
          {fmtInt(zones.length)} zone{zones.length > 1 ? "s" : ""} ·{" "}
          <b
            className={
              totauxAffiches.xpf < 0 ? "invd-ec-moins" : "invd-ec-plus"
            }
          >
            {fmtXpf(totauxAffiches.xpf)}
          </b>
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
              <th className="invd-num">Articles</th>
              <th className="invd-num">En écart</th>
              <th className="invd-num">Écart (unités)</th>
              <th className="invd-num">Écart valorisé</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="zr-vide">
                  Calcul des écarts… (chaque ligne bipée est comparée au stock)
                </td>
              </tr>
            ) : !toutes.length ? (
              <tr>
                <td colSpan={7} className="zr-vide">
                  Aucun comptage déposé : il n'y a pas encore d'écart à mesurer.
                </td>
              </tr>
            ) : zones.length === 0 ? (
              <tr>
                <td colSpan={7} className="zr-vide">
                  Aucune zone ne correspond à ce filtre.
                </td>
              </tr>
            ) : (
              zones.map((z, i) => (
                <tr
                  key={`${z.zoneCode}-${z.zoneType}`}
                  className={z.totalEcartXpf === 0 ? "zr-ligne-zero" : ""}
                >
                  <td className="zr-rang">{i + 1}</td>
                  <td>
                    <span className="invd-zone-code">{z.zoneCode}</span>
                    {z.zoneLibelle && (
                      <span className="invd-zone-lib">{z.zoneLibelle}</span>
                    )}
                  </td>
                  <td className="zr-empl">{z.zoneType || "—"}</td>
                  <td className="invd-num">{fmtInt(z.totalArticles)}</td>
                  <td className="invd-num">{fmtInt(z.nbEcarts)}</td>
                  <td
                    className={`invd-num ${
                      z.totalEcart < 0
                        ? "invd-ec-moins"
                        : z.totalEcart > 0
                          ? "invd-ec-plus"
                          : ""
                    }`}
                  >
                    {fmtEcart(z.totalEcart)}
                  </td>
                  <td
                    className={`invd-num invd-ec-val ${
                      z.totalEcartXpf < 0
                        ? "invd-ec-moins"
                        : z.totalEcartXpf > 0
                          ? "invd-ec-plus"
                          : ""
                    }`}
                  >
                    {fmtXpf(z.totalEcartXpf)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminEcartsZonesScreen;
