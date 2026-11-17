// src/screens/admin/AdminAjoutControleInventaireScreen.jsx
//
// AJOUT CONTRÔLE INVENTAIRE (demande client du 18/11/2026) : au CONTRÔLE d'une
// zone, on découvre des bipages OUBLIÉS — ce formulaire les saisit après coup.
// L'utilisateur entre un NART ou un GENCODE (la désignation se résout
// dynamiquement, renvois GENDOUBL suivis vers la fiche active), une quantité,
// un emplacement, et une zone FACULTATIVE (sans zone → pseudo-zone CONTROLE).
// Les lignes créées sont des LigneBipage « source: controle » : elles
// rejoignent le Détail des bipages et le calcul des écarts comme n'importe
// quel bipage de la session.
import React, { useState, useEffect, useRef } from "react";
import {
  HiClipboardCheck,
  HiRefresh,
  HiPlus,
  HiExclamation,
  HiPrinter,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import {
  useGetContexteControleQuery,
  useGetBipagesQuery,
  useLazyResoudreArticleControleQuery,
  useAjouterLigneControleMutation,
} from "../../slices/bipageApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminAjoutControleInventaireScreen.css";

/** Quantités à 3 décimales max (articles au mètre), même règle que partout. */
const fmtQte = (n) =>
  Number.isFinite(Number(n))
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(
        Number(n),
      )
    : "—";

const AdminAjoutControleInventaireScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";

  const {
    data: contexte,
    isLoading,
    error: queryError,
    refetch,
  } = useGetContexteControleQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
  });

  const [code, setCode] = useState("");
  const [qte, setQte] = useState("");
  const [emplacement, setEmplacement] = useState("");
  const [zoneCode, setZoneCode] = useState("");
  const [observation, setObservation] = useState("");
  const [msg, setMsg] = useState(null); // { type: "ok"|"err", text }

  const codeRef = useRef(null);

  // TOUS les ajouts contrôle de la session active, TOUS utilisateurs — lus au
  // serveur (filtre provenance « controle » du Détail des bipages), pas un
  // récap local : la liste doit survivre au rechargement de la page
  // (demande client du 18/11/2026). La mutation d'ajout invalide « Bipage »,
  // la liste se rafraîchit donc toute seule.
  const { data: dataAjouts, isFetching: chargementAjouts } = useGetBipagesQuery(
    { entrepriseId: selectedEntreprise, marque: "controle" },
    { skip: !selectedEntreprise },
  );
  // Du plus récent au plus ancien : on vient vérifier ce qu'on a saisi.
  const ajouts = [...(dataAjouts?.lignes || [])].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  );

  // Résolution dynamique de la désignation pendant la saisie du code.
  const [resoudre, { data: article, isFetching: resolution }] =
    useLazyResoudreArticleControleQuery();
  useEffect(() => {
    const c = code.trim();
    if (!selectedEntreprise || c.length < 3) return undefined;
    const t = setTimeout(() => {
      resoudre({ entrepriseId: selectedEntreprise, code: c });
    }, 350);
    return () => clearTimeout(t);
  }, [code, selectedEntreprise, resoudre]);

  // Changement de société : tout repart de zéro.
  useEffect(() => {
    setCode("");
    setQte("");
    setEmplacement("");
    setZoneCode("");
    setObservation("");
    setMsg(null);
  }, [selectedEntreprise]);

  const [ajouterLigne, { isLoading: ajoutEnCours }] =
    useAjouterLigneControleMutation();

  // Fiche de saisie VIERGE (A4 paysage) : téléchargée pour impression, à
  // remplir au stylo en rayon avant la saisie dans ce formulaire.
  const [fichePages, setFichePages] = useState(1);
  const [ficheEnCours, setFicheEnCours] = useState(false);
  const telechargerFicheVierge = async () => {
    if (!selectedEntreprise || ficheEnCours) return;
    setFicheEnCours(true);
    setMsg(null);
    try {
      const res = await fetch(
        `${BASE_URL}/api/bipages/${selectedEntreprise}/fiche-controle-vierge?pages=${fichePages}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Génération impossible (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fiche_ajout_controle_inventaire.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e2) {
      setMsg({ type: "err", text: e2.message || "Génération impossible." });
    } finally {
      setFicheEnCours(false);
    }
  };

  const active = contexte?.active;
  const types = contexte?.types || [];
  const zonesEmplacement = (contexte?.zones || []).filter(
    (z) => z.type === emplacement,
  );
  // La résolution affichée ne vaut que pour le code ENCORE à l'écran.
  const articleCourant =
    article && article.code === code.trim() ? article : null;

  const soumettre = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!code.trim() || !emplacement || !qte) return;
    try {
      const ligne = await ajouterLigne({
        entrepriseId: selectedEntreprise,
        body: {
          code: code.trim(),
          qteScan: Number(String(qte).replace(",", ".")),
          zoneType: emplacement,
          zoneCode,
          observation: observation.trim(),
        },
      }).unwrap();
      setMsg({
        type: "ok",
        text: `Bipage ajouté : ${ligne.designation || ligne.nart || code} — ${fmtQte(
          ligne.qteScan,
        )} en ${ligne.zoneCode} (${ligne.zoneType}).`,
      });
      // Saisie en rafale : on garde emplacement et zone, on vide le reste et
      // on rend la main au champ code.
      setCode("");
      setQte("");
      setObservation("");
      codeRef.current?.focus();
    } catch (err) {
      setMsg({
        type: "err",
        text: err?.data?.message || "Ajout impossible.",
      });
    }
  };

  return (
    <div className="acinv-screen">
      <div className="acinv-header">
        <h1>
          <HiClipboardCheck /> Ajout contrôle inventaire
        </h1>
        <div className="acinv-actions">
          {/* Fiche papier à remplir au stylo (téléchargée pour impression). */}
          <select
            className="acinv-pages-select"
            value={fichePages}
            onChange={(e) => setFichePages(Number(e.target.value))}
            disabled={!selectedEntreprise}
            title="Nombre de feuilles vierges"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} feuille{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary"
            onClick={telechargerFicheVierge}
            disabled={!selectedEntreprise || ficheEnCours}
            title="Télécharger la fiche de saisie vierge (A4 paysage) à imprimer"
          >
            <HiPrinter /> {ficheEnCours ? "Génération…" : "Fiche vierge (PDF)"}
          </button>
          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!selectedEntreprise}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="acinv-placeholder">
          <HiClipboardCheck />
          <p>Sélectionnez une entreprise pour ajouter des bipages de contrôle.</p>
        </div>
      ) : isLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : queryError ? (
        <div className="acinv-placeholder">
          <HiClipboardCheck />
          <p>
            Impossible de joindre le serveur :{" "}
            {queryError?.data?.message ||
              queryError?.error ||
              `erreur ${queryError?.status || "inconnue"}`}
          </p>
          <button className="btn-secondary" onClick={refetch}>
            <HiRefresh /> Réessayer
          </button>
        </div>
      ) : !active ? (
        <div className="acinv-placeholder">
          <HiClipboardCheck />
          <p>
            Aucun inventaire actif. Initialisez-en un depuis l'écran
            Progression inventaire.
          </p>
        </div>
      ) : (
        <>
          <p className="acinv-hint">
            Saisissez ici un bipage <strong>oublié</strong> découvert lors d'un
            contrôle : NART ou gencode, quantité, emplacement — et la zone si
            vous la connaissez (sans zone, la ligne est rattachée à la
            pseudo-zone <strong>CONTROLE</strong>). La ligne rejoint
            immédiatement le Détail des bipages et le calcul des écarts.
          </p>

          <form className="acinv-form" onSubmit={soumettre}>
            <div className="acinv-grid">
              <label className="acinv-field acinv-field-code">
                <span>NART ou gencode *</span>
                <input
                  ref={codeRef}
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Scannez ou saisissez un code…"
                  autoFocus
                />
              </label>

              <label className="acinv-field acinv-field-qte">
                <span>Quantité *</span>
                <input
                  type="number"
                  step="any"
                  value={qte}
                  onChange={(e) => setQte(e.target.value)}
                  placeholder="1"
                />
              </label>

              <label className="acinv-field">
                <span>Emplacement *</span>
                <select
                  value={emplacement}
                  onChange={(e) => {
                    setEmplacement(e.target.value);
                    setZoneCode("");
                  }}
                >
                  <option value="">— Emplacement —</option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label className="acinv-field">
                <span>Zone (facultatif)</span>
                <select
                  value={zoneCode}
                  disabled={!emplacement}
                  onChange={(e) => setZoneCode(e.target.value)}
                >
                  <option value="">— Sans zone (CONTROLE) —</option>
                  {zonesEmplacement.map((z) => (
                    <option key={`${z.code}|${z.type}`} value={z.code}>
                      {z.code}
                      {z.libelle ? ` — ${z.libelle}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="acinv-field acinv-field-obs">
                <span>Observation (facultatif)</span>
                <input
                  type="text"
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  placeholder="Ex. : trouvé derrière le rayon…"
                />
              </label>
            </div>

            {/* Désignation résolue dynamiquement pendant la saisie. */}
            {code.trim().length >= 3 && (
              <div
                className={`acinv-article ${
                  resolution
                    ? ""
                    : articleCourant?.found
                      ? "acinv-article-ok"
                      : "acinv-article-inconnu"
                }`}
              >
                {resolution ? (
                  "Recherche de l'article…"
                ) : articleCourant?.found ? (
                  <>
                    <strong>{articleCourant.designation || "(sans désignation)"}</strong>
                    <span className="acinv-article-meta">
                      NART {articleCourant.nart}
                      {articleCourant.gencod
                        ? ` · gencode ${articleCourant.gencod}`
                        : " · sans gencode"}
                      {articleCourant.refer ? ` · réf. ${articleCourant.refer}` : ""}
                      {` · stock ${fmtQte(articleCourant.stock)}`}
                    </span>
                    {articleCourant.renvoye && (
                      <span className="acinv-article-renvoi">
                        <HiExclamation /> Code renvoyé (GENDOUBL) : la fiche
                        ACTIVE a été retenue.
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <HiExclamation /> Aucun article du catalogue ne porte ce
                    code — la ligne sortira « Article non trouvé » (comme un
                    bipage terrain inconnu).
                  </>
                )}
              </div>
            )}

            <div className="acinv-submit">
              <button
                type="submit"
                className="btn-primary"
                disabled={
                  ajoutEnCours || !code.trim() || !emplacement || !qte
                }
                title={
                  !code.trim() || !emplacement || !qte
                    ? "Code, quantité et emplacement sont obligatoires"
                    : "Ajouter ce bipage"
                }
              >
                <HiPlus /> {ajoutEnCours ? "Ajout…" : "Ajouter le bipage"}
              </button>
              {msg && (
                <span className={`acinv-msg acinv-msg-${msg.type}`}>
                  {msg.text}
                </span>
              )}
            </div>
          </form>

          <div className="acinv-recap">
            <h2>
              Bipages de contrôle de l'inventaire ({ajouts.length}
              {chargementAjouts ? "…" : ""}) — tous utilisateurs ; aussi
              visibles dans le Détail des bipages (provenance « Ajouts
              contrôle »)
            </h2>
            {ajouts.length === 0 ? (
              <p className="acinv-hint">
                {chargementAjouts
                  ? "Chargement…"
                  : "Aucun ajout de contrôle sur cet inventaire pour l'instant."}
              </p>
            ) : (
              <div className="acinv-recap-table">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Saisi par</th>
                      <th>Zone</th>
                      <th>Emplacement</th>
                      <th>Code saisi</th>
                      <th>NART</th>
                      <th>Désignation</th>
                      <th>Qté</th>
                      <th>Observation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ajouts.map((l) => (
                      <tr key={l._id} className={l.found ? "" : "row-unknown"}>
                        <td>
                          {l.createdAt
                            ? new Date(l.createdAt).toLocaleString("fr-FR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td>{l.agentNom || "—"}</td>
                        <td>{l.zoneCode}</td>
                        <td>{l.zoneType}</td>
                        <td className="mono">{l.codeScanne || l.eanArticle}</td>
                        <td className="mono">{l.nart || "—"}</td>
                        <td>{l.designation}</td>
                        <td className="acinv-num">{fmtQte(l.qteScan)}</td>
                        <td>{l.observation || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminAjoutControleInventaireScreen;
