// src/screens/user/MediathequeScreen.jsx
//
// MÉDIATHÈQUE — banque d'images et de pages HTML mises en ligne, pensée pour
// les signatures mail : chaque fichier a un lien public permanent que l'on
// copie puis colle dans Gmail/Outlook (image de signature, ou page HTML de la
// signature complète à ouvrir et copier-coller dans le client mail).
//
// Le NOM est libre et modifiable ; le LIEN (slug) est figé à la mise en ligne
// pour ne jamais casser les signatures déjà en place.
import React, { useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiPhotograph,
  HiCode,
  HiRefresh,
  HiUpload,
  HiLink,
  HiExternalLink,
  HiPencil,
  HiTrash,
  HiCheck,
  HiX,
  HiExclamationCircle,
  HiSearch,
} from "react-icons/hi";
import {
  useGetMediasQuery,
  useUploadMediasMutation,
  useUpdateMediaMutation,
  useDeleteMediaMutation,
  mediaLienAbsolu,
} from "../../slices/mediathequeApiSlice";
import { hasModuleAccess } from "../../config/adminModules";
import "./MediathequeScreen.css";

const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.html,.htm";

const formatTaille = (octets = 0) => {
  if (octets >= 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  if (octets >= 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${octets} o`;
};

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { dateStyle: "medium" }) : "";

// Nom proposé par défaut : le nom du fichier sans son extension.
const nomDepuisFichier = (file) =>
  (file?.name || "").replace(/\.[^.]+$/, "") || "Fichier";

const MediathequeScreen = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const peutEcrire = hasModuleAccess(userInfo, "mediatheque", "write");
  const peutSupprimer = hasModuleAccess(userInfo, "mediatheque", "delete");

  const { data: medias, isLoading, error, refetch, isFetching } =
    useGetMediasQuery();
  const [uploadMedias, { isLoading: uploading }] = useUploadMediasMutation();
  const [updateMedia] = useUpdateMediaMutation();
  const [deleteMedia] = useDeleteMediaMutation();

  const inputRef = useRef(null);
  // Fichiers choisis mais pas encore envoyés : [{ file, nom }].
  const [attente, setAttente] = useState([]);
  const [messageErreur, setMessageErreur] = useState("");

  const [recherche, setRecherche] = useState("");
  const [filtreType, setFiltreType] = useState("tous"); // tous | image | html

  const [copieId, setCopieId] = useState(null);
  const [editionId, setEditionId] = useState(null);
  const [editionNom, setEditionNom] = useState("");

  const visibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return (medias || []).filter((m) => {
      if (filtreType !== "tous" && m.type !== filtreType) return false;
      if (!terme) return true;
      return (
        m.nom.toLowerCase().includes(terme) || m.slug.toLowerCase().includes(terme)
      );
    });
  }, [medias, recherche, filtreType]);

  const choisirFichiers = (fileList) => {
    const fichiers = [...(fileList || [])];
    if (!fichiers.length) return;
    setMessageErreur("");
    setAttente((prev) => [
      ...prev,
      ...fichiers.map((file) => ({ file, nom: nomDepuisFichier(file) })),
    ]);
  };

  const envoyer = async () => {
    if (!attente.length) return;
    setMessageErreur("");
    try {
      await uploadMedias({
        fichiers: attente.map((a) => a.file),
        noms: attente.map((a) => a.nom.trim() || nomDepuisFichier(a.file)),
      }).unwrap();
      setAttente([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setMessageErreur(err?.data?.message || "Échec de la mise en ligne");
    }
  };

  const copierLien = async (media) => {
    const lien = mediaLienAbsolu(media);
    try {
      await navigator.clipboard.writeText(lien);
    } catch {
      // Clipboard API indisponible (http LAN) : repli prompt natif.
      window.prompt("Copiez le lien :", lien);
    }
    setCopieId(media._id);
    setTimeout(() => setCopieId((id) => (id === media._id ? null : id)), 2000);
  };

  const commencerRenommage = (media) => {
    setEditionId(media._id);
    setEditionNom(media.nom);
  };

  const validerRenommage = async () => {
    const nom = editionNom.trim();
    if (nom) {
      try {
        await updateMedia({ id: editionId, nom }).unwrap();
      } catch (err) {
        setMessageErreur(err?.data?.message || "Échec du renommage");
      }
    }
    setEditionId(null);
  };

  const supprimer = async (media) => {
    const ok = window.confirm(
      `Supprimer « ${media.nom} » ?\n\nLe lien public cessera de fonctionner : ` +
        "toute signature mail qui l'utilise perdra cette image/page.",
    );
    if (!ok) return;
    try {
      await deleteMedia(media._id).unwrap();
    } catch (err) {
      setMessageErreur(err?.data?.message || "Échec de la suppression");
    }
  };

  return (
    <div className="mediatheque-screen">
      <header className="mdt-header">
        <div className="mdt-header-title">
          <div className="mdt-header-icon">
            <HiPhotograph />
          </div>
          <div>
            <h1>Médiathèque</h1>
            <p className="mdt-header-sub">
              Images et pages HTML en ligne — copiez le lien public pour vos
              signatures mail. Le lien ne change jamais, même après renommage.
            </p>
          </div>
        </div>
        <button
          className="mdt-btn ghost icon"
          onClick={refetch}
          disabled={isFetching}
          title="Rafraîchir"
        >
          <HiRefresh className={isFetching ? "spinning" : ""} />
        </button>
      </header>

      {peutEcrire && (
        <section className="mdt-upload">
          <div className="mdt-upload-row">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => choisirFichiers(e.target.files)}
            />
            <span className="mdt-upload-hint">
              PNG, JPEG, GIF, WebP, SVG ou HTML — 10 Mo max par fichier
            </span>
          </div>

          {attente.length > 0 && (
            <div className="mdt-attente">
              {attente.map((a, i) => (
                <div className="mdt-attente-ligne" key={`${a.file.name}-${i}`}>
                  <span className="mdt-attente-fichier" title={a.file.name}>
                    {a.file.name}
                  </span>
                  <input
                    type="text"
                    value={a.nom}
                    placeholder="Nom en ligne"
                    onChange={(e) =>
                      setAttente((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, nom: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <button
                    className="mdt-btn ghost icon"
                    title="Retirer"
                    onClick={() =>
                      setAttente((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    <HiX />
                  </button>
                </div>
              ))}
              <button
                className="mdt-btn primary"
                onClick={envoyer}
                disabled={uploading}
              >
                <HiUpload />
                {uploading
                  ? "Mise en ligne…"
                  : `Mettre en ligne (${attente.length})`}
              </button>
            </div>
          )}
        </section>
      )}

      {messageErreur && (
        <div className="mdt-erreur">
          <HiExclamationCircle /> {messageErreur}
        </div>
      )}

      <div className="mdt-filtres">
        <div className="mdt-recherche">
          <HiSearch />
          <input
            type="text"
            placeholder="Rechercher par nom ou lien…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div className="mdt-onglets">
          {[
            ["tous", "Tous"],
            ["image", "Images"],
            ["html", "Signatures HTML"],
          ].map(([val, label]) => (
            <button
              key={val}
              className={filtreType === val ? "actif" : ""}
              onClick={() => setFiltreType(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="mdt-etat">Chargement…</div>
      ) : error ? (
        <div className="mdt-etat erreur">
          <HiExclamationCircle />
          {error?.data?.message || "Chargement impossible"}
          <button className="mdt-btn ghost" onClick={refetch}>
            Réessayer
          </button>
        </div>
      ) : visibles.length === 0 ? (
        <div className="mdt-etat">
          {medias?.length
            ? "Aucun fichier ne correspond au filtre."
            : "Aucun fichier en ligne pour le moment."}
        </div>
      ) : (
        <div className="mdt-grille">
          {visibles.map((m) => (
            <div className="mdt-carte" key={m._id}>
              <div className="mdt-apercu">
                {m.type === "image" ? (
                  <img src={m.url} alt={m.nom} loading="lazy" />
                ) : (
                  <div className="mdt-apercu-html">
                    <HiCode />
                    <span>HTML</span>
                  </div>
                )}
              </div>
              <div className="mdt-corps">
                {editionId === m._id ? (
                  <div className="mdt-renommage">
                    <input
                      type="text"
                      value={editionNom}
                      autoFocus
                      onChange={(e) => setEditionNom(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") validerRenommage();
                        if (e.key === "Escape") setEditionId(null);
                      }}
                    />
                    <button
                      className="mdt-btn ghost icon"
                      title="Valider"
                      onClick={validerRenommage}
                    >
                      <HiCheck />
                    </button>
                    <button
                      className="mdt-btn ghost icon"
                      title="Annuler"
                      onClick={() => setEditionId(null)}
                    >
                      <HiX />
                    </button>
                  </div>
                ) : (
                  <h2 title={m.nom}>{m.nom}</h2>
                )}
                <div className="mdt-lien" title={mediaLienAbsolu(m)}>
                  {m.url}
                </div>
                <div className="mdt-meta">
                  <span>{formatTaille(m.size)}</span>
                  <span>{formatDate(m.createdAt)}</span>
                  {m.createdBy?.nom && (
                    <span>
                      {[m.createdBy.prenom, m.createdBy.nom]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="mdt-actions">
                <button
                  className={`mdt-btn primary ${copieId === m._id ? "copie" : ""}`}
                  onClick={() => copierLien(m)}
                  title="Copier le lien public"
                >
                  {copieId === m._id ? <HiCheck /> : <HiLink />}
                  {copieId === m._id ? "Copié !" : "Copier le lien"}
                </button>
                <a
                  className="mdt-btn ghost icon"
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ouvrir dans un nouvel onglet"
                >
                  <HiExternalLink />
                </a>
                {peutEcrire && editionId !== m._id && (
                  <button
                    className="mdt-btn ghost icon"
                    title="Renommer (le lien ne change pas)"
                    onClick={() => commencerRenommage(m)}
                  >
                    <HiPencil />
                  </button>
                )}
                {peutSupprimer && (
                  <button
                    className="mdt-btn ghost icon danger"
                    title="Supprimer (le lien cessera de fonctionner)"
                    onClick={() => supprimer(m)}
                  >
                    <HiTrash />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MediathequeScreen;
