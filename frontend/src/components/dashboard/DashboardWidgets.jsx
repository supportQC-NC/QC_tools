// src/components/dashboard/DashboardWidgets.jsx
//
// Rendu des widgets du catalogue (cf. config/dashboardCatalogue.js).
// Chaque widget est autonome : il fait sa propre requête et gère son état vide.
// Les gardes de permission sont faites EN AMONT (le serveur ne renvoie que les
// widgets autorisés) ; ici on ne s'occupe que de l'affichage.

import React from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  HiClipboardCheck,
  HiExclamationCircle,
  HiCheckCircle,
  HiTrendingUp,
  HiTruck,
  HiInboxIn,
  HiUsers,
  HiOfficeBuilding,
  HiCurrencyDollar,
  HiClipboardList,
  HiDocumentReport,
  HiRefresh,
  HiExternalLink,
} from "react-icons/hi";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  useGetMyDashboardQuery,
  useGetGlobalDashboardQuery,
  useGetEntrepriseDashboardQuery,
  useGetCaDashboardQuery,
  useGetCaComparaisonQuery,
} from "../../slices/dashboardApiSlice";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { getMenuCatalog, catalogItemVisible } from "../../config/menuConfig";

const nb = (v) => Number(v || 0).toLocaleString("fr-FR");
const xpf = (v) => `${Math.round(Number(v) || 0).toLocaleString("fr-FR")} XPF`;

// Coquille commune : titre + corps, pour que tous les blocs se ressemblent.
export const Carte = ({ titre, icone: Icone, couleur, children, action }) => (
  <section className="db-carte">
    <header className="db-carte-head">
      <h3>
        {Icone && <Icone style={{ color: couleur }} />} {titre}
      </h3>
      {action}
    </header>
    <div className="db-carte-body">{children}</div>
  </section>
);

const Vide = ({ children }) => <p className="db-vide">{children}</p>;

// ─── Widgets personnels ──────────────────────────────────────────────────────

