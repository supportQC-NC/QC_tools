// backend/utils/envoyerClasseur.js
//
// Envoi d'un classeur Excel avec application des droits « champ par champ ».
//
// Les exports ne passent pas par res.json : l'enveloppe de masquage globale ne
// les voit pas. Ce point de passage unique retire, avant l'envoi, les colonnes
// dont l'entête correspond à un champ DBF interdit à l'utilisateur.
//
// Reconnaissance d'un entête :
//   - nom exact du champ            « PVTE »
//   - nom entre parenthèses         « PV HT (PVTE) »
//   - nom en préfixe technique      « PVTE — prix de vente »
// Les libellés purement métier (« Prix de revient ») ne sont PAS reconnus : les
// services qui en utilisent doivent déclarer eux-mêmes le champ source de leurs
// colonnes (cf. fournisseurArticlesExcelService). Ce filtre est un FILET, pas
// un substitut à la déclaration.

const normaliser = (v) => String(v ?? "").trim().toUpperCase();

// Champs DBF cités par un entête de colonne.
const champsCites = (entete) => {
  const t = normaliser(entete);
  if (!t) return [];
  const cites = [t];
  // Contenu des parenthèses : « PV HT (PVTE) » -> PVTE
  for (const m of t.matchAll(/\(([^)]+)\)/g)) cites.push(m[1].trim());
  // Premier mot s'il est en majuscules sans espace : « PVTE — prix de vente »
  const premier = t.split(/[\s—–-]+/)[0];
  if (premier && /^[A-Z0-9_]+$/.test(premier)) cites.push(premier);
  return cites;
};

/**
 * Retire d'une feuille les colonnes dont l'entête désigne un champ masqué.
 * Renvoie le nombre de colonnes retirées.
 */
const filtrerFeuille = (ws, masque) => {
  // Ligne d'entêtes : la première (parmi les 6 premières) qui contient au
  // moins deux cellules texte — les exports posent souvent un titre au-dessus.
  let ligneEntetes = 0;
  for (let n = 1; n <= Math.min(6, ws.rowCount); n++) {
    const row = ws.getRow(n);
    let textes = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof (cell.text ?? cell.value) === "string" && normaliser(cell.text)) {
        textes += 1;
      }
    });
    if (textes >= 2) {
      ligneEntetes = n;
      break;
    }
  }
  if (!ligneEntetes) return 0;

  const aRetirer = [];
  ws.getRow(ligneEntetes).eachCell({ includeEmpty: false }, (cell, col) => {
    const cites = champsCites(cell.text);
    if (cites.some((c) => masque.has(c))) aRetirer.push(col);
  });

  // Suppression de droite à gauche pour ne pas décaler les index restants.
  for (const col of aRetirer.sort((a, b) => b - a)) {
    ws.spliceColumns(col, 1);
  }
  return aRetirer.length;
};

/**
 * Applique le masque des champs DBF à un classeur, puis l'envoie.
 *
 * @param {object} req       requête (porte `masqueDbf`)
 * @param {object} res       réponse
 * @param {object} workbook  classeur ExcelJS
 * @param {string} filename  nom du fichier proposé
 * @param {object} [entetes] entêtes HTTP additionnels
 */
export const envoyerClasseur = async (req, res, workbook, filename, entetes = {}) => {
  const masque = req?.masqueDbf;

  let retirees = 0;
  if (masque && masque.size > 0) {
    workbook.eachSheet((ws) => {
      retirees += filtrerFeuille(ws, masque);
    });
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader(
    "Access-Control-Expose-Headers",
    ["X-Colonnes-Masquees", ...Object.keys(entetes)].join(", "),
  );
  res.setHeader("X-Colonnes-Masquees", String(retirees));
  for (const [cle, valeur] of Object.entries(entetes)) {
    res.setHeader(cle, String(valeur));
  }

  await workbook.xlsx.write(res);
  res.end();
};

export default envoyerClasseur;
