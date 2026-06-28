// src/components/Global/Sidebar/Sidebar.jsx
import React, { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useSelector } from "react-redux";
import { getUserMenus } from "../../../config/menuConfig";
import { HiHome, HiX, HiChevronDown, HiChevronUp } from "react-icons/hi";
import { useSidebar } from "../../../contexte/SidebarContext";
import "./Sidebar.css";

const Sidebar = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const menus = getUserMenus(userInfo);

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
    return (
      <NavLink
        key={key}
        to={item.path}
        end={item.exact}
        className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
        title={item.label}
        onClick={isMobile ? closeSidebar : undefined}
      >
        <span className="sidebar-icon">
          <IconComponent />
        </span>
        <span className="sidebar-label">{item.label}</span>
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
    const sectionKey = `section-${section.label}`;
    const isSectionCollapsed = collapsedSections[sectionKey];

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
    </>
  );
};

export default Sidebar;
