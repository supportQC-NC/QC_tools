// src/screens/admin/AdminInventaireDashboardScreen.jsx
//
// TABLEAU DE BORD DE L'INVENTAIRE EN COURS — la vue qu'on ouvre pour répondre
// à « où en est-on ? » sans avoir à visiter quatre écrans.
//
// ⚠️ Aucun agrégat nouveau côté serveur : la page recoupe trois endpoints qui
// existaient déjà, chacun pour ce qu'il sait faire.
//   · /inventaires-zones/:id/active   → les zones et leurs 3 phases (état zone
//                                        par zone, d'où la répartition) ;
//   · /inventaires-collecte/agents-inventaire/:id → qui a travaillé, combien,
//                                        combien de temps ;
//   · /inventaires-collecte/suivi-bipage/:id      → les comptages déposés,
//                                        articles et unités.
// Les recouper ici plutôt que d'écrire un quatrième endpoint évite d'avoir
// deux vérités sur les mêmes chiffres.
//
// Les trois requêtes sont INDÉPENDANTES et s'affichent au fur et à mesure :
// le suivi bipage est le plus lourd (il relit les collectes), la progression
// arrive tout de suite. Une page qui attendrait tout resterait vide plusieurs
// secondes alors que l'essentiel est déjà connu.
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  HiChartPie,
  HiRefresh,
  HiUserGroup,
  HiClipboardList,
  HiCube,
  HiClock,
  HiArrowRight,
  HiPencilAlt,
  HiScale,
} from "react-icons/hi";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetActiveSessionQuery } from "../../slices/inventaireZoneApiSlice";
import {
  useGetAgentsInventaireQuery,
  useGetSuiviBipageQuery,
  useGetRecapZonesResumeQuery,
} from "../../slices/inventaireCollecteApiSlice";
import { useGetStatsZonesRetoucheesQuery } from "../../slices/bipageApiSlice";
import "./AdminInventaireDashboardScreen.css";

const PHASES = [
  { cle: "papillonnage", label: "Papillonnage", couleur: "#f59e0b" },
  { cle: "bipage", label: "Comptage", couleur: "#8b5cf6" },
  { cle: "controle", label: "Contrôle", couleur: "#22c55e" },
];

// Couleurs des graphiques — validées contre le fond sombre (#12121a) avec le
// validateur data-viz le 30/10/2026 :
//  · le trio de phases ci-dessus passe la séparation daltonisme (ΔE 31,8) ;
//  · états de zone : complète = BLEU, entamée = AMBRE (ΔE 29,9), pas
//    commencée = GRIS neutre — l'ancien vert/orange/rouge confondait vert et
//    orange en vision protan (ΔE 5,7), et une zone pas commencée n'est pas une
//    erreur, elle n'a pas à crier en rouge ;
//  · écarts : divergent manquant = ROUGE / excédent = BLEU (ΔE 19,2), jamais
//    vert/rouge.
const CH = {
  grille: "#2a2a3a",
  axe: "#a7a7b8",
  bleu: "#3987e5",
  complete: "#3987e5",
  entamee: "#f59e0b",
  vierge: "#55556b",
  manquant: "#e66767",
  excedent: "#3987e5",
};

const ETATS_ZONE = [
  { cle: "completes", label: "Complètes", couleur: CH.complete },
  { cle: "entamees", label: "Entamées", couleur: CH.entamee },
  { cle: "vierges", label: "Pas commencées", couleur: CH.vierge },
];

