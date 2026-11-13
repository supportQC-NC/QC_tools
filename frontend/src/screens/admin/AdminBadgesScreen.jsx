// src/screens/admin/AdminBadgesScreen.jsx
//
// BADGES UTILISATEURS — le code-barres qui permet de désigner une personne d'un
// bip plutôt que de la chercher dans une liste déroulante (coupon d'inventaire
// en premier lieu).
//
// Le code est un EAN-13 interne dérivé de l'_id du compte : il est attribué
// automatiquement à la création et ne change jamais. Les comptes créés AVANT
// cette fonctionnalité n'en ont pas — d'où le bouton de rattrapage, à passer
// une fois.
//
// Deux documents, deux usages (voir badgeUtilisateurService côté serveur) :
//   · la FEUILLE DE POSTE reste au poste de saisie, on y bipe l'agent ;
//   · les CARTES se découpent et se plastifient, une par agent.
//
// FILTRE SOCIÉTÉ (13/11/2026) : le menu déroulant « Société » borne TOUT l'écran
// aux comptes qui ont ACCÈS à cette société — liste, compteur « sans badge »,
// attribution et les deux PDF. On prépare l'inventaire d'un magasin : imprimer
// l'annuaire entier pour en distribuer dix cartes n'était pas tenable. Le
// serveur refait le filtre à l'impression (`filtrerParAccesEntreprise`), la
// règle d'accès n'est donc pas décidée par le client.
import React, { useMemo, useState } from "react";
import {
  HiIdentification,
  HiRefresh,
  HiSearch,
  HiDocumentReport,
  HiCreditCard,
  HiSparkles,
  HiCheck,
  HiExclamationCircle,
} from "react-icons/hi";
import {
  useGetUsersQuery,
  useGenererBadgesManquantsMutation,
  badgesPdfUrl,
} from "../../slices/userApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminBadgesScreen.css";

const nomComplet = (u) =>
  `${u?.prenom || ""} ${u?.nom || ""}`.trim() || u?.email || "";

/** Sociétés d'un compte, telles qu'affichées dans la colonne du même nom. */
const societesDe = (u) => {
  const p = u?.permissions;
  if (!p) return [];
  if (p.allEntreprises) return ["Toutes"];
  return (p.entreprises || []).map((e) => e.trigramme || e.nomComplet || "");
};

/**
 * Ce compte a-t-il ACCÈS à cette société ?
 *
 * Même règle que le contrôle d'accès du serveur (`getAccessibleEntreprises`) :
 * `allEntreprises`, ou la société listée dans ses permissions ; un ADMIN sans
 * document de permissions est un super-admin hérité, donc il a accès.
 * ⚠️ Miroir NON sécuritaire : le serveur refait le filtre à l'impression
 * (`filtrerParAccesEntreprise`). Ici, c'est l'affichage.
 */
const aAccesSociete = (u, entrepriseId) => {
  if (!entrepriseId) return true;
  const p = u?.permissions;
  if (!p) return u?.role === "admin";
  if (p.allEntreprises) return true;
  return (p.entreprises || []).some(
    (e) => String(e?._id || e) === String(entrepriseId),
  );
};

