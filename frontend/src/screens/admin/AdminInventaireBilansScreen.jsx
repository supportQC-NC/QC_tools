// src/screens/admin/AdminInventaireBilansScreen.jsx
//
// BILANS DE CLÔTURE DES INVENTAIRES PAR ZONES.
//
// Pourquoi cet écran : la réinitialisation purge les collectes, les lignes
// bipées et le suivi — sans bilan figé, l'histoire d'un inventaire disparaît
// au suivant. Ici on peut :
//   · FIGER le bilan de l'inventaire actif (photo de synthèse en Mongo +
//     copie Excel/PDF sur le miroir FTP), sans arrêter l'inventaire ;
//   · CLÔTURER l'inventaire (fige le bilan PUIS archive la session — rien
//     n'est purgé, la purge n'arrive qu'à la prochaine initialisation) ;
//   · relire les bilans archivés (Excel/PDF regénérés depuis Mongo, pas
//     besoin du partage ni du FTP) ;
//   · comparer les inventaires ZONE PAR ZONE : une zone en écart dans au
//     moins deux inventaires est dite CHRONIQUE — c'est le rayon à traiter.
//
// La réinitialisation génère aussi un bilan automatique (badge « auto ») si
// aucun n'a été figé à la main : le filet qui garantit qu'aucun inventaire ne
// se perd.

import React, { useMemo, useState } from "react";
import {
  HiArchive,
  HiCheckCircle,
  HiDocumentDownload,
  HiDocumentText,
  HiExclamation,
  HiLockClosed,
  HiRefresh,
  HiTrash,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import {
  useGenererBilanInventaireMutation,
  useGetBilansInventaireQuery,
  useGetComparaisonBilansQuery,
  useDeleteBilanInventaireMutation,
} from "../../slices/inventaireZoneApiSlice";
import "./AdminInventaireBilansScreen.css";

const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

const fmtXpf = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const signe = n > 0 ? "+" : "";
  return `${signe}${Math.round(n).toLocaleString("fr-FR")} F`;
};

