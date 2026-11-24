// src/screens/admin/AdminVerificationPointRougeScreen.jsx
//
// VÉRIFICATION POINT ROUGE (module à part entière, dossier Terrain — version
// web, la version collecteur viendra ensuite). Dernière passe de
// l'inventaire : au papillonnage l'agent écrit la quantité comptée sur un
// scotch, au bipage un point rouge est collé après chaque scan. Quand TOUTES
// les zones d'une allée sont contrôlées, un agent balaye l'allée : chaque
// scotch SANS point rouge est bipé ici, et l'écran croise avec les bipages de
// l'ALLÉE :
//   - trouvé à la bonne quantité → « Conforme » (point rouge oublié, tracé) ;
//   - absent ou quantité différente → ajout au bipage, LE SCOTCH FAIT FOI
//     (ligne de delta, négatif accepté).
// ⚠️ Rien n'est réimprimé, aucun .dat de zone n'est touché : la ligne entre
// seulement au Détail des bipages (source « verification », filtrable) et
// compte dans les écarts et l'intégration Stock XL.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiBadgeCheck,
  HiSearch,
  HiCheckCircle,
  HiPlusCircle,
  HiX,
  HiExclamationCircle,
  HiInformationCircle,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetContexteVerificationQuery,
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
  const [code, setCode] = useState("");
  const [resultat, setResultat] = useState(null); // réponse de /verifier
  const [ajout, setAjout] = useState(null); // null | { qte, zoneKey, obs }
  const [message, setMessage] = useState(null); // { tone, texte }
  const inputRef = useRef(null);

  const { data: contexte } = useGetContexteVerificationQuery(entrepriseId, {
    skip: !entrepriseId,
  });
  const [verifier, { isFetching: verifEnCours }] =
    useLazyVerifierCodeAlleeQuery();
  const [confirmer, { isLoading: confirmEnCours }] =
    useConfirmerVerificationMutation();
  const [ajouter, { isLoading: ajoutEnCours }] = useAjouterAuBipageMutation();

  // Changement de société : tout remettre à zéro.
  useEffect(() => {
    setAllee("");
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

  const biper = async () => {
    const c = code.trim();
    if (!c || !allee) return;
    setMessage(null);
    setAjout(null);
    try {
      const r = await verifier({ entrepriseId, allee, code: c }).unwrap();
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

  const validerConforme = async () => {
    if (!resultat) return;
    setMessage(null);
    try {
      await confirmer({ entrepriseId, allee, code: resultat.code }).unwrap();
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
    if (!resultat || !ajout) return;
    const [zoneCode, zoneType] = (ajout.zoneKey || "").split("||");
    setMessage(null);
    try {
      const r = await ajouter({
        entrepriseId,
        allee,
        code: resultat.code,
        qteScotch: Number(String(ajout.qte).replace(",", ".")),
        zoneCode,
        zoneType,
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
              ? `Oubli rattrapé : ${fmtQte(r.delta)} ajouté au bipage dans ${zoneCode}.`
              : `Écart corrigé (le scotch fait foi) : ligne de ${fmtQte(
                  r.delta,
                )} dans ${zoneCode} — total ramené à la quantité du scotch.`,
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
                  setResultat(null);
                  setAjout(null);
                  setMessage(null);
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

          {/* ── Bip du scotch sans point rouge ── */}
          <div className="vpr-scan">
            <div className="vpr-search">
              <HiSearch />
              <input
                ref={inputRef}
                type="text"
                placeholder={
                  allee
                    ? `Bipez l'article (allée ${allee})…`
                    : "Choisissez d'abord une allée contrôlée"
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
              disabled={!code.trim() || !allee || verifEnCours}
            >
              {verifEnCours ? "Croisement…" : "Vérifier"}
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
          {resultat && !verifEnCours && (
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
                    Bipé dans l'allée {resultat.allee} —{" "}
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
                  <HiExclamationCircle /> Jamais bipé dans l'allée{" "}
                  {resultat.allee} : c'est un oubli — ajoutez-le au bipage avec
                  la quantité du scotch.
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
                    onClick={() =>
                      setAjout({
                        qte: "",
                        zoneKey:
                          resultat.lignes[0] &&
                          resultat.zones.some(
                            (z) =>
                              z.code === resultat.lignes[0].zoneCode &&
                              z.type === resultat.lignes[0].zoneType,
                          )
                            ? `${resultat.lignes[0].zoneCode}||${resultat.lignes[0].zoneType}`
                            : resultat.zones.length === 1
                              ? `${resultat.zones[0].code}||${resultat.zones[0].type}`
                              : "",
                        obs: "",
                      })
                    }
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
                      Zone (dans l'allée {resultat.allee})
                      <select
                        value={ajout.zoneKey}
                        onChange={(e) =>
                          setAjout({ ...ajout, zoneKey: e.target.value })
                        }
                      >
                        <option value="">— Choisir la zone —</option>
                        {resultat.zones.map((z) => (
                          <option
                            key={`${z.code}||${z.type}`}
                            value={`${z.code}||${z.type}`}
                          >
                            {z.code} — {z.libelle || "?"} ({z.type})
                          </option>
                        ))}
                      </select>
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
                      disabled={
                        ajoutEnCours ||
                        !ajout.zoneKey ||
                        !String(ajout.qte).trim()
                      }
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
            <HiInformationCircle /> Les fiches de contrôle et les .dat de zones
            ne sont jamais modifiés par cet écran : un ajout entre au Détail des
            bipages (provenance « Vérif point rouge », filtrable) et compte dans
            les écarts et l'intégration Stock XL.
          </p>
        </>
      )}
    </div>
  );
};

export default AdminVerificationPointRougeScreen;
