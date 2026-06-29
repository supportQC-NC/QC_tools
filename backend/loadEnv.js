// backend/loadEnv.js
// Charge les variables d'environnement AVANT tout autre import.
// En ESM, tous les `import` d'un module s'exécutent avant son code ;
// importer ce fichier en première ligne de server.js garantit donc que
// process.env est rempli avant que les autres modules (ex: ficheControleService,
// qui lit STOCK_SHARE_PATH au chargement) ne soient évalués.
import dotenv from "dotenv";

dotenv.config();