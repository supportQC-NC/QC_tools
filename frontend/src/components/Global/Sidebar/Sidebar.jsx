// src/components/Global/Sidebar/Sidebar.jsx
import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import { useSelector } from "react-redux";
import { getMenuHint, buildSidebar } from "../../../config/menuConfig";
import {
  HiHome,
  HiX,
  HiChevronDown,
  HiChevronUp,
  HiSearch,
} from "react-icons/hi";
import { useSidebar } from "../../../contexte/SidebarContext";
import { useGetNotificationCountsQuery } from "../../../slices/notificationApiSlice";
import { useGetMenuHintsQuery } from "../../../slices/menuHintsApiSlice";
import {
  useGetMenuLayoutQuery,
  useGetMyMenuLayoutQuery,
  useSetMyMenuModeMutation,
} from "../../../slices/menuLayoutApiSlice";
import "./Sidebar.css";

const Sidebar = () => {
  const { userInfo } = useSelector((state) => state.auth);

  // Personnalisation admin : infobulles + organisation (chapitres) — globales.
  const { data: menuHints } = useGetMenuHintsQuery(undefined, { skip: !userInfo });
  const { data: menuLayout } = useGetMenuLayoutQuery(undefined, { skip: !userInfo });

  // Personnalisation utilisateur : organisation perso + switch « Défaut / Perso ».
  const { data: myLayout } = useGetMyMenuLayoutQuery(undefined, { skip: !userInfo });
  const [setMyMenuMode] = useSetMyMenuModeMutation();
  const useCustom = !!myLayout?.useCustom;

  // Layout actif : perso si le switch est sur « Perso », sinon la config admin.
  // (Une config perso vide retombe automatiquement sur le défaut dans buildSidebar.)
  const activeLayout = useCustom ? myLayout : menuLayout;

  // Menus = chapitres du layout actif (ou défaut code), filtrés par permissions.
  const menus = buildSidebar(userInfo, activeLayout, menuHints);

  const switchMode = (custom) => {
    if (custom === useCustom) return;
    setMyMenuMode({ useCustom: custom });
  };

  // Infobulle flottante (position fixe -> jamais coupée par le scroll de la sidebar).
  const [tip, setTip] = useState({ text: "", top: 0, left: 0, visible: false });
  const showTip = (e, text) => {
    if (!text) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2, left: r.right + 10, visible: true });
  };
  const hideTip = () => setTip((t) => ({ ...t, visible: false }));

  // Compteurs de notifications -> badges. Map par path des items de la sidebar.
  const { data: notifCounts } = useGetNotificationCountsQuery(undefined, {
    skip: !userInfo,
  });
  const badges = {
    "/espace-equipe": notifCounts?.messages || 0,
    "/mes-taches": notifCounts?.taches || 0,
  };

  // Context sidebar (pour mobile ET collapsed)
  const { isOpen, isMobile, isCollapsed, closeSidebar } = useSidebar();

  // Dossiers ouverts. ⚠️ On repart de ZÉRO à chaque chargement : à l'ouverture
  // de l'application, TOUS les dossiers et sous-dossiers sont repliés (décision
  // client) — la sidebar tient alors dans l'écran, et on déplie ce dont on a
  // besoin. L'état n'est donc volontairement plus persisté en localStorage :
  // le retenir rouvrirait la moitié du menu au prochain démarrage.
  const [openSections, setOpenSections] = useState({});

  // Ouvre / referme un dossier (absent de l'objet = replié).
  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const estReplie = (key) => !openSections[key];

  // ── Recherche d'un module dans tout le menu ──────────────────────────────
  // Les dossiers étant repliés par défaut, c'est LE chemin rapide vers un
  // écran : on tape trois lettres au lieu de dérouler trois dossiers.
  const [recherche, setRecherche] = useState("");
  const normaliser = (v) =>
    (v || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  // Render un item de menu (lien)
  const renderMenuItem = (item, key) => {
    const IconComponent = item.icon || HiHome;
    const count = badges[item.path] || 0;
    const hint = getMenuHint(item.path, menuHints) || item.label;
    return (
      <NavLink
        key={key}
        to={item.path}
        end={item.exact}
        className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
        onMouseEnter={(e) => showTip(e, hint)}
        onMouseLeave={hideTip}
        onClick={isMobile ? closeSidebar : undefined}
      >
        <span className="sidebar-icon">
          <IconComponent />
          {count > 0 && <span className="sidebar-badge-dot" />}
        </span>
        <span className="sidebar-label">{item.label}</span>
        {count > 0 && (
          <span className="sidebar-badge">{count > 99 ? "99+" : count}</span>
        )}
      </NavLink>
    );
  };

  // Render un dossier. RÉCURSIF : un dossier peut contenir des sous-dossiers,
  // qui sont eux-mêmes des sous-groupes (`niveau` ne sert qu'à l'indentation).
  const renderSubgroup = (subgroup, parentKey, niveau = 0) => {
    const key = `${parentKey}-${subgroup.label}`;
    const replie = estReplie(key);
    const IconComponent = subgroup.icon || HiHome;

    return (
      <div key={key} className={`sidebar-subgroup niveau-${niveau}`}>
        {/* Header du dossier */}
        <button
          className={`sidebar-subgroup-header ${replie ? "collapsed" : ""}`}
          onClick={() => toggleSection(key)}
        >
          <span className="subgroup-icon">
            <IconComponent />
          </span>
          <span className="subgroup-label">{subgroup.label}</span>
          <span className="subgroup-arrow">
            {replie ? <HiChevronDown /> : <HiChevronUp />}
          </span>
        </button>

        {/* Contenu : onglets puis sous-dossiers */}
        <div
          className={`sidebar-subgroup-items ${replie ? "collapsed" : ""}`}
        >
          {subgroup.items.map((item, idx) =>
            item.type === "subgroup"
              ? renderSubgroup(item, `${key}-${idx}`, niveau + 1)
              : renderMenuItem(item, `${key}-item-${idx}`),
          )}
        </div>
      </div>
    );
  };

  // Render les items d'une section (peut contenir items et dossiers)
  const renderSectionItems = (items, sectionKey) => {
    return items.map((item, idx) => {
      if (item.type === "subgroup") {
        return renderSubgroup(item, sectionKey);
      }
      // Item simple
      return renderMenuItem(item, `${sectionKey}-item-${idx}`);
    });
  };

  // Tous les onglets du menu, à plat (dossiers traversés) : c'est la matière
  // de la recherche. Le chemin des dossiers est conservé pour situer le
  // résultat — deux modules peuvent porter un libellé proche.
  const aplatir = (noeuds, chemin = []) =>
    (noeuds || []).flatMap((n) =>
      n.type === "subgroup"
        ? aplatir(n.items, [...chemin, n.label])
        : [{ ...n, chemin }],
    );

  const q = normaliser(recherche.trim());
  const resultats = q
    ? aplatir(menus.flatMap((s) => s.items || []))
        .filter((it) => {
          const cible = normaliser(
            `${it.label} ${it.path} ${(it.chemin || []).join(" ")}`,
          );
          // Tous les mots saisis doivent être présents : « ana ca » trouve
          // « Analyse CA » sans imposer l'ordre exact.
          return q.split(/\s+/).every((mot) => cible.includes(mot));
        })
        .slice(0, 40)
    : [];

  // Render une section principale
  const renderSection = (section, index) => {
    const sectionKey = `section-${section.label || index}`;
    const isSectionCollapsed = estReplie(sectionKey);

    // Section sans titre (constructeur de menu) : on rend directement les items
    // (les chapitres sont des sous-groupes avec leur propre en-tête).
    if (!section.label) {
      return (
        <div key={sectionKey} className="sidebar-section">
          <div className="sidebar-section-items">
            {renderSectionItems(section.items, sectionKey)}
          </div>
        </div>
      );
    }

    return (
      <div key={sectionKey} className="sidebar-section">
        {/* Header de la section */}
        {section.collapsible ? (
          <button
            className={`sidebar-separator clickable ${isSectionCollapsed ? "collapsed" : ""}`}
            onClick={() => toggleSection(sectionKey)}
          >
            <span className="separator-text">{section.label}</span>
            <span className="separator-arrow">
              {isSectionCollapsed ? <HiChevronDown /> : <HiChevronUp />}
            </span>
          </button>
        ) : (
          <div className="sidebar-separator">
            <span className="separator-text">{section.label}</span>
          </div>
        )}

        {/* Contenu de la section */}
        <div
          className={`sidebar-section-items ${isSectionCollapsed ? "collapsed" : ""}`}
        >
          {renderSectionItems(section.items, sectionKey)}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Overlay sombre - uniquement sur mobile quand ouvert */}
      {isMobile && isOpen && (
        <div className="sidebar-overlay" onClick={closeSidebar} />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar ${isMobile ? "mobile" : ""} ${isOpen ? "open" : ""} ${isCollapsed && !isMobile ? "collapsed" : ""}`}
      >
        {/* Header mobile avec bouton fermer */}
        {isMobile && (
          <div className="sidebar-mobile-header">
            <span className="sidebar-title">Menu</span>
            <button className="sidebar-close" onClick={closeSidebar}>
              <HiX />
            </button>
          </div>
        )}

        <nav className="sidebar-nav">
          {/* Switch d'organisation : config admin par défaut ou config perso. */}
          <div className="sidebar-mode-switch" role="group" aria-label="Organisation du menu">
            <button
              type="button"
              className={`sidebar-mode-btn ${!useCustom ? "active" : ""}`}
              onClick={() => switchMode(false)}
              title="Menu par défaut (défini par l'administrateur)"
            >
              Défaut
            </button>
            <button
              type="button"
              className={`sidebar-mode-btn ${useCustom ? "active" : ""}`}
              onClick={() => switchMode(true)}
              title="Ma configuration personnelle"
            >
              Perso
            </button>
          </div>

          {/* Recherche de module : les dossiers étant repliés au démarrage,
              c'est le chemin le plus court vers un écran. */}
          <div className="sidebar-search">
            <HiSearch />
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher un module…"
              aria-label="Rechercher un module"
            />
            {recherche && (
              <button
                type="button"
                className="sidebar-search-clear"
                onClick={() => setRecherche("")}
                title="Effacer"
              >
                <HiX />
              </button>
            )}
          </div>

          {/* Pendant une recherche, on remplace l'arborescence par la liste
              plate des correspondances : pas de dossier à déplier. */}
          {q ? (
            <div className="sidebar-section sidebar-results">
              {resultats.length === 0 ? (
                <p className="sidebar-noresult">Aucun module trouvé.</p>
              ) : (
                resultats.map((item, idx) => (
                  <div key={`res-${item.path}-${idx}`} className="sidebar-result">
                    {renderMenuItem(item, `res-item-${item.path}-${idx}`)}
                    {item.chemin?.length > 0 && (
                      <span className="sidebar-result-path">
                        {item.chemin.join(" › ")}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            menus.map((section, index) => renderSection(section, index))
          )}
        </nav>

        <div className="sidebar-footer">
          <span className="sidebar-version">v1.0.0</span>
        </div>
      </aside>

      {/* Infobulle flottante (survol des onglets) — desktop uniquement */}
      {!isMobile && tip.visible && tip.text && (
        <div
          className="sidebar-tip"
          style={{ top: tip.top, left: tip.left }}
          role="tooltip"
        >
          {tip.text}
        </div>
      )}
    </>
  );
};

export default Sidebar;
