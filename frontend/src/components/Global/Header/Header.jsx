// src/components/Global/Header/Header.jsx
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { useLogoutMutation } from "../../../slices/userApiSlice";
import { logout } from "../../../slices/authSlice";
import { HiLogout, HiMenu, HiMenuAlt2 } from "react-icons/hi";
import { useSidebar } from "../../../contexte/SidebarContext";
import "./Header.css";

const Header = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { userInfo } = useSelector((state) => state.auth);
  const [logoutApi, { isLoading }] = useLogoutMutation();

  // Context sidebar
  const { isMobile, isCollapsed, toggleSidebar, toggleCollapsed } =
    useSidebar();

  const handleLogout = async () => {
    try {
      await logoutApi().unwrap();
      dispatch(logout());
      navigate("/login");
    } catch (err) {
      dispatch(logout());
      navigate("/login");
    }
  };

  // Handler pour le bouton burger
  const handleBurgerClick = () => {
    if (isMobile) {
      toggleSidebar();
    } else {
      toggleCollapsed();
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        {/* Bouton hamburger - toujours visible */}
        <button
          className={`header-hamburger ${!isMobile && isCollapsed ? "collapsed" : ""}`}
          onClick={handleBurgerClick}
          aria-label={
            isMobile
              ? "Ouvrir le menu"
              : isCollapsed
                ? "Déplier le menu"
                : "Plier le menu"
          }
          title={
            isMobile
              ? "Menu"
              : isCollapsed
                ? "Déplier le menu"
                : "Plier le menu"
          }
        >
          {!isMobile && isCollapsed ? <HiMenu /> : <HiMenuAlt2 />}
        </button>

        <div className="header-logo">
          <Link to="/">QC Tools</Link>
        </div>
      </div>

      <div className="header-right">
        <Link to="/profile" className="header-profile">
          <span className="header-avatar">
            {userInfo?.prenom?.charAt(0)}
            {userInfo?.nom?.charAt(0)}
          </span>
          <div className="header-user-info">
            <span className="header-username">
              {userInfo?.prenom} {userInfo?.nom}
            </span>
            <span className={`header-role role-${userInfo?.role}`}>
              {userInfo?.role}
            </span>
          </div>
        </Link>
        <button
          className="btn-logout"
          onClick={handleLogout}
          disabled={isLoading}
          title="Déconnexion"
        >
           <HiLogout /> 
        </button>
      </div>
    </header>
  );
};

export default Header;
