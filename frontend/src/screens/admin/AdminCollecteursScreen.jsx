// src/screens/admin/AdminCollecteursMapScreen.jsx
//
// Carte des collecteurs. mapbox-gl est chargé via CDN (public/index.html) et lu
// sur window.mapboxgl : cela évite le bug "ReferenceError: r is not defined"
// causé par la minification de mapbox-gl par webpack/CRA en production.

import React, { useEffect, useRef, useState } from "react";
import {
  useGetCollecteurPositionsQuery,
  useRequestSonnerieMutation,
} from "../../slices/collecteurApiSlice";
import "./AdminCollecteursMapScreen.css";

// Objet global fourni par la balise <script> mapbox-gl dans public/index.html.
const mapboxgl = typeof window !== "undefined" ? window.mapboxgl : null;

// Centre : 13 rue Ampère, Nouméa (Ducos).
const NC_CENTER = [166.4468049, -22.2338406];
const NC_ZOOM = 14;
const SEUIL_ACTIF_MIN = 5; // actif si vu il y a moins de 5 min

const minutesSince = (at) => (Date.now() - new Date(at).getTime()) / 60000;

const ago = (at) => {
  const m = Math.floor(minutesSince(at));
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return `il y a ${j} j`;
};

const couleur = (at) => (minutesSince(at) < SEUIL_ACTIF_MIN ? "#22c55e" : "#ef4444");

const markerSvg = (color) => `
  <svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 38C15 38 28 24 28 14A13 13 0 1 0 2 14C2 24 15 38 15 38Z"
          fill="${color}" stroke="#ffffff" stroke-width="2"/>
    <rect x="9" y="6" width="12" height="16" rx="2.2" fill="#ffffff"/>
    <rect x="10.5" y="8" width="9" height="10.5" rx="0.8" fill="${color}" opacity="0.85"/>
    <circle cx="15" cy="20" r="0.9" fill="${color}"/>
  </svg>`;

const fmtCoord = (n) => Number(n).toFixed(5);

const popupHtml = (c) => {
  const agent = c.agent
    ? `${c.agent.prenom || ""} ${c.agent.nom || ""}`.trim()
    : "—";
  const ent = c.entreprise?.trigramme || c.entreprise?.nomDossierDBF || "—";
  const { lat, lng, accuracy } = c.lastPosition || {};
  const coords = `${fmtCoord(lat)}, ${fmtCoord(lng)}`;
  const prec = accuracy != null ? `± ${Math.round(accuracy)} m` : "—";
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `
    <div class="cm-popup">
      <div class="cm-popup-id">${c.identifiant}</div>
      ${c.nom ? `<div class="cm-popup-nom">${c.nom}</div>` : ""}
      <div class="cm-popup-row"><span>Agent</span> ${agent}</div>
      <div class="cm-popup-row"><span>Entreprise</span> ${ent}</div>
      <div class="cm-popup-row"><span>Statut</span> ${c.statut || "—"}</div>
      <div class="cm-popup-row"><span>Version app</span> ${c.versionApp || "—"}</div>
      <div class="cm-popup-row"><span>Précision</span> ${prec}</div>
      <div class="cm-popup-coord">${coords}</div>
      <div class="cm-popup-seen">Vu ${ago(c.lastPosition.at)}</div>
      <a class="cm-popup-btn" href="${gmaps}" target="_blank" rel="noopener noreferrer">Itinéraire (Google Maps)</a>
      <button class="cm-popup-btn ring" data-ring="${c._id}">🔔 Faire sonner</button>
    </div>`;
};

// Écarte les marqueurs qui partagent (quasi) la même position, en petit cercle,
// pour qu'ils restent tous visibles (ex. plusieurs collecteurs au même dépôt).
const OFFSET_DEG = 0.00009; // ~10 m

