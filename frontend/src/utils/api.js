// src/utils/api.js

/**
 * Retourne l'URL complète vers le backend pour une API donnée
 * @param {string} path - Chemin relatif, ex: "/outils/:id/documentation/:docId"
 * @returns {string} URL complète
 */
export const getApiUrl = (path) => {
  // En dev, on utilise le backend via l'URL définie dans .env
  if (process.env.NODE_ENV === "development") {
    return `${process.env.NEXT_PUBLIC_BACKEND_URL}/api${path}`;
  }
  // En prod, idem, backend prod défini dans .env
  return `${process.env.NEXT_PUBLIC_BACKEND_URL}/api${path}`;
};