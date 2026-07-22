import React, { useMemo, useState } from "react";
import { HiCurrencyDollar, HiDocumentText, HiCalendar } from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { BASE_URL } from "../../constants";
import "./AdminEditionPromoScreen.css";

// Noms de mois FR (sans accent, alignés avec le backend) pour l'aperçu du nom
// de fichier promo_<mois_suivant>.csv.
const MOIS_FR = [
  "janvier", "fevrier", "mars", "avril", "mai", "juin",
  "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
];
const nomFichierPromoApercu = () => {
  const d = new Date();
  return `promo_${MOIS_FR[(d.getMonth() + 1) % 12]}.csv`;
};

const AdminEditionPromoScreen = () => {
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  // Société active : sélection GLOBALE (Header), comme le générateur d'étiquettes.
  const globalEntrepriseId = useSelector(selectGlobalEntrepriseId);
  const selectedEntreprise = globalEntrepriseId || "";

  const [numfact, setNumfact] = useState("");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  const entrepriseData = entreprises?.find((e) => e._id === selectedEntreprise);
  const nomDossierDBF = entrepriseData?.nomDossierDBF;

  const fichierApercu = useMemo(() => nomFichierPromoApercu(), []);

  const genererPromo = async () => {
    setError("");
    setInfo(null);

    if (!nomDossierDBF) {
      setError("Sélectionnez une entreprise (sélecteur en haut de page).");
      return;
    }
    if (!numfact.trim()) {
      setError("Saisissez un numéro de proforma.");
      return;
    }
    if (!dateDebut) {
      setError("Saisissez une date de début de promo.");
      return;
    }
    if (!dateFin) {
      setError("Saisissez une date de fin de promo.");
      return;
    }
    if (dateFin < dateDebut) {
      setError("La date de fin doit être postérieure (ou égale) à la date de début.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/edition-promo/${nomDossierDBF}/generer`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            numfact: numfact.trim(),
            dateDebut,
            dateFin,
          }),
        },
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `Génération échouée (${res.status})`);
      }
      setInfo(data);
    } catch (e) {
      setError(e.message || "Erreur lors de la génération.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="promo-screen">
      <div className="promo-header">
        <HiCurrencyDollar className="promo-header-icon" />
        <div>
          <h1>Édition Promo</h1>
          <p>
            Génère un fichier CSV de mise en promotion à partir d'une proforma et
            le dépose dans <code>collect_sec</code> (fichier{" "}
            <code>{fichierApercu}</code>).
          </p>
        </div>
      </div>

      <div className="promo-card">
        <div className="promo-entreprise">
          <span className="promo-label">Entreprise :</span>{" "}
          {loadingEntreprises ? (
            <span>Chargement…</span>
          ) : entrepriseData ? (
            <strong>{entrepriseData.nomComplet}</strong>
          ) : (
            <span className="promo-muted">
              Aucune — sélectionnez une société dans le sélecteur global.
            </span>
          )}
        </div>

        <label className="promo-field">
          <span className="promo-field-label">
            <HiDocumentText /> N° de proforma
          </span>
          <input
            type="text"
            value={numfact}
            onChange={(e) => setNumfact(e.target.value)}
            placeholder="ex. 123456"
          />
        </label>

        <div className="promo-dates">
          <label className="promo-field">
            <span className="promo-field-label">
              <HiCalendar /> Date de début (DPROMOD)
            </span>
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </label>
          <label className="promo-field">
            <span className="promo-field-label">
              <HiCalendar /> Date de fin (DPROMOF)
            </span>
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
        </div>

        {error && <div className="promo-alert promo-alert-error">{error}</div>}

        {info && (
          <div className="promo-alert promo-alert-success">
            <p>
              ✅ <strong>{info.message}</strong>
            </p>
            <ul>
              <li>Articles écrits : {info.nbArticles}</li>
              <li>Période : {info.dateDebut} → {info.dateFin}</li>
              <li>
                Emplacement : <code>{info.filePath}</code>
              </li>
              {info.sansPvpromo?.count > 0 && (
                <li>
                  ⚠️ {info.sansPvpromo.count} article(s) sans prix promo
                  (PVPROMO vide/0) → fichier{" "}
                  <code>{info.sansPvpromo.fileName}</code> généré (colonne
                  PVPROMO à remplir).
                </li>
              )}
              {info.introuvables?.length > 0 && (
                <li className="promo-muted">
                  {info.introuvables.length} NART absent(s) de la base article
                  (désignation prise de la proforma) : {info.introuvables.join(", ")}
                </li>
              )}
            </ul>
          </div>
        )}

        <button
          type="button"
          className="promo-btn"
          onClick={genererPromo}
          disabled={loading}
        >
          {loading ? "Génération…" : "Générer le fichier promo"}
        </button>
      </div>
    </div>
  );
};

export default AdminEditionPromoScreen;