const fmtDuree = (ms) => {
  if (!ms || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return reste ? `${h} h ${reste} min` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
};

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const MAX_LIGNES_COMPARAISON = 50;

const AdminInventaireBilansScreen = () => {
  const entrepriseId = useSelector(selectGlobalEntrepriseId) || "";
  const skip = { skip: !entrepriseId };

  const bilansQ = useGetBilansInventaireQuery(entrepriseId, skip);
  const compQ = useGetComparaisonBilansQuery(entrepriseId, skip);
  const [genererBilan, { isLoading: generation }] =
    useGenererBilanInventaireMutation();
  const [deleteBilan] = useDeleteBilanInventaireMutation();

  // Par défaut on ne montre que les zones chroniques (c'est la question de
  // l'écran) ; la case ouvre le tableau à toutes les zones comparées.
  const [toutesZones, setToutesZones] = useState(false);

  // Retour des actions (pas de toaster dans l'app : bandeau local, comme
  // l'écran Progression).
  const [feedback, setFeedback] = useState(null); // { tone: "ok"|"err", texte }

  const active = bilansQ.data?.active || null;
  const bilans = bilansQ.data?.bilans || [];

  const comparaison = useMemo(() => {
    const zones = compQ.data?.zones || [];
    return toutesZones ? zones : zones.filter((z) => z.chronique);
  }, [compQ.data, toutesZones]);

  const lancerBilan = async (cloturer) => {
    if (
      cloturer &&
      !window.confirm(
        `Clôturer l'inventaire « ${active?.nom} » ?\n\nLe bilan sera figé puis l'inventaire passera en archive. Rien n'est purgé : les données restent lisibles jusqu'à la prochaine initialisation.`,
      )
    ) {
      return;
    }
    setFeedback(null);
    try {
      const r = await genererBilan({ entrepriseId, cloturer }).unwrap();
      setFeedback({ tone: "ok", texte: r.message || "Bilan figé." });
    } catch (err) {
      setFeedback({
        tone: "err",
        texte: err?.data?.message || "Échec de la génération du bilan.",
      });
    }
  };

  const supprimerBilan = async (b) => {
    if (
      !window.confirm(
        `Supprimer le bilan « ${b.sessionNom} » du ${fmtDate(b.genereAt)} ?\n\nCette synthèse archivée ne pourra pas être recalculée si l'inventaire a été purgé.`,
      )
    ) {
      return;
    }
    try {
      await deleteBilan({ entrepriseId, id: b._id }).unwrap();
      setFeedback({ tone: "ok", texte: "Bilan supprimé." });
    } catch (err) {
      setFeedback({
        tone: "err",
        texte: err?.data?.message || "Échec de la suppression.",
      });
    }
  };

  if (!entrepriseId) {
    return (
      <div className="invb-screen">
        <div className="invb-vide">
          <HiArchive />
          <p>Sélectionnez une société dans l'en-tête.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="invb-screen">
      <header className="invb-tete">
        <div>
          <h1>
            <HiArchive /> Bilans d'inventaire
          </h1>
          <p className="invb-sous">
            La synthèse figée de chaque inventaire (progression, agents, temps,
            écarts valorisés) — conservée même après la purge de la
            réinitialisation — et la comparaison des zones d'un inventaire à
            l'autre.
          </p>
        </div>
        <button
          className="invb-icon-btn"
          onClick={() => {
            bilansQ.refetch();
            compQ.refetch();
          }}
          title="Rafraîchir"
        >
          <HiRefresh
            className={bilansQ.isFetching || compQ.isFetching ? "invb-spin" : ""}
          />
        </button>
      </header>

      {/* ── Inventaire actif : figer / clôturer ── */}
      <section className="invb-carte">
        <h2>Inventaire en cours</h2>
        {bilansQ.isLoading ? (
          <p className="invb-attente">Chargement…</p>
        ) : !active ? (
          <p className="invb-attente">
            Aucun inventaire actif. Les bilans ci-dessous restent consultables.
          </p>
        ) : (
          <div className="invb-actif">
            <div className="invb-actif-infos">
              <b>{active.nom}</b>
              <span>démarré le {fmtDate(active.createdAt)}</span>
            </div>
            <div className="invb-actions">
              <button
                className="invb-btn"
                disabled={generation}
                onClick={() => lancerBilan(false)}
                title="Photographie la synthèse de l'inventaire actif (Mongo + copie FTP) sans l'arrêter. Regénérable à volonté."
              >
                <HiDocumentText /> Figer le bilan
              </button>
              <button
                className="invb-btn invb-btn-primaire"
                disabled={generation}
                onClick={() => lancerBilan(true)}
                title="Fige le bilan puis archive l'inventaire. Rien n'est purgé."
              >
                <HiLockClosed /> Clôturer l'inventaire
              </button>
              {generation && (
                <span className="invb-attente">
                  Génération en cours (les écarts relisent chaque ligne bipée)…
                </span>
              )}
            </div>
          </div>
        )}
        {feedback && (
          <p className={`invb-feedback invb-feedback-${feedback.tone}`}>
            {feedback.texte}
          </p>
        )}
      </section>

      {/* ── Bilans archivés ── */}
      <section className="invb-carte">
        <h2>Bilans archivés</h2>
        {bilansQ.isLoading ? (
          <p className="invb-attente">Chargement…</p>
        ) : bilans.length === 0 ? (
          <p className="invb-attente">
            Aucun bilan pour l'instant. Figez celui de l'inventaire en cours,
            ou laissez la prochaine réinitialisation en générer un
            automatiquement.
          </p>
        ) : (
          <div className="invb-table-wrap">
            <table className="invb-table">
              <thead>
                <tr>
                  <th>Inventaire</th>
                  <th>Bilan généré</th>
                  <th className="invb-num">Zones complètes</th>
                  <th className="invb-num">Agents</th>
                  <th className="invb-num">Articles</th>
                  <th className="invb-num">Temps effectif</th>
                  <th className="invb-num">Écart net</th>
                  <th className="invb-num">Ampleur</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bilans.map((b) => (
                  <tr key={b._id}>
                    <td>
                      <span className="invb-nom">{b.sessionNom || "—"}</span>
                      <span className="invb-detail">
                        du {fmtDate(b.debutAt)} au {fmtDate(b.finAt)}
                      </span>
                    </td>
                    <td>
                      {fmtDate(b.genereAt)}
                      {b.auto ? (
                        <span
                          className="invb-tag"
                          title="Généré automatiquement par la réinitialisation, juste avant la purge."
                        >
                          auto
                        </span>
                      ) : (
                        <span
                          className="invb-tag invb-tag-ok"
                          title="Figé à la main depuis cet écran."
                        >
                          <HiCheckCircle /> clôture
                        </span>
                      )}
                    </td>
                    <td className="invb-num">
                      {fmtInt(b.progression?.completes)} /{" "}
                      {fmtInt(b.progression?.totalZones)}
                      <span className="invb-detail-num">
                        {b.progression?.pct ?? 0} %
                      </span>
                    </td>
                    <td className="invb-num">{fmtInt(b.nbAgents)}</td>
                    <td className="invb-num">
                      {fmtInt(b.comptage?.totalArticles)}
                    </td>
                    <td className="invb-num">
                      {fmtDuree(b.comptage?.tempsActifMs)}
                    </td>
                    <td
                      className={`invb-num invb-fort ${
                        (b.ecartsTotaux?.totalEcartXpf || 0) < 0
                          ? "invb-moins"
                          : "invb-plus"
                      }`}
                    >
                      {fmtXpf(b.ecartsTotaux?.totalEcartXpf)}
                    </td>
                    <td
                      className="invb-num"
                      title="Σ|écart| par ligne : l'ampleur totale du désordre, signe ignoré."
                    >
                      {fmtXpf(b.ecartsTotaux?.ecartAbsXpf)}
                    </td>
                    <td className="invb-num invb-actions-cell">
                      <button
                        className="invb-mini-btn"
                        title="Télécharger l'Excel du bilan"
                        onClick={() =>
                          window.open(
                            `/api/inventaires-zones/${entrepriseId}/bilans/${b._id}/excel`,
                          )
                        }
                      >
                        <HiDocumentDownload /> Excel
                      </button>
                      <button
                        className="invb-mini-btn"
                        title="Ouvrir le PDF de synthèse"
                        onClick={() =>
                          window.open(
                            `/api/inventaires-zones/${entrepriseId}/bilans/${b._id}/pdf`,
                          )
                        }
                      >
                        <HiDocumentText /> PDF
                      </button>
                      <button
                        className="invb-mini-btn invb-mini-danger"
                        title="Supprimer ce bilan"
                        onClick={() => supprimerBilan(b)}
                      >
                        <HiTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Comparaison inter-inventaires ── */}
      <section className="invb-carte">
        <h2>Zones d'un inventaire à l'autre</h2>
        <p className="invb-aide">
          L'écart net valorisé de chaque zone, inventaire par inventaire. Une
          zone <b>chronique</b> <HiExclamation className="invb-ico-chronique" />{" "}
          est en écart dans au moins deux inventaires : c'est le rayon à aller
          voir (tenue du rayon, vols, erreurs de gisement récurrentes…).
        </p>
        {compQ.isLoading ? (
          <p className="invb-attente">Chargement…</p>
        ) : (compQ.data?.bilans || []).length < 2 ? (
          <p className="invb-attente">
            Il faut au moins deux bilans archivés pour comparer les
            inventaires. {bilans.length === 1 ? "Un seul bilan pour l'instant." : ""}
          </p>
        ) : (
          <>
            <label className="invb-filtre">
              <input
                type="checkbox"
                checked={toutesZones}
                onChange={(e) => setToutesZones(e.target.checked)}
              />
              Afficher toutes les zones comparées (pas seulement les
              chroniques)
            </label>
            {comparaison.length === 0 ? (
              <p className="invb-attente">
                Aucune zone chronique : aucune zone n'est en écart dans deux
                inventaires ou plus.
              </p>
            ) : (
              <div className="invb-table-wrap">
                <table className="invb-table invb-comp">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      {(compQ.data?.bilans || []).map((c) => (
                        <th key={c._id} className="invb-num" title={c.sessionNom}>
                          {fmtDate(c.genereAt).slice(0, 8)}
                        </th>
                      ))}
                      <th className="invb-num">Ampleur cumulée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparaison.slice(0, MAX_LIGNES_COMPARAISON).map((z) => (
                      <tr
                        key={`${z.zoneCode}|${z.zoneType}`}
                        className={z.chronique ? "invb-ligne-chronique" : ""}
                      >
                        <td>
                          <span className="invb-nom">
                            {z.chronique && (
                              <HiExclamation className="invb-ico-chronique" />
                            )}
                            {z.zoneCode}
                            {z.zoneType ? ` · ${z.zoneType}` : ""}
                          </span>
                          {z.zoneLibelle && (
                            <span className="invb-detail">{z.zoneLibelle}</span>
                          )}
                        </td>
                        {z.parBilan.map((c, i) => (
                          <td
                            key={i}
                            className={`invb-num ${
                              c && c.totalEcartXpf < 0
                                ? "invb-moins"
                                : c && c.totalEcartXpf > 0
                                  ? "invb-plus"
                                  : ""
                            }`}
                            title={
                              c
                                ? `${fmtInt(c.nbEcarts)} article(s) en écart sur ${fmtInt(c.totalArticles)} · ampleur ${fmtXpf(c.ecartAbsXpf)}`
                                : "Zone non comptée dans cet inventaire"
                            }
                          >
                            {c ? fmtXpf(c.totalEcartXpf) : "—"}
                          </td>
                        ))}
                        <td className="invb-num invb-fort">
                          {fmtXpf(z.ampleurCumulee)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {comparaison.length > MAX_LIGNES_COMPARAISON && (
                  <p className="invb-attente">
                    + {fmtInt(comparaison.length - MAX_LIGNES_COMPARAISON)}{" "}
                    autres zones — les plus marquantes sont en tête (nombre
                    d'inventaires en écart, puis ampleur cumulée).
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default AdminInventaireBilansScreen;