const computeDisplayCoords = (positions) => {
  const groups = {};
  positions.forEach((c) => {
    const { lat, lng } = c.lastPosition || {};
    if (lat == null || lng == null) return;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`; // regroupe ~11 m
    (groups[key] = groups[key] || []).push(c);
  });
  const out = {};
  Object.values(groups).forEach((arr) => {
    if (arr.length === 1) {
      const { lat, lng } = arr[0].lastPosition;
      out[arr[0]._id] = [lng, lat];
    } else {
      arr.forEach((c, i) => {
        const { lat, lng } = c.lastPosition;
        const angle = (2 * Math.PI * i) / arr.length;
        out[c._id] = [
          lng + OFFSET_DEG * Math.cos(angle),
          lat + OFFSET_DEG * Math.sin(angle),
        ];
      });
    }
  });
  return out;
};

const makeMarkerEl = (color) => {
  const el = document.createElement("div");
  el.className = "cm-marker";
  el.innerHTML = markerSvg(color);
  return el;
};

const AdminCollecteursMapScreen = () => {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  const { data: positions = [], isLoading, error } =
    useGetCollecteurPositionsQuery(undefined, { pollingInterval: 20000 });
  const [requestSonnerie] = useRequestSonnerieMutation();
  const [ringMsg, setRingMsg] = useState(null);

  const token = (process.env.REACT_APP_MAPBOX_TOKEN || "").trim();
  const ready = !!mapboxgl && !!token;

  // Init de la carte (une seule fois).
  useEffect(() => {
    if (!ready || mapRef.current || !mapContainer.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v11",
      center: NC_CENTER,
      zoom: NC_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, [ready, token]);

  // Clic sur "Faire sonner" (bouton injecté dans les popups).
  useEffect(() => {
    const el = mapContainer.current;
    if (!el) return;
    const onClick = async (e) => {
      const btn = e.target.closest && e.target.closest("[data-ring]");
      if (!btn) return;
      const id = btn.getAttribute("data-ring");
      try {
        await requestSonnerie(id).unwrap();
        setRingMsg("🔔 Sonnerie envoyée — le collecteur sonnera à son prochain relevé (≤ 60 s).");
      } catch {
        setRingMsg("Échec de l'envoi de la sonnerie.");
      }
      setTimeout(() => setRingMsg(null), 4000);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [requestSonnerie]);

  // Sync des marqueurs à chaque nouvelle donnée.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const vus = new Set();
    const displayCoords = computeDisplayCoords(positions);
    positions.forEach((c) => {
      const { lat, lng } = c.lastPosition || {};
      if (lat == null || lng == null) return;
      vus.add(c._id);

      const lngLat = displayCoords[c._id] || [lng, lat];
      const html = popupHtml(c);
      const col = couleur(c.lastPosition.at);
      const existing = markersRef.current[c._id];

      if (existing) {
        existing.setLngLat(lngLat);
        existing.getElement().innerHTML = markerSvg(col);
        existing.getPopup().setHTML(html);
      } else {
        const marker = new mapboxgl.Marker({
          element: makeMarkerEl(col),
          anchor: "bottom",
        })
          .setLngLat(lngLat)
          .setPopup(new mapboxgl.Popup({ offset: 24 }).setHTML(html))
          .addTo(map);
        markersRef.current[c._id] = marker;
      }
    });

    Object.keys(markersRef.current).forEach((id) => {
      if (!vus.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });
  }, [positions]);

  const actifs = positions.filter(
    (c) => minutesSince(c.lastPosition.at) < SEUIL_ACTIF_MIN,
  ).length;

  return (
    <div className="cm-page">
      <div className="cm-header">
        <div>
          <h1>Carte des collecteurs</h1>
          <p className="cm-sub">
            Fond relief — position rafraîchie toutes les 20 s.
          </p>
        </div>
        <div className="cm-stats">
          <span className="cm-stat">
            <span className="cm-dot ok" /> {actifs} actif(s)
          </span>
          <span className="cm-stat">
            <span className="cm-dot ko" /> {positions.length - actifs} inactif(s)
          </span>
        </div>
      </div>

      {!mapboxgl ? (
        <div className="cm-message error">
          Mapbox n'est pas chargé. Ajoutez la balise &lt;script&gt; mapbox-gl dans{" "}
          <code>public/index.html</code> puis rebuildez.
        </div>
      ) : !token ? (
        <div className="cm-message error">
          Token Mapbox manquant. Ajoutez <code>REACT_APP_MAPBOX_TOKEN</code> dans
          votre <code>.env</code> puis rebuildez.
        </div>
      ) : (
        <>
          {error && (
            <div className="cm-message error">
              Impossible de charger les positions.
            </div>
          )}
          {isLoading && positions.length === 0 && (
            <div className="cm-message">Chargement des positions…</div>
          )}
          {ringMsg && <div className="cm-message">{ringMsg}</div>}
          <div ref={mapContainer} className="cm-map" />
        </>
      )}
    </div>
  );
};

export default AdminCollecteursMapScreen;