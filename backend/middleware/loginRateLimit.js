// backend/middleware/loginRateLimit.js
//
// LIMITATION DE DÉBIT des routes de connexion (/api/users/login et
// /login-badge). Comblée le 16/11/2026 à l'occasion de la connexion par badge :
// un badge est un EAN-13 au format prévisible et un PIN ne fait que 4 à
// 6 chiffres — sans frein, l'un comme l'autre s'essaient en boucle. La route
// email/mot de passe profite du même garde-fou (dette identifiée de longue
// date dans l'audit).
//
// EN MÉMOIRE, par instance (pas de Redis dans cette stack — même choix que les
// caches DBF) : fenêtre fixe par CLÉ = IP + identifiant visé (email ou badge),
// pour qu'un poste partagé qui enchaîne les agents légitimes ne soit pas
// bloqué par les échecs d'un seul compte. Seuls les ÉCHECS comptent : une
// connexion réussie remet le compteur de sa clé à zéro.

const FENETRE_MS = 15 * 60 * 1000; // 15 min
const MAX_ECHECS = 10; // par clé et par fenêtre

// cle -> { debut, echecs }
const compteurs = new Map();

// La Map ne doit pas grossir sans fin (chaque tentative crée une clé) : purge
// des fenêtres expirées au fil de l'eau, au plus une fois par minute.
let dernierePurge = 0;
const purger = (maintenant) => {
  if (maintenant - dernierePurge < 60 * 1000) return;
  dernierePurge = maintenant;
  for (const [cle, c] of compteurs) {
    if (maintenant - c.debut > FENETRE_MS) compteurs.delete(cle);
  }
};

const cleDe = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || "?";
  const ident = String(req.body?.email || req.body?.codeBarre || "")
    .trim()
    .toLowerCase();
  return `${ip}|${ident}`;
};

/**
 * Middleware : refuse (429) la tentative quand la clé a dépassé MAX_ECHECS
 * échecs dans la fenêtre. L'issue de la tentative est observée sur la réponse
 * (`finish`) : 2xx = succès → compteur remis à zéro ; 4xx/5xx = échec compté.
 */
export const limiterConnexion = (req, res, next) => {
  const maintenant = Date.now();
  purger(maintenant);

  const cle = cleDe(req);
  const c = compteurs.get(cle);
  if (c && maintenant - c.debut <= FENETRE_MS && c.echecs >= MAX_ECHECS) {
    const resteMin = Math.ceil((c.debut + FENETRE_MS - maintenant) / 60000);
    res.status(429);
    return next(
      new Error(
        `Trop de tentatives de connexion. Réessayez dans ${resteMin} minute${
          resteMin > 1 ? "s" : ""
        }.`,
      ),
    );
  }

  res.on("finish", () => {
    const fin = Date.now();
    const cur = compteurs.get(cle);
    if (res.statusCode < 400) {
      if (cur) compteurs.delete(cle);
      return;
    }
    if (!cur || fin - cur.debut > FENETRE_MS) {
      compteurs.set(cle, { debut: fin, echecs: 1 });
    } else {
      cur.echecs += 1;
    }
  });

  next();
};

export default limiterConnexion;