// Axe : milliers compactés pour rester lisible (12 400 → « 12,4 k »).
const fmtCompact = (n) => {
  if (typeof n !== "number") return "";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (abs >= 1e3) return `${(n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
  return String(n);
};

const fmtJourCourt = (iso) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Tooltip commun : fond carte sombre, une ligne par série, valeurs formatées
// selon l'unité portée par la série (`xpf`, `nb` par défaut).
const InvdTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="invd-tooltip">
      {label != null && <div className="invd-tooltip-label">{label}</div>}
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div key={p.dataKey || p.name} className="invd-tooltip-row">
            <span
              className="invd-tooltip-dot"
              style={{ background: p.color || p.stroke || p.payload?.fill }}
            />
            {p.name} :{" "}
            <strong>
              {p.unit === "xpf"
                ? `${Math.round(p.value).toLocaleString("fr-FR")} F`
                : fmtInt(p.value)}
            </strong>
          </div>
        ))}
    </div>
  );
};

const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

// Durées : minutes tant que c'est lisible, puis heures. Même règle que les
// écrans de suivi — « 412 min » ne parle à personne au-delà d'une heure.
const fmtDuree = (ms) => {
  if (!ms || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return reste ? `${h} h ${reste} min` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
};

// Montant en francs. Pas de décimale : le XPF n'en a pas, et un écart
// d'inventaire se lit en milliers, pas à la virgule près.
const fmtXpf = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const signe = n > 0 ? "+" : "";
  return `${signe}${Math.round(n).toLocaleString("fr-FR")} F`;
};

// Écart en unités : le SIGNE porte l'information (manquant / excédent), il ne
// doit pas disparaître.
const fmtEcart = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const signe = n > 0 ? "+" : "";
  return `${signe}${n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}`;
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

/** Compteur principal. `ton` colore la barre de gauche. */
const Kpi = ({ label, valeur, ton = "", icone, aide }) => (
  <div className={`invd-kpi ${ton ? `invd-kpi-${ton}` : ""}`.trim()} title={aide || ""}>
    <span className="invd-kpi-lbl">
      {icone} {label}
    </span>
    <span className="invd-kpi-val">{valeur}</span>
  </div>
);

const Barre = ({ pct, couleur }) => (
  <span className="invd-bar">
    <span
      className="invd-bar-fill"
      style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: couleur }}
    />
  </span>
);

const AdminInventaireDashboardScreen = () => {
  const entrepriseId = useSelector(selectGlobalEntrepriseId) || "";
  const skip = { skip: !entrepriseId };

  const session = useGetActiveSessionQuery(entrepriseId, skip);
  const agents = useGetAgentsInventaireQuery({ entrepriseId }, skip);
  const bipage = useGetSuiviBipageQuery({ entrepriseId }, skip);
  // Agrégat à part : c'est un $group Mongo sur les lignes bipées, pas un
  // recoupement des autres réponses.
  const retouches = useGetStatsZonesRetoucheesQuery({ entrepriseId }, skip);
  // La plus lourde des requêtes : chaque ligne bipée est comparée au stock du
  // DBF. Elle a son propre état de chargement, le reste de la page n'attend pas.
  const ecarts = useGetRecapZonesResumeQuery(entrepriseId, skip);

  const rafraichir = () => {
    session.refetch();
    agents.refetch();
    bipage.refetch();
    retouches.refetch();
    ecarts.refetch();
  };

  // ⚠️ La réponse de /active est { active, progress } — PAS { session }.
  // Lire à côté rendait `doc` toujours truthy (l'enveloppe elle-même) : l'état
  // « aucun inventaire actif » ne s'affichait jamais et le tableau de bord
  // montrait 0 zone sur un inventaire qui en compte 622.
  const doc = session.data?.active || null;
  const zones = useMemo(() => doc?.zones || [], [doc]);

  // Progression recalculée ICI à partir des zones : le serveur la renvoie déjà
  // (`/progress`), mais on tient de toute façon les zones pour la répartition —
  // une requête de moins, et un seul jeu de chiffres à l'écran.
  const stats = useMemo(() => {
    const total = zones.length;
    const parPhase = { papillonnage: 0, bipage: 0, controle: 0 };
    let completes = 0;
    let entamees = 0;

    zones.forEach((z) => {
      let n = 0;
      PHASES.forEach((p) => {
        if (z[p.cle]?.fait) {
          parPhase[p.cle] += 1;
          n += 1;
        }
      });
      if (n === PHASES.length) completes += 1;
      else if (n > 0) entamees += 1;
    });

    const faites = parPhase.papillonnage + parPhase.bipage + parPhase.controle;
    const totalPhases = total * PHASES.length;

    return {
      total,
      completes,
      entamees,
      vierges: total - completes - entamees,
      parPhase,
      pct: totalPhases ? Math.round((faites / totalPhases) * 100) : 0,
    };
  }, [zones]);

  const tAgents = agents.data?.totaux;
  const tBipage = bipage.data?.totaux;
  // Top 5 : le serveur trie déjà par production décroissante.
  const topAgents = (agents.data?.agents || []).slice(0, 5);

  // ── Progression CUMULÉE dans le temps ──
  // Chaque phase faite porte son horodatage (`zone.<phase>.at`) : on en tire,
  // jour par jour depuis le début de l'inventaire, le nombre cumulé de zones
  // ayant franchi chaque phase. C'est la courbe « avance-t-on assez vite ? ».
  const serieCumulative = useMemo(() => {
    if (!zones.length) return [];
    const jour = (d) => new Date(d).toISOString().slice(0, 10);
    const evenements = { papillonnage: new Map(), bipage: new Map(), controle: new Map() };
    let premier = doc?.createdAt ? jour(doc.createdAt) : null;
    for (const z of zones) {
      for (const p of PHASES) {
        const at = z[p.cle]?.fait && z[p.cle]?.at;
        if (!at) continue;
        const j = jour(at);
        evenements[p.cle].set(j, (evenements[p.cle].get(j) || 0) + 1);
        if (!premier || j < premier) premier = j;
      }
    }
    if (!premier) return [];
    const points = [];
    const cumuls = { papillonnage: 0, bipage: 0, controle: 0 };
    const fin = jour(new Date());
    // Un point par jour calendaire, du début à aujourd'hui (90 j de garde-fou).
    for (
      let d = new Date(`${premier}T00:00:00`), n = 0;
      jour(d) <= fin && n < 90;
      d.setDate(d.getDate() + 1), n++
    ) {
      const j = jour(d);
      const point = { jour: fmtJourCourt(j) };
      for (const p of PHASES) {
        cumuls[p.cle] += evenements[p.cle].get(j) || 0;
        point[p.label] = cumuls[p.cle];
      }
      points.push(point);
    }
    return points;
  }, [zones, doc]);

  // ── Activité de comptage par jour ──
  // Unités comptées par jour de dépôt (ou d'ouverture si pas encore déposé) :
  // le rythme réel du terrain, pas seulement le total.
  const activiteParJour = useMemo(() => {
    const parJour = new Map();
    for (const b of bipage.data?.bipages || []) {
      const at = b.finAt || b.debutAt;
      if (!at) continue;
      const j = new Date(at).toISOString().slice(0, 10);
      const cur = parJour.get(j) || { jour: j, unites: 0, articles: 0, zones: 0 };
      cur.unites += b.totalQuantite || 0;
      cur.articles += b.totalArticles || 0;
      cur.zones += 1;
      parJour.set(j, cur);
    }
    return [...parJour.values()]
      .sort((a, b) => a.jour.localeCompare(b.jour))
      .map((x) => ({ ...x, label: fmtJourCourt(x.jour) }));
  }, [bipage.data]);

  // ── Avancement par emplacement (MAGASIN / DOCK / entrepôts) ──
  const parEmplacement = useMemo(() => {
    const groupes = new Map();
    for (const z of zones) {
      const t = String(z.type || "").trim().toUpperCase() || "—";
      const g = groupes.get(t) || { emplacement: t, completes: 0, entamees: 0, vierges: 0, total: 0 };
      let n = 0;
      for (const p of PHASES) if (z[p.cle]?.fait) n += 1;
      if (n === PHASES.length) g.completes += 1;
      else if (n > 0) g.entamees += 1;
      else g.vierges += 1;
      g.total += 1;
      groupes.set(t, g);
    }
    return [...groupes.values()].sort((a, b) => b.total - a.total);
  }, [zones]);

  // ── Écarts : top des zones par montant d'écart (valeur absolue) ──
  // Divergent : la barre part de zéro, manquant à gauche, excédent à droite —
  // deux séries empilées sur la même bande (l'une des deux est toujours nulle),
  // pour garder le coin arrondi côté donnée et carré côté axe.
  const ecartsChart = useMemo(() => {
    const zonesEc = ecarts.data?.zones || [];
    return [...zonesEc]
      .filter((z) => Number(z.totalEcartXpf) !== 0)
      .sort((a, b) => Math.abs(b.totalEcartXpf) - Math.abs(a.totalEcartXpf))
      .slice(0, 12)
      .map((z) => ({
        label: `${z.zoneCode}${z.zoneType ? ` · ${z.zoneType}` : ""}`,
        excedent: z.totalEcartXpf > 0 ? z.totalEcartXpf : null,
        manquant: z.totalEcartXpf < 0 ? z.totalEcartXpf : null,
      }));
  }, [ecarts.data]);

  if (!entrepriseId) {
    return (
      <div className="invd-screen">
        <div className="invd-vide">
          <HiChartPie />
          <p>Sélectionnez une société dans l'en-tête.</p>
        </div>
      </div>
    );
  }

  if (session.isLoading) {
    return (
      <div className="invd-screen">
        <div className="invd-vide">
          <p>Chargement…</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="invd-screen">
        <div className="invd-vide">
          <HiChartPie />
          <p>
            Aucun inventaire actif. Démarrez-en un depuis «&nbsp;Progression
            inventaire&nbsp;».
          </p>
          <Link className="invd-lien" to="/admin/inventaire-progression">
            Aller à la progression <HiArrowRight />
          </Link>
        </div>
      </div>
    );
  }

  // ⚠️ Le serveur renvoie un bloc par emplacement même quand aucune zone n'y
  // a été retouchée (il porte les totaux) : on ne garde ici que ceux qui ont
  // quelque chose à montrer, sinon la carte affiche des colonnes vides.
  const emplacements = (retouches.data?.emplacements || []).filter(
    (e) => e.zones.length > 0,
  );
  const tRetouches = retouches.data?.totaux;

  const zonesEcart = ecarts.data?.zones || [];
  const tEcarts = ecarts.data?.totaux;

  const enCours =
    session.isFetching ||
    agents.isFetching ||
    bipage.isFetching ||
    retouches.isFetching ||
    ecarts.isFetching;

  return (
    <div className="invd-screen">
      <div className="invd-head">
        <h1>
          <HiChartPie /> Tableau de bord de l'inventaire
        </h1>
        <button
          className="invd-icon-btn"
          onClick={rafraichir}
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          <HiRefresh className={enCours ? "invd-spin" : ""} />
        </button>
      </div>
      <p className="invd-sous">
        <b>{doc.nom || "Inventaire en cours"}</b> · démarré le{" "}
        {fmtDate(doc.createdAt)}
      </p>

      {/* ── Compteurs principaux ─────────────────────────────────────────── */}
      <div className="invd-kpis">
        <Kpi
          label="Avancement"
          valeur={`${stats.pct} %`}
          ton="accent"
          aide="Part des phases faites sur l'ensemble des zones (3 phases par zone)."
        />
        <Kpi
          label="Zones complètes"
          valeur={`${fmtInt(stats.completes)} / ${fmtInt(stats.total)}`}
          ton="ok"
          icone={<HiClipboardList />}
        />
        <Kpi
          label="Agents"
          valeur={fmtInt(tAgents?.nbAgents)}
          icone={<HiUserGroup />}
          aide="Personnes ayant travaillé sur cet inventaire."
        />
        <Kpi
          label="Articles comptés"
          valeur={fmtInt(tBipage?.totalArticles)}
          icone={<HiCube />}
          aide="Références distinctes bipées, toutes zones confondues."
        />
        <Kpi
          label="Unités"
          valeur={fmtInt(tBipage?.totalQuantite)}
          icone={<HiCube />}
        />
        <Kpi
          label="Écart valorisé"
          valeur={fmtXpf(tEcarts?.totalEcartXpf)}
          ton={tEcarts?.nbEcarts ? "warn" : ""}
          icone={<HiScale />}
          aide="Quantité comptée − stock théorique, valorisée au prix d'achat."
        />
        <Kpi
          label="Reprises manuelles"
          valeur={fmtInt(tRetouches?.touchees)}
          ton={tRetouches?.touchees ? "warn" : ""}
          icone={<HiPencilAlt />}
          aide="Lignes ajoutées ou corrigées à la main depuis l'écran des bipages."
        />
        <Kpi
          label="Temps effectif"
          valeur={fmtDuree(tAgents?.tempsActifMs)}
          icone={<HiClock />}
          aide="Cumul du temps réellement passé, silences longs exclus."
        />
      </div>

      <div className="invd-grille">
        {/* ── Progression dans le temps ─────────────────────────────────────
            La question du pilotage : avance-t-on, et à quel rythme ? Trois
            courbes cumulées (une par phase), un point par jour. Un plateau se
            voit immédiatement ; l'écart entre les courbes dit quelle phase
            prend du retard sur les autres. */}
        {serieCumulative.length > 1 && (
          <section className="invd-carte invd-carte-large">
            <h2>Progression dans le temps</h2>
            <p className="invd-carte-aide">
              Nombre cumulé de zones ayant franchi chaque phase, jour par jour
              (sur {fmtInt(stats.total)} zones).
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={serieCumulative} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CH.grille} vertical={false} />
                <XAxis dataKey="jour" fontSize={11} stroke={CH.axe} tickLine={false} />
                <YAxis
                  fontSize={11}
                  stroke={CH.axe}
                  tickFormatter={fmtCompact}
                  width={44}
                  tickLine={false}
                  domain={[0, stats.total || "auto"]}
                />
                <Tooltip content={<InvdTooltip />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {/* Repère : le total de zones à atteindre. */}
                <ReferenceLine y={stats.total} stroke={CH.axe} strokeOpacity={0.5} />
                {PHASES.map((p) => (
                  <Line
                    key={p.cle}
                    type="monotone"
                    dataKey={p.label}
                    stroke={p.couleur}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </section>
        )}

        {/* ── Avancement par phase ──────────────────────────────────────── */}
        <section className="invd-carte">
          <h2>Avancement par phase</h2>
          <p className="invd-carte-aide">
            Les trois phases sont indépendantes : une zone peut être contrôlée
            avant d'être papillonnée.
          </p>
          <div className="invd-phases">
            {PHASES.map((p) => {
              const faites = stats.parPhase[p.cle];
              const pct = stats.total
                ? Math.round((faites / stats.total) * 100)
                : 0;
              return (
                <div key={p.cle} className="invd-phase">
                  <div className="invd-phase-tete">
                    <span className="invd-phase-nom" style={{ color: p.couleur }}>
                      {p.label}
                    </span>
                    <span className="invd-phase-chiffre">
                      {fmtInt(faites)} / {fmtInt(stats.total)}
                      <span className="invd-phase-pct"> · {pct} %</span>
                    </span>
                  </div>
                  <Barre pct={pct} couleur={p.couleur} />
                </div>
              );
            })}
          </div>
        </section>

        {/* ── État des zones ────────────────────────────────────────────── */}
        <section className="invd-carte">
          <h2>Zones</h2>
          <p className="invd-carte-aide">
            Une zone est <b>complète</b> quand ses trois phases sont faites.
          </p>
          <div className="invd-repartition">
            {ETATS_ZONE.map((e) => (
              <div key={e.cle} className="invd-rep">
                <span className="invd-rep-val" style={{ color: e.couleur }}>
                  {fmtInt(stats[e.cle])}
                </span>
                <span className="invd-rep-lbl">{e.label}</span>
              </div>
            ))}
          </div>
          {/* Barre empilée : la proportion se lit mieux que trois nombres.
              Le gris « pas commencée » reste volontairement discret : c'est de
              l'absence de progrès, pas une alerte. */}
          <span className="invd-bar invd-bar-empilee">
            {ETATS_ZONE.map((e) => (
              <span
                key={e.cle}
                className="invd-bar-fill"
                style={{
                  width: stats.total ? `${(stats[e.cle] / stats.total) * 100}%` : "0%",
                  background: e.couleur,
                }}
              />
            ))}
          </span>

          {/* Même lecture, détaillée par emplacement : où le retard se niche. */}
          {parEmplacement.length > 1 && (
            <ResponsiveContainer
              width="100%"
              height={Math.max(96, parEmplacement.length * 34 + 56)}
            >
              <BarChart
                data={parEmplacement}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                barCategoryGap="30%"
              >
                <CartesianGrid stroke={CH.grille} horizontal={false} />
                <XAxis type="number" fontSize={10} stroke={CH.axe} tickFormatter={fmtCompact} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="emplacement"
                  width={76}
                  fontSize={10}
                  stroke={CH.axe}
                  tickLine={false}
                />
                <Tooltip content={<InvdTooltip />} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                {ETATS_ZONE.map((e, i) => (
                  <Bar
                    key={e.cle}
                    dataKey={e.cle}
                    name={e.label}
                    stackId="z"
                    fill={e.couleur}
                    maxBarSize={18}
                    stroke="var(--admin-bg-secondary)"
                    strokeWidth={1}
                    radius={i === ETATS_ZONE.length - 1 ? [0, 4, 4, 0] : 0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          <Link className="invd-lien" to="/admin/recap-zones">
            Voir le récap par zone <HiArrowRight />
          </Link>
        </section>

        {/* ── Comptages déposés ─────────────────────────────────────────── */}
        <section className="invd-carte">
          <h2>Comptages</h2>
          <p className="invd-carte-aide">
            Zones ouvertes au collecteur. Une zone « en cours » n'a pas encore
            été déposée.
          </p>
          {bipage.isLoading ? (
            <p className="invd-attente">Chargement…</p>
          ) : (
            <div className="invd-repartition">
              <div className="invd-rep">
                <span className="invd-rep-val" style={{ color: "#22c55e" }}>
                  {fmtInt(tBipage?.nbTermines)}
                </span>
                <span className="invd-rep-lbl">Déposés</span>
              </div>
              <div className="invd-rep">
                <span className="invd-rep-val" style={{ color: "#3b82f6" }}>
                  {fmtInt(tBipage?.nbEnCours)}
                </span>
                <span className="invd-rep-lbl">En cours</span>
              </div>
              <div className="invd-rep">
                <span className="invd-rep-val">
                  {fmtDuree(tBipage?.tempsActifMs)}
                </span>
                <span className="invd-rep-lbl">Temps de comptage</span>
              </div>
            </div>
          )}
          {/* Rythme : unités comptées par jour de dépôt. Une seule série, donc
              une seule couleur et pas de légende — le titre dit tout. */}
          {activiteParJour.length > 1 && (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={activiteParJour} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CH.grille} vertical={false} />
                <XAxis dataKey="label" fontSize={10} stroke={CH.axe} tickLine={false} />
                <YAxis fontSize={10} stroke={CH.axe} tickFormatter={fmtCompact} width={40} tickLine={false} />
                <Tooltip content={<InvdTooltip />} />
                <Bar dataKey="unites" name="Unités comptées" fill={CH.bleu} maxBarSize={24} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <Link className="invd-lien" to="/admin/suivi-bipage">
            Voir le suivi du bipage <HiArrowRight />
          </Link>
        </section>
        {/* ── Zones les plus retouchées ─────────────────────────────────────
            Ce que l'écran cherche : où le comptage a demandé le plus de
            reprises à la main. Beaucoup d'ajouts ou de corrections sur une
            zone, c'est un comptage à refaire ou un rayon mal tenu — et le
            regroupement par emplacement dit si le problème est au DOCK ou au
            MAGASIN. */}
        <section className="invd-carte invd-carte-large">
          <h2>Zones les plus retouchées</h2>
          <p className="invd-carte-aide">
            Lignes <b>ajoutées</b> depuis l'écran ou <b>corrigées</b> (NART ou
            quantité), par emplacement. La <b>part</b> compte autant que le
            nombre : 3 reprises sur 5 lignes est plus inquiétant que 3 sur 500.
            Les zones sans aucune reprise ne sont pas listées.
          </p>

          {retouches.isLoading ? (
            <p className="invd-attente">Chargement…</p>
          ) : !emplacements.length ? (
            <p className="invd-attente">
              Aucune ligne retouchée à la main pour l'instant.
            </p>
          ) : (
            <div className="invd-empl-grille">
              {emplacements.map((e) => (
                <div key={e.emplacement} className="invd-empl">
                  <div className="invd-empl-tete">
                    <span className="invd-empl-nom">{e.emplacement}</span>
                    <span className="invd-empl-chiffre">
                      {fmtInt(e.touchees)} ligne{e.touchees > 1 ? "s" : ""} sur{" "}
                      {fmtInt(e.lignes)}
                      <span className="invd-empl-detail">
                        {" "}
                        · {fmtInt(e.ajoutees)} ajout
                        {e.ajoutees > 1 ? "s" : ""} · {fmtInt(e.modifiees)}{" "}
                        correction{e.modifiees > 1 ? "s" : ""}
                      </span>
                    </span>
                  </div>
                  <p className="invd-empl-zones">
                    {fmtInt(e.nbZonesTouchees)} zone
                    {e.nbZonesTouchees > 1 ? "s" : ""} concernée
                    {e.nbZonesTouchees > 1 ? "s" : ""} sur{" "}
                    {fmtInt(e.nbZonesComptees)} comptée
                    {e.nbZonesComptees > 1 ? "s" : ""}
                  </p>

                  <table className="invd-table">
                    <thead>
                      <tr>
                        <th>Zone</th>
                        <th className="invd-num">Ajoutées</th>
                        <th className="invd-num">Corrigées</th>
                        <th className="invd-num">Part</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.zones.slice(0, 8).map((z) => (
                        <tr key={z.code}>
                          <td>
                            <span className="invd-zone-code">{z.code}</span>
                            {z.libelle && (
                              <span className="invd-zone-lib">{z.libelle}</span>
                            )}
                          </td>
                          <td className="invd-num">{fmtInt(z.ajoutees)}</td>
                          <td className="invd-num">{fmtInt(z.modifiees)}</td>
                          <td className="invd-num">
                            {/* Au-delà d'un quart de la zone reprise à la main,
                                le comptage mérite qu'on aille voir. */}
                            <span
                              className={`invd-part${
                                z.pct >= 25 ? " invd-part-fort" : ""
                              }`}
                            >
                              {z.pct} %
                            </span>
                            <span className="invd-part-sur">
                              {" "}
                              ({fmtInt(z.touchees)}/{fmtInt(z.lignes)})
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {e.zones.length > 8 && (
                    <p className="invd-empl-reste">
                      + {fmtInt(e.zones.length - 8)} autre
                      {e.zones.length - 8 > 1 ? "s" : ""} zone
                      {e.zones.length - 8 > 1 ? "s" : ""} concernée
                      {e.zones.length - 8 > 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="invd-liens">
            <Link className="invd-lien" to="/admin/zones-retouchees">
              Classement de toutes les zones <HiArrowRight />
            </Link>
            <Link className="invd-lien" to="/admin/bipages">
              Voir le détail des bipages <HiArrowRight />
            </Link>
          </div>
        </section>

        {/* ── Écarts de stock par zone ──────────────────────────────────────
            Écart = quantité bipée − stock théorique (ΣS1..S5 du DBF), valorisé
            au prix d'achat. Classé par écart le plus COÛTEUX en valeur
            absolue : un manquant de 400 000 F et un excédent de 400 000 F
            posent autant question l'un que l'autre.
            ⚠️ Ce calcul relit chaque ligne bipée contre le cache articles —
            c'est la requête la plus lourde de la page. Elle a son propre état
            de chargement et n'empêche pas le reste de s'afficher. */}
        <section className="invd-carte invd-carte-large">
          <h2>Écarts de stock par zone</h2>
          <p className="invd-carte-aide">
            <b>Écart</b> = quantité comptée − stock théorique, valorisé au prix
            d'achat. Un <span className="invd-ec-moins">manquant</span> est
            négatif, un <span className="invd-ec-plus">excédent</span> positif.
            Les zones sont classées par montant d'écart, sans regarder le signe.
          </p>

          {ecarts.isLoading ? (
            <p className="invd-attente">
              Calcul des écarts… (chaque ligne bipée est comparée au stock)
            </p>
          ) : !zonesEcart.length ? (
            <p className="invd-attente">
              Aucun comptage déposé : il n'y a pas encore d'écart à mesurer.
            </p>
          ) : (
            <>
              <div className="invd-repartition invd-ec-totaux">
                <div className="invd-rep">
                  <span
                    className={`invd-rep-val ${
                      (tEcarts?.totalEcartXpf || 0) < 0
                        ? "invd-ec-moins"
                        : "invd-ec-plus"
                    }`}
                  >
                    {fmtXpf(tEcarts?.totalEcartXpf)}
                  </span>
                  <span className="invd-rep-lbl">Écart net valorisé</span>
                </div>
                <div className="invd-rep">
                  <span className="invd-rep-val">
                    {fmtInt(tEcarts?.nbEcarts)}
                  </span>
                  <span className="invd-rep-lbl">Articles en écart</span>
                </div>
                <div className="invd-rep">
                  <span className="invd-rep-val">
                    {fmtInt(tEcarts?.totalArticles)}
                  </span>
                  <span className="invd-rep-lbl">Articles comptés</span>
                </div>
                <div className="invd-rep">
                  <span className="invd-rep-val">
                    {fmtInt(tEcarts?.totalZones)}
                  </span>
                  <span className="invd-rep-lbl">Zones déposées</span>
                </div>
              </div>

              {/* Divergent : manquant à gauche en rouge, excédent à droite en
                  bleu (jamais vert/rouge : illisible en vision daltonienne),
                  zéro au centre. Classement par montant, signe ignoré. */}
              {ecartsChart.length > 0 && (
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(140, ecartsChart.length * 30 + 56)}
                >
                  <BarChart
                    data={ecartsChart}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
                    stackOffset="sign"
                    barCategoryGap="25%"
                  >
                    <CartesianGrid stroke={CH.grille} horizontal={false} />
                    <XAxis
                      type="number"
                      fontSize={10}
                      stroke={CH.axe}
                      tickFormatter={fmtCompact}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={118}
                      fontSize={10}
                      stroke={CH.axe}
                      tickLine={false}
                    />
                    <Tooltip content={<InvdTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    <ReferenceLine x={0} stroke={CH.axe} strokeOpacity={0.6} />
                    <Bar
                      dataKey="manquant"
                      name="Manquant"
                      stackId="e"
                      fill={CH.manquant}
                      maxBarSize={16}
                      radius={[4, 0, 0, 4]}
                      unit="xpf"
                    />
                    <Bar
                      dataKey="excedent"
                      name="Excédent"
                      stackId="e"
                      fill={CH.excedent}
                      maxBarSize={16}
                      radius={[0, 4, 4, 0]}
                      unit="xpf"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}

              <table className="invd-table invd-ec-table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Emplacement</th>
                    <th className="invd-num">Articles</th>
                    <th className="invd-num">En écart</th>
                    <th className="invd-num">Écart (unités)</th>
                    <th className="invd-num">Écart valorisé</th>
                  </tr>
                </thead>
                <tbody>
                  {zonesEcart.slice(0, 10).map((z) => (
                    <tr key={`${z.zoneCode}-${z.zoneType}`}>
                      <td>
                        <span className="invd-zone-code">{z.zoneCode}</span>
                        {z.zoneLibelle && (
                          <span className="invd-zone-lib">{z.zoneLibelle}</span>
                        )}
                      </td>
                      <td className="invd-ec-empl">{z.zoneType || "—"}</td>
                      <td className="invd-num">{fmtInt(z.totalArticles)}</td>
                      <td className="invd-num">{fmtInt(z.nbEcarts)}</td>
                      <td
                        className={`invd-num ${
                          z.totalEcart < 0 ? "invd-ec-moins" : ""
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
                  ))}
                </tbody>
              </table>

              {zonesEcart.length > 10 && (
                <p className="invd-empl-reste">
                  + {fmtInt(zonesEcart.length - 10)} autre
                  {zonesEcart.length - 10 > 1 ? "s" : ""} zone
                  {zonesEcart.length - 10 > 1 ? "s" : ""} déposée
                  {zonesEcart.length - 10 > 1 ? "s" : ""}
                </p>
              )}
            </>
          )}

          <div className="invd-liens">
            <Link className="invd-lien" to="/admin/ecarts-zones">
              Classement de tous les écarts <HiArrowRight />
            </Link>
            <Link className="invd-lien" to="/admin/recap-zones">
              Voir le récap détaillé par zone <HiArrowRight />
            </Link>
          </div>
        </section>

        {/* ── Agents de l'inventaire ────────────────────────────────────── */}
        <section className="invd-carte invd-carte-large">
          <h2>Agents de l'inventaire</h2>
          <p className="invd-carte-aide">
            Classés par production — zones comptées et coupons scannés confondus.
            Le <b>temps effectif</b> ignore les silences longs.
          </p>
          {agents.isLoading ? (
            <p className="invd-attente">Chargement des agents…</p>
          ) : topAgents.length === 0 ? (
            <p className="invd-attente">
              Personne n'a encore travaillé sur cet inventaire.
            </p>
          ) : (
            <table className="invd-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="invd-num">Zones</th>
                  <th className="invd-num">Coupons</th>
                  <th className="invd-num">Articles</th>
                  <th className="invd-num">Unités</th>
                  <th className="invd-num">Temps effectif</th>
                </tr>
              </thead>
              <tbody>
                {topAgents.map((a) => (
                  <tr key={a.id || a.nom}>
                    <td>
                      <span className="invd-agent">{a.nom || "—"}</span>
                      {a.email && (
                        <span className="invd-agent-mail">{a.email}</span>
                      )}
                    </td>
                    <td className="invd-num">{fmtInt(a.nbZones)}</td>
                    <td className="invd-num">{fmtInt(a.totalPhases)}</td>
                    <td className="invd-num">{fmtInt(a.totalArticles)}</td>
                    <td className="invd-num">{fmtInt(a.totalQuantite)}</td>
                    <td className="invd-num">{fmtDuree(a.tempsActifMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link className="invd-lien" to="/admin/agents-inventaire">
            Voir tous les agents et leur détail <HiArrowRight />
          </Link>
        </section>

      </div>
    </div>
  );
};

export default AdminInventaireDashboardScreen;