const KpiPerso = () => {
  const { data } = useGetMyDashboardQuery();
  const t = data?.taches || {};
  const s = data?.sessions || {};
  const tuiles = [
    { cle: "t", label: "Mes tâches actives", valeur: t.total ?? 0, sous: `${t.aFaire ?? 0} à faire`, alerte: t.enRetard > 0 ? `${t.enRetard} en retard` : null, icone: HiClipboardCheck, couleur: "#6366f1", route: "/mes-taches" },
    { cle: "i", label: "Inventaires en cours", valeur: s.inventaires ?? 0, icone: HiClipboardList, couleur: "#06b6d4", route: "/inventaire" },
    { cle: "r", label: "Relevés en cours", valeur: s.releves ?? 0, icone: HiDocumentReport, couleur: "#a855f7", route: "/releve" },
    { cle: "a", label: "Réappros en cours", valeur: s.reappros ?? 0, icone: HiRefresh, couleur: "#22c55e", route: "/reappro" },
  ];
  return (
    <div className="db-kpi-rangee">
      {tuiles.map((k) => {
        const Icone = k.icone;
        return (
          <Link to={k.route} key={k.cle} className="db-kpi">
            <div className="db-kpi-icone" style={{ background: `${k.couleur}22`, color: k.couleur }}>
              <Icone />
            </div>
            <div className="db-kpi-corps">
              <span className="db-kpi-valeur">{nb(k.valeur)}</span>
              <span className="db-kpi-label">{k.label}</span>
              <span className="db-kpi-sous">
                {k.sous || " "}
                {k.alerte && <span className="db-kpi-alerte"> · {k.alerte}</span>}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
};

const MesTaches = () => {
  const { data } = useGetMyDashboardQuery();
  const t = data?.taches || {};
  return (
    <Carte titre="Mes tâches" icone={HiClipboardCheck} couleur="#6366f1">
      <div className="db-stat"><span className="db-pastille db-bleu" /> À faire <b>{nb(t.aFaire)}</b></div>
      <div className="db-stat"><span className="db-pastille db-ambre" /> En cours <b>{nb(t.enCours)}</b></div>
      <div className="db-stat"><span className="db-pastille db-gris" /> Bloquées <b>{nb(t.bloque)}</b></div>
      <div className="db-stat db-retard"><HiExclamationCircle /> En retard <b>{nb(t.enRetard)}</b></div>
      <div className="db-stat db-fait"><HiCheckCircle /> Terminées (7 j) <b>{nb(t.termine7j)}</b></div>
      <Link to="/mes-taches" className="db-lien">Voir mes tâches →</Link>
    </Carte>
  );
};

const MonActivite = () => {
  const { data } = useGetMyDashboardQuery();
  const activite = data?.activite || [];
  return (
    <Carte titre="Mon activité (14 jours)" icone={HiTrendingUp} couleur="#06b6d4">
      {activite.length === 0 ? (
        <Vide>Aucune activité enregistrée.</Vide>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={activite}>
            <defs>
              {[["dbInv", "#06b6d4"], ["dbRel", "#a855f7"], ["dbRec", "#4da6ff"]].map(([id, c]) => (
                <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={c} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="jour" stroke="var(--text-muted)" fontSize={10} />
            <YAxis stroke="var(--text-muted)" fontSize={10} allowDecimals={false} />
            <Tooltip />
            <Area type="monotone" dataKey="inventaires" name="Inventaires" stroke="#06b6d4" fill="url(#dbInv)" strokeWidth={2} />
            <Area type="monotone" dataKey="releves" name="Relevés" stroke="#a855f7" fill="url(#dbRel)" strokeWidth={2} />
            <Area type="monotone" dataKey="receptions" name="Réceptions" stroke="#4da6ff" fill="url(#dbRec)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Carte>
  );
};

// Les raccourcis sont dérivés DU MENU (catalogue + mêmes règles de visibilité),
// plus de liste de modules en dur à re-synchroniser à la main.
const AccesRapides = () => {
  const { userInfo } = useSelector((s) => s.auth);
  const items = React.useMemo(
    () => getMenuCatalog().filter((c) => catalogItemVisible(userInfo, c)),
    [userInfo],
  );
  return (
    <Carte titre="Accès rapides" icone={HiExternalLink} couleur="#22c55e">
      {items.length === 0 ? (
        <Vide>Aucun écran accessible. Contactez votre administrateur.</Vide>
      ) : (
        <div className="db-raccourcis">
          {items.map((c) => {
            const Icone = c.icon;
            return (
              <Link to={c.path} key={c.path} className="db-raccourci">
                {Icone && <Icone />}
                <span>{c.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </Carte>
  );
};

// ─── Widgets globaux (module dashboard_admin) ────────────────────────────────

const GlobalEffectifs = () => {
  const { data: users } = useGetUsersQuery();
  const { data: entreprises } = useGetEntreprisesQuery();
  const listeUsers = Array.isArray(users) ? users : users?.users || [];
  const listeEnt = Array.isArray(entreprises) ? entreprises : entreprises?.entreprises || [];
  const actives = listeEnt.filter((e) => e.isActive !== false).length;
  return (
    <Carte titre="Utilisateurs & sociétés" icone={HiUsers} couleur="#3b82f6">
      <div className="db-chiffres">
        <div><span className="db-chiffre">{nb(listeUsers.length)}</span><span className="db-chiffre-label">Utilisateurs</span></div>
        <div><span className="db-chiffre">{nb(listeEnt.length)}</span><span className="db-chiffre-label">Sociétés</span></div>
        <div><span className="db-chiffre">{nb(actives)}</span><span className="db-chiffre-label">Actives</span></div>
      </div>
    </Carte>
  );
};

const GlobalReceptions = () => {
  const { data } = useGetGlobalDashboardQuery();
  const r = data?.receptions || {};
  return (
    <Carte titre="Réceptions & conformité" icone={HiInboxIn} couleur="#4da6ff">
      <div className="db-chiffres">
        <div><span className="db-chiffre">{nb(r.enCours)}</span><span className="db-chiffre-label">En cours</span></div>
        <div><span className="db-chiffre">{nb(r.termine)}</span><span className="db-chiffre-label">Terminées</span></div>
        <div><span className="db-chiffre">{r.tauxConformite ?? 0} %</span><span className="db-chiffre-label">Conformité</span></div>
        <div><span className="db-chiffre">{nb(r.totalEcarts)}</span><span className="db-chiffre-label">Lignes en écart</span></div>
      </div>
    </Carte>
  );
};

// ─── Widgets société (DBF) ───────────────────────────────────────────────────

const SansSociete = ({ titre, icone, couleur }) => (
  <Carte titre={titre} icone={icone} couleur={couleur}>
    <Vide>Sélectionnez une société dans l'en-tête.</Vide>
  </Carte>
);

const useSociete = () => useSelector(selectGlobalDossier) || "";

const CommandesEtat = () => {
  const dossier = useSociete();
  const { data } = useGetEntrepriseDashboardQuery(dossier, { skip: !dossier });
  if (!dossier) return <SansSociete titre="Commandes par état" icone={HiTruck} couleur="#f59e0b" />;
  const etats = data?.commandes?.parEtat || [];
  return (
    <Carte titre="Commandes par état" icone={HiTruck} couleur="#f59e0b">
      {etats.length === 0 ? <Vide>Aucune commande.</Vide> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={etats}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis stroke="var(--text-muted)" fontSize={10} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" name="Commandes" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Carte>
  );
};

const ProchainsBateaux = () => {
  const dossier = useSociete();
  const { data } = useGetEntrepriseDashboardQuery(dossier, { skip: !dossier });
  if (!dossier) return <SansSociete titre="Prochaines arrivées" icone={HiInboxIn} couleur="#0ea5e9" />;
  const liste = data?.commandes?.prochainsBateaux || [];
  return (
    <Carte titre="Prochaines arrivées" icone={HiInboxIn} couleur="#0ea5e9">
      {liste.length === 0 ? <Vide>Aucune arrivée annoncée.</Vide> : (
        <ul className="db-liste">
          {liste.map((b, i) => (
            <li key={`${b.bateau}-${i}`}>
              <span className="db-liste-cle">{b.bateau || "—"}</span>
              <span className="db-liste-sec">{b.arrivee ? new Date(b.arrivee).toLocaleDateString("fr-FR") : "—"}</span>
              <span className="db-liste-val">{nb(b.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
};

const TopFournisseurs = () => {
  const dossier = useSociete();
  const { data } = useGetEntrepriseDashboardQuery(dossier, { skip: !dossier });
  if (!dossier) return <SansSociete titre="Top fournisseurs" icone={HiTruck} couleur="#a855f7" />;
  const liste = data?.commandes?.topFournisseurs || [];
  return (
    <Carte titre="Top fournisseurs" icone={HiTruck} couleur="#a855f7">
      {liste.length === 0 ? <Vide>Aucune commande.</Vide> : (
        <ul className="db-liste">
          {liste.map((f, i) => (
            <li key={`${f.code}-${i}`}>
              <span className="db-liste-cle">{f.code}</span>
              <span className="db-liste-sec">{f.nom || ""}</span>
              <span className="db-liste-val">{nb(f.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
};

const MeilleuresVentes = () => {
  const dossier = useSociete();
  const { data } = useGetEntrepriseDashboardQuery(dossier, { skip: !dossier });
  if (!dossier) return <SansSociete titre="Meilleures ventes (12 mois)" icone={HiTrendingUp} couleur="#eab308" />;
  const liste = data?.articles?.topVentes || [];
  return (
    <Carte titre="Meilleures ventes (12 mois)" icone={HiTrendingUp} couleur="#eab308">
      {liste.length === 0 ? <Vide>Aucune vente.</Vide> : (
        <ul className="db-liste">
          {liste.map((a, i) => (
            <li key={`${a.nart}-${i}`}>
              <span className="db-liste-cle">{a.nart}</span>
              <span className="db-liste-sec">{a.design}</span>
              <span className="db-liste-val">{nb(a.ventes ?? a.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
};

const Ruptures = () => {
  const dossier = useSociete();
  const { data } = useGetEntrepriseDashboardQuery(dossier, { skip: !dossier });
  if (!dossier) return <SansSociete titre="Ruptures" icone={HiExclamationCircle} couleur="#ef4444" />;
  const liste = data?.articles?.topRuptures || [];
  return (
    <Carte titre="Ruptures" icone={HiExclamationCircle} couleur="#ef4444">
      {liste.length === 0 ? <Vide>Aucune rupture détectée.</Vide> : (
        <ul className="db-liste">
          {liste.map((a, i) => (
            <li key={`${a.nart}-${i}`}>
              <span className="db-liste-cle">{a.nart}</span>
              <span className="db-liste-sec">{a.design}</span>
              <span className="db-liste-val">{nb(a.ventes ?? a.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
};

const CaSociete = () => {
  const dossier = useSociete();
  const { data } = useGetCaDashboardQuery(dossier, { skip: !dossier });
  if (!dossier) return <SansSociete titre="Chiffre d'affaires" icone={HiCurrencyDollar} couleur="#10b981" />;
  if (data && data.available === false) {
    return (
      <Carte titre="Chiffre d'affaires" icone={HiCurrencyDollar} couleur="#10b981">
        <Vide>Aucun instantané d'analyse CA pour cette société.</Vide>
      </Carte>
    );
  }
  return (
    <Carte titre="Chiffre d'affaires" icone={HiCurrencyDollar} couleur="#10b981">
      <div className="db-chiffres">
        <div><span className="db-chiffre">{xpf(data?.caTotal)}</span><span className="db-chiffre-label">CA total</span></div>
        <div><span className="db-chiffre">{nb(data?.nbFactures)}</span><span className="db-chiffre-label">Factures</span></div>
        <div><span className="db-chiffre">{nb(data?.nbReferences)}</span><span className="db-chiffre-label">Références</span></div>
      </div>
      {(data?.topVentes || []).length > 0 && (
        <ul className="db-liste db-liste-serree">
          {data.topVentes.map((a, i) => (
            <li key={`${a.nart}-${i}`}>
              <span className="db-liste-cle">{a.nart}</span>
              <span className="db-liste-sec">{a.design}</span>
              <span className="db-liste-val">{xpf(a.ca)}</span>
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
};

const CaComparaison = () => {
  const { data } = useGetCaComparaisonQuery();
  const societes = (data?.societes || []).filter((s) => s.dispo);
  return (
    <Carte titre="Comparaison CA entre sociétés" icone={HiOfficeBuilding} couleur="#14b8a6">
      {societes.length === 0 ? <Vide>Aucun instantané disponible.</Vide> : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={societes}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="trigramme" stroke="var(--text-muted)" fontSize={10} />
            <YAxis stroke="var(--text-muted)" fontSize={10} tickFormatter={(v) => `${Math.round(v / 1e6)}M`} />
            <Tooltip formatter={(v) => xpf(v)} />
            <Bar dataKey="caTotal" name="CA" fill="#14b8a6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Carte>
  );
};

// ─── Table de rendu ──────────────────────────────────────────────────────────

export const RENDUS = {
  kpi_perso: KpiPerso,
  mes_taches: MesTaches,
  mon_activite: MonActivite,
  acces_rapides: AccesRapides,
  global_effectifs: GlobalEffectifs,
  global_receptions: GlobalReceptions,
  commandes_etat: CommandesEtat,
  prochains_bateaux: ProchainsBateaux,
  top_fournisseurs: TopFournisseurs,
  meilleures_ventes: MeilleuresVentes,
  ruptures: Ruptures,
  ca_societe: CaSociete,
  ca_comparaison: CaComparaison,
};

export default RENDUS;
