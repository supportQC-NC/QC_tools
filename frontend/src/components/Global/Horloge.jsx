// src/components/Global/Horloge.jsx
//
// Horloge AUTONOME (27/11/2026) : elle porte son propre tick d'une seconde,
// pour que les écrans « mur » (Suivi inventaire, Récap par zone en mode
// borne) ne re-rendent plus leur grille entière à chaque seconde — seul ce
// petit span se redessine.
import React, { useEffect, useState } from "react";

const Horloge = ({ className = "" }) => {
  const [heure, setHeure] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setHeure(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={className}>
      {heure.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
};

export default Horloge;
