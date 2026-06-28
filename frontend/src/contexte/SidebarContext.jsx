// src/contexte/SidebarContext.jsx
import React, { createContext, useContext, useState, useEffect } from "react";

const SidebarContext = createContext();

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider = ({ children }) => {
  // État pour mobile (sidebar ouverte/fermée)
  const [isOpen, setIsOpen] = useState(false);

  // État pour desktop (sidebar pliée/dépliée)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    return saved ? JSON.parse(saved) : false;
  });

  // Détecter si on est sur mobile
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Sauvegarder l'état collapsed dans localStorage
  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  // Écouter les changements de taille d'écran
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);

      // Fermer la sidebar mobile si on passe en desktop
      if (!mobile && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen]);

  // Fermer la sidebar mobile quand on clique ailleurs
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  // Fonctions de contrôle
  const openSidebar = () => setIsOpen(true);
  const closeSidebar = () => setIsOpen(false);
  const toggleSidebar = () => setIsOpen((prev) => !prev);

  const expandSidebar = () => setIsCollapsed(false);
  const collapseSidebar = () => setIsCollapsed(true);
  const toggleCollapsed = () => setIsCollapsed((prev) => !prev);

  const value = {
    // Mobile
    isOpen,
    openSidebar,
    closeSidebar,
    toggleSidebar,
    // Desktop collapsed
    isCollapsed,
    expandSidebar,
    collapseSidebar,
    toggleCollapsed,
    // Responsive
    isMobile,
  };

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
};

export default SidebarContext;
