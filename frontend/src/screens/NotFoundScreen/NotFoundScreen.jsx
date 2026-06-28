// src/screens/NotFound.jsx
import React from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { HiHome, HiArrowLeft } from "react-icons/hi";
import "./NotFoundScreen.css";

const NotFound = () => {
  const { userInfo } = useSelector((state) => state.auth);

  return (
    <div
      className={`notfound-container ${userInfo ? "in-dashboard" : "fullscreen"}`}
    >
      <div className="notfound-box">
        <div className="notfound-code">404</div>
        <div className="notfound-title">Page introuvable</div>
        <p className="notfound-message">
          La ressource demandée n'existe pas ou a été déplacée.
        </p>
        <div className="notfound-actions">
          <Link to="/" className="btn-back">
            <HiHome />
            <span>Retour à l'accueil</span>
          </Link>
          <button
            onClick={() => window.history.back()}
            className="btn-back btn-secondary"
          >
            <HiArrowLeft />
            <span>Page précédente</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
