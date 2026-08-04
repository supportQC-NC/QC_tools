// src/components/Global/Sidebar/Sidebar.jsx
import React, { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useSelector } from "react-redux";
import { getMenuHint, buildSidebar } from "../../../config/menuConfig";
import { HiHome, HiX, HiChevronDown, HiChevronUp } from "react-icons/hi";
import { useSidebar } from "../../../contexte/SidebarContext";
import { useGetNotificationCountsQuery } from "../../../slices/notificationApiSlice";
import { useGetMenuHintsQuery } from "../../../slices/menuHintsApiSlice";
import { useGetMenuLayoutQuery } from "../../../slices/menuLayoutApiSlice";
import "./Sidebar.css";

const Sidebar = () => {
  const { userInfo } = useSelector((state) => state.auth);

  // Personnalisation admin : infobulles + organisation (chapitres) — globales.
  const { data: menuHints } = useGetMenuHintsQuery(undefined, { skip: !userInfo });
  const { data: menuLayout } = useGetMenuLayoutQuery(undefined, { skip: !userInfo });

  // Menus = chapitres définis en base (ou défaut code), filtrés par permissions.
  const menus = buildSidebar(userInfo, menuLayout, menuHints);

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

  // États pour les sections et sous-groupes collapsibles
  const [collapsedSections, setCollapsedSections] = useState(() => {
    const saved = localStorage.getItem("sidebar-sections");
    return saved ? JSON.parse(saved) : {};
  });

  // Sauvegarder l'état des sections dans localStorage
  useEffect(() => {
    localStorage.setItem("sidebar-sections", JSON.stringify(collapsedSections));
  }, [collapsedSections]);

  // Toggle section/subgroup collapsed
  const toggleSection = (key) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

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

  // Render un sous-groupe
  const renderSubgroup = (subgroup, parentKey) => {
    const key = `${parentKey}-${subgroup.label}`;
    const isSubgroupCollapsed = collapsedSections[key];
    const IconComponent = subgroup.icon || HiHome;

    return (
      <div key={key} className="sidebar-subgroup">
        {/* Header du sous-groupe */}
        <button
          className={`sidebar-subgroup-header ${isSubgroupCollapsed ? "collapsed" : ""}`}
          onClick={() => toggleSection(key)}
        >
          <span className="subgroup-icon">
            <IconComponent />
          </span>
          <span className="subgroup-label">{subgroup.label}</span>
          <span className="subgroup-arrow">
            {isSubgroupCollapsed ? <HiChevronDown /> : <HiChevronUp />}
          </span>
        </button>

        {/* Items du sous-groupe */}
        <div
          className={`sidebar-subgroup-items ${isSubgroupCollapsed ? "collapsed" : ""}`}
        >
          {subgroup.items.map((item, idx) =>
            renderMenuItem(item, `${key}-item-${idx}`),
          )}
        </div>
      </div>
    );
  };

  // Render les items d'une section (peut contenir items et subgroups)
  const renderSectionItems = (items, sectionKey) => {
    return items.map((item, idx) => {
      if (item.type === "subgroup") {
        return renderSubgroup(item, sectionKey);
      }
      // Item simple
      return renderMenuItem(item, `${sectionKey}-item-${idx}`);
    });
  };

  // Render une section principale
  const renderSection = (section, index) => {
    const sectionKey = `section-${section.label || index}`;
    const isSectionCollapsed = collapsedSections[sectionKey];

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
          {menus.map((section, index) => renderSection(section, index))}
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
