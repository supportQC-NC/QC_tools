// src/screens/admin/AdminVerificationPointRougeScreen.jsx
//
// VÉRIFICATION POINT ROUGE (module à part entière, dossier Terrain — même
// parcours que la version collecteur). Dernière passe de l'inventaire : au
// papillonnage l'agent écrit la quantité comptée sur un scotch, au bipage un
// point rouge est collé après chaque scan. Quand TOUTES les zones d'une allée
// sont contrôlées, un agent balaye l'allée RAYON PAR RAYON : il bipe le QR du
// rayon (l'étiquette de zone), puis chaque scotch SANS point rouge, et l'écran
// croise avec les bipages de CE RAYON :
//   - trouvé à la bonne quantité → « Conforme » (point rouge oublié, tracé) ;
//   - absent ou quantité différente → ajout au bipage, LE SCOTCH FAIT FOI
//     (ligne de delta, négatif accepté, rattachée au rayon bipé).
// ⚠️ Croisement STRICT PAR ZONE (26/11/2026) : un article peut être à
// plusieurs endroits de la même allée — le total de l'allée faisait mentir le
// verdict, et la zone de l'ajout était désignée à la main.
// ⚠️ Rien n'est réimprimé, aucun .dat de zone n'est touché : la ligne entre
// seulement au Détail des bipages (source « verification », filtrable) et
// compte dans les écarts et l'intégration Stock XL.

import React, { useEffect, useRef, useState } from "react";
import {
  HiBadgeCheck,
  HiSearch,
  HiCheckCircle,
  HiPlusCircle,
  HiX,
  HiExclamationCircle,
  HiInformationCircle,
  HiQrcode,
  HiRefresh,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetContexteVerificationQuery,
  useLazyResoudreRayonVerificationQuery,
  useLazyVerifierCodeAlleeQuery,
  useConfirmerVerificationMutation,
  useAjouterAuBipageMutation,
} from "../../slices/verificationInventaireApiSlice";
import "./AdminVerificationPointRougeScreen.css";

const fmtQte = (n) =>
  (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 });

