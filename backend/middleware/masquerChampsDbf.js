// backend/middleware/masquerChampsDbf.js
//
// Retire des réponses JSON les champs DBF interdits à l'utilisateur
// (Permission.champsDbf, cf. services/dbfChampsService.js).
//
// Deux morceaux complémentaires :
//   - `installerMasqueDbf` : monté GLOBALEMENT sur /api AVANT les routeurs. Il
//     remplace res.json par une version qui élague au moment de l'envoi.
//   - `protect` (authMiddleware) pose `req.masqueDbf` une fois l'utilisateur
//     identifié. L'enveloppe le lit alors de façon synchrone.
//
// La couverture est ainsi acquise par construction — aucun contrôleur ne peut
// « oublier » le filtrage, ce qui est la condition pour que ce soit une vraie
// protection et pas un simple confort d'affichage.
//
// Coût : nul pour un utilisateur sans restriction (`req.masqueDbf` vaut null).
//
// LIMITE CONNUE : seul le JSON passe ici. Les réponses binaires (exports Excel,
// PDF) doivent filtrer à la source, dans leurs services respectifs.

// Retire récursivement les clés masquées. Renvoie une COPIE : on ne mute jamais
// les enregistrements du cache DBF, partagés entre utilisateurs.
const elaguer = (valeur, masque, profondeur = 0) => {
  if (profondeur > 12 || valeur == null) return valeur;

  if (Array.isArray(valeur)) {
    return valeur.map((v) => elaguer(v, masque, profondeur + 1));
  }

  if (typeof valeur !== "object") return valeur;
  if (valeur instanceof Date || Buffer.isBuffer(valeur)) return valeur;

  const sortie = {};
  for (const [cle, v] of Object.entries(valeur)) {
    if (masque.has(cle.toUpperCase())) continue;
    sortie[cle] = elaguer(v, masque, profondeur + 1);
  }
  return sortie;
};

const installerMasqueDbf = (req, res, next) => {
  const jsonOrigine = res.json.bind(res);
  res.json = (corps) => {
    const masque = req.masqueDbf;
    return masque && masque.size > 0
      ? jsonOrigine(elaguer(corps, masque))
      : jsonOrigine(corps);
  };
  next();
};

/**
 * Filtre une liste de colonnes d'export selon le masque de la requête.
 * À utiliser dans les services d'export (Excel, PDF) : eux ne passent pas par
 * res.json, donc l'enveloppe ci-dessus ne les voit pas.
 *
 * @param {object} req              requête (porte `masqueDbf`)
 * @param {Array}  colonnes         [{ name, ... }] ou [string]
 * @param {function} [nomDe]        extrait le nom d'une colonne
 * @returns {Array} colonnes autorisées
 */
export const filtrerColonnes = (req, colonnes, nomDe = (c) => c?.name ?? c) => {
  const masque = req?.masqueDbf;
  if (!masque || masque.size === 0) return colonnes;
  return colonnes.filter((c) => !masque.has(String(nomDe(c)).toUpperCase()));
};

/**
 * Vrai si le champ est masqué pour cette requête.
 * Pour les exports dont les colonnes ne portent pas le nom DBF (libellés
 * métier), on teste explicitement le champ source.
 */
export const champMasque = (req, nomChamp) => {
  const masque = req?.masqueDbf;
  return !!masque && masque.has(String(nomChamp).toUpperCase());
};

export { installerMasqueDbf, elaguer };
export default installerMasqueDbf;