const AdminBadgesScreen = () => {
  const { data: users, isLoading, isFetching, refetch } = useGetUsersQuery();
  const [genererBadges, { isLoading: generation }] =
    useGenererBadgesManquantsMutation();

  const { data: entreprises } = useGetMyEntreprisesQuery();

  const [recherche, setRecherche] = useState("");
  // Société dont on veut les badges ("" = toutes celles de mon périmètre).
  // Filtre TOUT l'écran : la liste, le compteur « sans badge », l'attribution
  // et les deux PDF — on imprime les badges d'un magasin, pas de l'annuaire.
  const [societe, setSociete] = useState("");
  const [tri, setTri] = useState("nom"); // nom | entreprise
  const [avecInactifs, setAvecInactifs] = useState(false);
  // Sélection pour l'impression. Vide = tout ce qui est affiché.
  const [selection, setSelection] = useState(() => new Set());
  const [msg, setMsg] = useState(null);

  // Comptes du périmètre choisi, avant recherche : c'est sur eux que portent le
  // compteur « sans badge » et l'attribution, pour que le bandeau parle du même
  // ensemble que le tableau.
  const perimetre = useMemo(
    () => (users || []).filter((u) => aAccesSociete(u, societe)),
    [users, societe],
  );

  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return perimetre
      .filter((u) => (avecInactifs ? true : u.isActive))
      .filter((u) => {
        if (!q) return true;
        return [nomComplet(u), u.email, u.codeBarre]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) =>
        nomComplet(a).localeCompare(nomComplet(b), "fr", {
          sensitivity: "base",
        }),
      );
  }, [perimetre, recherche, avecInactifs]);

  const sansBadge = useMemo(
    () => perimetre.filter((u) => !String(u.codeBarre || "").trim()).length,
    [perimetre],
  );

  const societeChoisie = useMemo(
    () => (entreprises || []).find((e) => String(e._id) === String(societe)),
    [entreprises, societe],
  );

  const basculer = (id) =>
    setSelection((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toutSelectionner = () => {
    // Seuls les comptes AVEC badge : les autres seraient refusés à l'impression.
    const avecBadge = liste
      .filter((u) => String(u.codeBarre || "").trim())
      .map((u) => u._id);
    setSelection((prev) =>
      prev.size === avecBadge.length ? new Set() : new Set(avecBadge),
    );
  };

  const lancerRattrapage = async () => {
    setMsg(null);
    try {
      const res = await genererBadges({ entreprise: societe }).unwrap();
      setMsg({ type: "ok", texte: res.message });
    } catch (err) {
      setMsg({
        type: "err",
        texte: err?.data?.message || "Attribution impossible.",
      });
    }
  };

  // Le PDF s'ouvre dans un onglet : c'est un flux, et l'utilisateur veut le
  // voir avant d'imprimer.
  const ouvrirPdf = (format) => {
    const ids = [...selection];
    window.open(
      `${BASE_URL}${badgesPdfUrl({
        format,
        tri,
        ids,
        entreprise: societe,
        inactifs: avecInactifs,
      })}`,
      "_blank",
      "noopener",
    );
  };

  const nbImprimes = selection.size || liste.filter((u) => u.codeBarre).length;

  return (
    <div className="badges-screen">
      <div className="badges-head">
        <h1>
          <HiIdentification /> Badges utilisateurs
        </h1>
        <button
          className="badges-icon-btn"
          onClick={refetch}
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          <HiRefresh className={isFetching ? "spin" : ""} />
        </button>
      </div>
      <p className="badges-intro">
        Chaque compte porte un code-barres EAN-13, attribué automatiquement à sa
        création. Il sert à <b>désigner la personne d'un bip</b> — au coupon
        d'inventaire, on bipe son badge au lieu de la chercher dans une liste.
      </p>

      {/* Rattrapage : visible uniquement tant qu'il reste des comptes sans
          badge. Une fois à zéro, le bouton n'a plus de raison d'être affiché. */}
      {sansBadge > 0 && (
        <div className="badges-rattrapage">
          <HiExclamationCircle />
          <span>
            <b>{sansBadge}</b> compte{sansBadge > 1 ? "s" : ""} sans badge
            {societeChoisie
              ? ` chez ${societeChoisie.trigramme || societeChoisie.nomComplet}`
              : ""}{" "}
            — créé{sansBadge > 1 ? "s" : ""} avant cette fonctionnalité.
          </span>
          <button
            className="btn-primary"
            onClick={lancerRattrapage}
            disabled={generation}
          >
            <HiSparkles />{" "}
            {generation ? "Attribution…" : "Attribuer les badges manquants"}
          </button>
        </div>
      )}

      {msg && (
        <div className={`badges-msg ${msg.type}`}>
          {msg.type === "ok" ? <HiCheck /> : <HiExclamationCircle />} {msg.texte}
        </div>
      )}

      <div className="badges-barre">
        <div className="badges-search">
          <HiSearch />
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, e-mail, code-barres…"
          />
        </div>

        <label className="badges-champ">
          <span>Société</span>
          <select
            value={societe}
            onChange={(e) => {
              setSociete(e.target.value);
              // La sélection cochée appartenait à l'autre périmètre : la garder
              // ferait imprimer des comptes que l'écran n'affiche plus (ou,
              // filtre serveur aidant, un PDF vide).
              setSelection(new Set());
            }}
            title="N'afficher et n'imprimer que les comptes ayant accès à cette société"
          >
            <option value="">Toutes mes sociétés</option>
            {(entreprises || []).map((e) => (
              <option key={e._id} value={e._id}>
                {e.trigramme ? `${e.trigramme} — ` : ""}
                {e.nomComplet || e.nomDossierDBF}
              </option>
            ))}
          </select>
        </label>

        <label className="badges-champ">
          <span>Classement du PDF</span>
          <select value={tri} onChange={(e) => setTri(e.target.value)}>
            <option value="nom">Ordre alphabétique</option>
            <option value="entreprise">Par société</option>
          </select>
        </label>

        <label className="badges-check">
          <input
            type="checkbox"
            checked={avecInactifs}
            onChange={(e) => setAvecInactifs(e.target.checked)}
          />
          Afficher les comptes désactivés
        </label>

        <div className="badges-actions">
          <button className="btn-primary" onClick={() => ouvrirPdf("liste")}>
            <HiDocumentReport /> Feuille de poste
          </button>
          <button className="btn-primary" onClick={() => ouvrirPdf("cartes")}>
            <HiCreditCard /> Cartes à découper
          </button>
        </div>
      </div>

      <p className="badges-portee">
        {selection.size
          ? `${selection.size} compte(s) sélectionné(s) : le PDF ne portera qu'eux.`
          : `Aucune sélection : le PDF portera les ${nbImprimes} compte(s) affiché(s) qui ont un badge.`}
        {societeChoisie && (
          <>
            {" "}
            Périmètre :{" "}
            <b>
              {societeChoisie.trigramme || societeChoisie.nomComplet} uniquement
            </b>{" "}
            (comptes ayant accès à cette société).
          </>
        )}
      </p>

      <div className="badges-table-wrap">
        <table className="badges-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={
                    selection.size > 0 &&
                    selection.size ===
                      liste.filter((u) => u.codeBarre).length
                  }
                  onChange={toutSelectionner}
                  title="Tout sélectionner / désélectionner"
                />
              </th>
              <th>Utilisateur</th>
              <th>Société(s)</th>
              <th>Rôle</th>
              <th>Code-barres</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="badges-vide">
                  Chargement…
                </td>
              </tr>
            ) : liste.length === 0 ? (
              <tr>
                <td colSpan={5} className="badges-vide">
                  Aucun compte.
                </td>
              </tr>
            ) : (
              liste.map((u) => {
                const code = String(u.codeBarre || "").trim();
                return (
                  <tr
                    key={u._id}
                    className={`${!u.isActive ? "ligne-inactive" : ""} ${
                      !code ? "ligne-sans-badge" : ""
                    }`.trim()}
                  >
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={selection.has(u._id)}
                        onChange={() => basculer(u._id)}
                        disabled={!code}
                        title={
                          code ? "" : "Ce compte n'a pas encore de badge"
                        }
                      />
                    </td>
                    <td>
                      <span className="badges-nom">{nomComplet(u)}</span>
                      <span className="badges-mail">{u.email}</span>
                    </td>
                    <td className="badges-soc">
                      {societesDe(u).join(" · ") || "—"}
                    </td>
                    <td>
                      <span className={`badges-role r-${u.role}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="badges-code">
                      {code || <span className="badges-absent">à attribuer</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="badges-note">
        <b>Feuille de poste</b> : un agent par ligne, à garder au poste de saisie
        pour biper la personne qui rend son coupon. <b>Cartes à découper</b> :
        format carte bancaire, à plastifier et distribuer le temps de
        l'inventaire. Les comptes sans badge sont exclus des deux documents — une
        carte sans code est indétectable une fois découpée.
      </p>
    </div>
  );
};

export default AdminBadgesScreen;
