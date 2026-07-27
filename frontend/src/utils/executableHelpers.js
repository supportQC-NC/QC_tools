// src/utils/executableHelpers.js
// Helpers partagés par les écrans « Exécutables » (liste + détail).

export const formatSize = (bytes) => {
  if (!bytes) return "—";
  const units = ["o", "Ko", "Mo", "Go"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

export const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "";

// Compare deux versions type "1.2.10" de façon naturelle (numérique par segment).
// Renvoie un tri DÉCROISSANT (la plus récente d'abord). Repli sur la date.
export const compareVersionsDesc = (a, b) => {
  const pa = String(a?.version || "").split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b?.version || "").split(/[^0-9]+/).filter(Boolean).map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return nb - na; // décroissant
  }
  // Versions équivalentes : plus récent (createdAt) d'abord.
  return new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0);
};

// Récupère un fichier via une requête AUTHENTIFIÉE (cookie JWT) -> blob.
// Évite la navigation directe vers /api (interceptée par CRA en dev -> 404).
const fetchBlob = async (url) => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
};

export const triggerDownload = async (url, filename) => {
  try {
    const blob = await fetchBlob(url);
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
  } catch {
    alert("Téléchargement impossible (fichier introuvable).");
  }
};

export const openInNewTab = async (url) => {
  // Onglet ouvert AVANT le fetch (geste utilisateur) pour éviter le blocage popup.
  const win = window.open("", "_blank");
  try {
    const blob = await fetchBlob(url);
    const objUrl = URL.createObjectURL(blob);
    if (win) {
      win.location = objUrl;
    } else {
      const a = document.createElement("a");
      a.href = objUrl;
      a.target = "_blank";
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  } catch {
    if (win) win.close();
    alert("Document introuvable.");
  }
};
