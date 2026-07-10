// src/screens/admin/AdminCollecteursMapScreen.jsx
//
// Carte Mapbox des collecteurs (centrée sur le 13 rue Ampère, Ducos).
// Vue satellite + relief, marqueur en forme de mobile coloré selon la fraîcheur.
// Rafraîchi toutes les 20 s.

import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useGetCollecteurPositionsQuery } from "../../slices/collecteurApiSlice";
import "./AdminCollecteursMapScreen.css";

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || "";

// Centre : 13 rue Ampère, Nouméa (Ducos) — base / dépôt.
const NC_CENTER = [166.4468049, -22.2338406];
const NC_ZOOM = 14;
const NC_PITCH = 45; // inclinaison modérée pour le relief

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

// Vert si relevé récent (<15 min), rouge sinon.
const couleur = (at) => (minutesSince(at) < 15 ? "#22c55e" : "#ef4444");

// Marqueur en forme de mobile (SVG inline), couleur dynamique.
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
    </div>`;
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
  const markersRef = useRef({}); // id -> mapboxgl.Marker

  const { data: positions = [], isLoading, error } =
    useGetCollecteurPositionsQuery(undefined, { pollingInterval: 20000 });

  const hasToken = !!mapboxgl.accessToken;

  // Init de la carte (une seule fois).
  useEffect(() => {
    if (!hasToken || mapRef.current || !mapContainer.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: NC_CENTER,
      zoom: NC_ZOOM,
      pitch: NC_PITCH,
      bearing: 0,
      antialias: true,
    });

    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    map.on("load", () => {
      // Relief 3D (exagération douce pour ne pas masquer les rues).
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.1 });

      if (!map.getLayer("sky")) {
        map.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0.0, 90.0],
            "sky-atmosphere-sun-intensity": 15,
          },
        });
      }

      // Remonter tous les labels (rues, lieux) au-dessus du terrain pour
      // qu'ils restent lisibles en satellite.
      const labelColor = "#ffffff";
      const haloColor = "rgba(0,0,0,0.85)";
      map.getStyle().layers.forEach((layer) => {
        if (layer.type === "symbol" && layer.layout?.["text-field"]) {
          try {
            map.setLayoutProperty(layer.id, "visibility", "visible");
            map.setPaintProperty(layer.id, "text-color", labelColor);
            map.setPaintProperty(layer.id, "text-halo-color", haloColor);
            map.setPaintProperty(layer.id, "text-halo-width", 1.4);
          } catch {}
        }
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, [hasToken]);

  // Sync des marqueurs à chaque nouvelle donnée.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const vus = new Set();

    positions.forEach((c) => {
      const { lat, lng } = c.lastPosition || {};
      if (lat == null || lng == null) return;
      vus.add(c._id);

      const html = popupHtml(c);
      const col = couleur(c.lastPosition.at);
      const existing = markersRef.current[c._id];

      if (existing) {
        existing.setLngLat([lng, lat]);
        existing.getElement().innerHTML = markerSvg(col);
        existing.getPopup().setHTML(html);
      } else {
        const marker = new mapboxgl.Marker({
          element: makeMarkerEl(col),
          anchor: "bottom", // la pointe du repère est sur la position
        })
          .setLngLat([lng, lat])
          .setPopup(new mapboxgl.Popup({ offset: 24 }).setHTML(html))
          .addTo(map);

        markersRef.current[c._id] = marker;
      }
    });

    // Retirer les marqueurs disparus.
    Object.keys(markersRef.current).forEach((id) => {
      if (!vus.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });
  }, [positions]);

  const actifs = positions.filter((c) => minutesSince(c.lastPosition.at) < 15).length;

  return (
    <div className="cm-page">
      <div className="cm-header">
        <div>
          <h1>Carte des collecteurs</h1>
          <p className="cm-sub">
            Vue satellite avec relief — position rafraîchie toutes les 20 s.
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

      {!hasToken ? (
        <div className="cm-message error">
          Token Mapbox manquant. Ajoutez <code>REACT_APP_MAPBOX_TOKEN</code> dans
          votre <code>.env</code> puis relancez le build.
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
          <div ref={mapContainer} className="cm-map" />
        </>
      )}
    </div>
  );
};

export default AdminCollecteursMapScreen;