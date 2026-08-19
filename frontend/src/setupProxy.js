// src/setupProxy.js
//
// Proxy du serveur de DÉVELOPPEMENT uniquement (`npm start` / `npm run dev`).
// En production, Express sert lui-même le build : ce fichier n'est pas utilisé.
//
// POURQUOI CE FICHIER
// Le champ "proxy" de package.json ne relaie PAS les requêtes de NAVIGATION —
// celles dont l'en-tête `Accept` contient `text/html`. CRA suppose qu'elles
// visent l'application React et sert index.html à la place. Résultat : ouvrir
// une URL d'API dans un nouvel onglet (window.open) tombe sur le routeur React,
// qui affiche sa page « introuvable » alors que le backend, lui, répond très
// bien. C'est le cas du rapport de veille : /api/veille/rapports/:id/html.
//
// Ce middleware est enregistré AVANT le proxy de package.json (hook
// onBeforeSetupMiddleware de react-scripts) et relaie /api SANS condition, ce
// qui rétablit les ouvertures en nouvel onglet.
//
// Le reste (/socket.io…) continue de passer par le proxy de package.json.
const { createProxyMiddleware } = require("http-proxy-middleware");

const CIBLE = process.env.REACT_APP_API_TARGET || "http://localhost:5000";

module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: CIBLE,
      changeOrigin: true,
      xfwd: true,
      // Les téléchargements/pages servis par l'API peuvent être longs à
      // produire (Excel, PDF, rapport de veille) : on laisse du temps.
      proxyTimeout: 120000,
      timeout: 120000,
      logLevel: "warn",
    }),
  );
};