const AdminVerificationPointRougeScreen = () => {
  const entrepriseId = useSelector(selectGlobalEntrepriseId) || "";
  const { data: entreprises } = useGetMyEntreprisesQuery();
  const entrepriseObj = entreprises?.find((e) => e._id === entrepriseId);

  const [allee, setAllee] = useState("");
  // Rayon en cours de balayage (QR bipé). Tant qu'il est nul, le champ de
  // scan sert à biper le QR du rayon ; ensuite il sert aux scotchs.
  const [rayon, setRayon] = useState(null); // null | { code, libelle, type }
  const [rayonChoix, setRayonChoix] = useState(null); // null | zones[] (ambigu MAGASIN/DOCK)
  const [code, setCode] = useState("");
  const [resultat, setResultat] = useState(null); // réponse de /verifier
  const [ajout, setAjout] = useState(null); // null | { qte, obs }
  const [message, setMessage] = useState(null); // { tone, texte }
  const inputRef = useRef(null);

  const { data: contexte } = useGetContexteVerificationQuery(entrepriseId, {
    skip: !entrepriseId,
  });
  const [resoudreRayon, { isFetching: rayonEnCours }] =
    useLazyResoudreRayonVerificationQuery();
  const [verifier, { isFetching: verifEnCours }] =
    useLazyVerifierCodeAlleeQuery();
  const [confirmer, { isLoading: confirmEnCours }] =
    useConfirmerVerificationMutation();
  const [ajouter, { isLoading: ajoutEnCours }] = useAjouterAuBipageMutation();

  // Changement de société : tout remettre à zéro.
  useEffect(() => {
    setAllee("");
    setRayon(null);
    setRayonChoix(null);
    setCode("");
    setResultat(null);
    setAjout(null);
    setMessage(null);
  }, [entrepriseId]);

  const allees = contexte?.allees || [];

  const raz = () => {
    setResultat(null);
    setAjout(null);
    setCode("");
    inputRef.current?.focus();
  };

  // Changement de rayon : on garde l'allée, on rebipe un QR.
  const changerRayon = () => {
    setRayon(null);
    setRayonChoix(null);
    setResultat(null);
    setAjout(null);
    setCode("");
    setMessage(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const choisirRayon = (z) => {
    setRayon(z);
    setRayonChoix(null);
    setCode("");
    setMessage(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const biperRayon = async (c) => {
    try {
      const r = await resoudreRayon({ entrepriseId, allee, code: c }).unwrap();
      if (!r.found || !r.zones?.length) {
        setMessage({
          tone: "err",
          texte:
            r.message || `Aucun rayon de l'allée ${allee} ne correspond à ce code.`,
        });
        return;
      }
      if (r.zones.length === 1) {
        choisirRayon(r.zones[0]);
      } else {
        // Code brut bipé : le même code existe à plusieurs emplacements
        // (MAGASIN/DOCK) — l'agent choisit.
        setRayonChoix(r.zones);
        setCode("");
      }
    } catch (err) {
      setMessage({
        tone: "err",
        texte: err?.data?.message || "Résolution du rayon impossible.",
      });
    }
  };

  const biperArticle = async (c) => {
    setAjout(null);
    try {
      const r = await verifier({
        entrepriseId,
        allee,
        zoneCode: rayon.code,
        zoneType: rayon.type,
        code: c,
      }).unwrap();
      setResultat(r);
    } catch (err) {
      setResultat(null);
      setMessage({
        tone: "err",
        texte: err?.data?.message || "Vérification impossible.",
      });
    }
    inputRef.current?.select();
  };

  const biper = async () => {
    const c = code.trim();
    if (!c || !allee) return;
    setMessage(null);
    if (!rayon) {
      await biperRayon(c);
    } else {
      await biperArticle(c);
    }
  };

  const validerConforme = async () => {
    if (!resultat || !rayon) return;
    setMessage(null);
    try {
      await confirmer({
        entrepriseId,
        allee,
        zoneCode: rayon.code,
        zoneType: rayon.type,
        code: resultat.code,
      }).unwrap();
      setMessage({
        tone: "ok",
        texte: `Conforme tracé — posez le point rouge sur « ${
          resultat.article?.designation || resultat.code
        } ».`,
      });
      raz();
    } catch (err) {
      setMessage({
        tone: "err",
        texte: err?.data?.message || "Enregistrement refusé.",
      });
    }
  };

  const validerAjout = async () => {
    if (!resultat || !ajout || !rayon) return;
    setMessage(null);
    try {
      const r = await ajouter({
        entrepriseId,
        allee,
        code: resultat.code,
        qteScotch: Number(String(ajout.qte).replace(",", ".")),
        zoneCode: rayon.code,
        zoneType: rayon.type,
        observation: ajout.obs || "",
      }).unwrap();
      if (r.verdict === "conforme") {
        setMessage({
          tone: "ok",
          texte:
            "Le total bipé correspond finalement au scotch : conforme tracé, " +
            "posez le point rouge.",
        });
      } else {
        setMessage({
          tone: "ok",
          texte:
            r.verdict === "ajout"
              ? `Oubli rattrapé : ${fmtQte(r.delta)} ajouté au bipage dans ${rayon.code}.`
              : `Écart corrigé (le scotch fait foi) : ligne de ${fmtQte(
                  r.delta,
                )} dans ${rayon.code} — total ramené à la quantité du scotch.`,
        });
      }
      raz();
    } catch (err) {
      setMessage({
        tone: "err",
        texte: err?.data?.message || "Ajout refusé.",
      });
    }
  };

  const stats = contexte?.stats;
  const busyScan = rayonEnCours || verifEnCours;

  return (
    <div className="verif-pr">
      <div className="vpr-header">
        <h1>
          <HiBadgeCheck /> Vérification point rouge
        </h1>
        {stats && stats.total > 0 && (
          <div className="vpr-stats">
            <span>
              <b>{stats.total}</b> vérifiés
            </span>
            <span className="vpr-stat-ok">
              <b>{stats.conforme}</b> conformes
            </span>
            <span className="vpr-stat-ajout">
              <b>{stats.ajout}</b> oublis
            </span>
            <span className="vpr-stat-ecart">
              <b>{stats.ecart}</b> écarts
            </span>
          </div>
        )}
      </div>

      {!entrepriseId ? (
        <div className="vpr-placeholder">
          <HiBadgeCheck />
          <p>Sélectionnez une société dans l'en-tête.</p>
        </div>
      ) : contexte && !contexte.active ? (
        <div className="vpr-placeholder">
          <HiBadgeCheck />
          <p>Aucun inventaire actif pour {entrepriseObj?.trigramme}.</p>
        </div>
      ) : (
        <>
          {/* ── Choix de l'allée : seules les allées ENTIÈREMENT contrôlées
              s'ouvrent (la vérification est la dernière passe). ── */}
          <div className="vpr-allees">
            <span className="vpr-allees-lbl">Allée :</span>
            {allees.map((a) => (
              <button
                key={a.lettre}
                className={`vpr-allee ${allee === a.lettre ? "on" : ""} ${
                  a.prete ? "" : "off"
                }`}
                disabled={!a.prete}
                title={
                  a.prete
                    ? `${a.nbZones} zone${a.nbZones > 1 ? "s" : ""}, toutes contrôlées — vérifiable`
                    : `${a.nbControlees}/${a.nbZones} zones contrôlées — terminez le contrôle de l'allée d'abord`
                }
                onClick={() => {
                  setAllee(a.lettre);
                  setRayon(null);
                  setRayonChoix(null);
                  setResultat(null);
                  setAjout(null);
                  setMessage(null);
                  setCode("");
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                <b>{a.lettre}</b>
                <small>
                  {a.nbControlees}/{a.nbZones}
                  {a.prete ? " ✓" : ""}
                </small>
              </button>
            ))}
          </div>

          {/* ── Rayon en cours : le croisement est STRICT sur le rayon bipé ── */}
          {allee && rayon && (
            <div className="vpr-rayon">
              <span className="vpr-rayon-chip">
                <HiQrcode />
                <b>{rayon.code}</b>
                {rayon.libelle && <span>{rayon.libelle}</span>}
                <small>{rayon.type}</small>
              </span>
              <button className="vpr-btn-rayon" onClick={changerRayon}>
                <HiRefresh /> Changer de rayon
              </button>
            </div>
          )}

          {/* Code brut bipé, présent aux deux emplacements : choisir. */}
          {allee && !rayon && rayonChoix && (
            <div className="vpr-rayon vpr-rayon-ambigu">
              <span className="vpr-allees-lbl">
                Ce code existe à plusieurs emplacements — choisissez :
              </span>
              {rayonChoix.map((z) => (
                <button
                  key={`${z.code}||${z.type}`}
                  className="vpr-btn-rayon"
                  onClick={() => choisirRayon(z)}
                >
                  <b>{z.code}</b> — {z.libelle || "?"} ({z.type})
                </button>
              ))}
            </div>
          )}

          {/* ── Bip : QR du rayon d'abord, puis les scotchs sans point rouge ── */}
          <div className="vpr-scan">
            <div className="vpr-search">
              {rayon ? <HiSearch /> : <HiQrcode />}
              <input
                ref={inputRef}
                type="text"
                placeholder={
                  !allee
                    ? "Choisissez d'abord une allée contrôlée"
                    : !rayon
                      ? `Bipez le QR du rayon (allée ${allee})…`
                      : `Bipez l'article (rayon ${rayon.code})…`
                }
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && biper()}
                disabled={!allee}
              />
            </div>
            <button
              className="vpr-btn-verifier"
              onClick={biper}
              disabled={!code.trim() || !allee || busyScan}
            >
              {busyScan
                ? "Croisement…"
                : rayon
                  ? "Vérifier"
                  : "Choisir le rayon"}
            </button>
          </div>

          {message && (
            <p className={`vpr-message ${message.tone}`}>
              {message.tone === "ok" ? (
                <HiCheckCircle />
              ) : (
                <HiExclamationCircle />
              )}{" "}
              {message.texte}
            </p>
          )}

          {/* ── Verdict ── */}
          {resultat && rayon && !verifEnCours && (
            <div className="vpr-resultat">
              <div className="vpr-article">
                <strong>
                  {resultat.article?.designation ||
                    "Article inconnu du catalogue"}
                </strong>
                <div className="vpr-codes">
                  <span className="vpr-code-chip">
                    <label>NART</label>
                    {resultat.article?.nart || "—"}
                  </span>
                  {resultat.article?.gencod && (
                    <span className="vpr-code-chip">
                      <label>GENCODE</label>
                      {resultat.article.gencod}
                    </span>
                  )}
                  <span className="vpr-code-chip">
                    <label>BIPÉ</label>
                    {resultat.code}
                  </span>
                </div>
              </div>

              {resultat.totalQte !== 0 || resultat.lignes.length > 0 ? (
                <div className="vpr-verdict vpr-trouve">
                  <div className="vpr-verdict-titre">
                    Bipé dans le rayon {rayon.code} —{" "}
                    <b>total {fmtQte(resultat.totalQte)}</b>
                  </div>
                  <ul className="vpr-lignes">
                    {resultat.lignes.map((l, i) => (
                      <li key={i}>
                        <b>{l.zoneCode}</b>
                        <span className="vpr-l-type">{l.zoneType}</span>
                        <span className="vpr-l-qte">{fmtQte(l.qteScan)}</span>
                        {l.agentNom && (
                          <span className="vpr-l-agent">{l.agentNom}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="vpr-consigne">
                    Comparez ce total à la quantité écrite sur le scotch.
                  </p>
                </div>
              ) : (
                <div className="vpr-verdict vpr-absent">
                  <HiExclamationCircle /> Jamais bipé dans le rayon {rayon.code}{" "}
                  : c'est un oubli — ajoutez-le au bipage avec la quantité du
                  scotch.
                </div>
              )}

              {/* Actions */}
              {ajout === null ? (
                <div className="vpr-actions">
                  {resultat.totalQte !== 0 && (
                    <button
                      className="vpr-btn-conforme"
                      onClick={validerConforme}
                      disabled={confirmEnCours}
                    >
                      <HiCheckCircle /> Conforme — je pose le point rouge
                    </button>
                  )}
                  <button
                    className="vpr-btn-ajout"
                    onClick={() => setAjout({ qte: "", obs: "" })}
                  >
                    <HiPlusCircle />{" "}
                    {resultat.totalQte !== 0
                      ? "Le scotch indique une autre quantité…"
                      : "Ajouter au bipage"}
                  </button>
                </div>
              ) : (
                <div className="vpr-ajout">
                  <div className="vpr-ajout-champs">
                    <label>
                      Quantité du scotch
                      <input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        value={ajout.qte}
                        onChange={(e) =>
                          setAjout({ ...ajout, qte: e.target.value })
                        }
                        onKeyDown={(e) => e.key === "Enter" && validerAjout()}
                        placeholder="ex. 12 ou 3,5"
                      />
                    </label>
                    <label>
                      Rayon
                      <input
                        type="text"
                        value={`${rayon.code} — ${rayon.libelle || "?"} (${rayon.type})`}
                        readOnly
                        disabled
                      />
                    </label>
                    <label>
                      Observation (facultatif)
                      <input
                        type="text"
                        value={ajout.obs}
                        onChange={(e) =>
                          setAjout({ ...ajout, obs: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="vpr-ajout-actions">
                    <button
                      className="vpr-btn-conforme"
                      onClick={validerAjout}
                      disabled={ajoutEnCours || !String(ajout.qte).trim()}
                    >
                      <HiCheckCircle /> Valider (le scotch fait foi)
                    </button>
                    <button
                      className="vpr-btn-annuler"
                      onClick={() => setAjout(null)}
                    >
                      <HiX /> Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="vpr-note">
            <HiInformationCircle /> Le croisement est strict sur le rayon bipé —
            un article peut être à plusieurs endroits de la même allée, chaque
            scotch se vérifie dans son rayon. Les fiches de contrôle et les .dat
            de zones ne sont jamais modifiés par cet écran : un ajout entre au
            Détail des bipages (provenance « Vérif point rouge », filtrable) et
            compte dans les écarts et l'intégration Stock XL.
          </p>
        </>
      )}
    </div>
  );
};

export default AdminVerificationPointRougeScreen;
