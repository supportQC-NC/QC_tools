// src/components/menu/MenuBoard/MenuBoard.jsx
//
// Éditeur d'organisation de menu RÉUTILISABLE (drag & drop @dnd-kit).
// Une seule implémentation partagée par :
//   - le constructeur ADMIN (config globale + édition des infobulles)  → /admin/infobulles
//   - l'organiseur PERSO de chaque utilisateur                         → /mon-menu
//
// Le composant gère TOUT l'état du tableau (dossiers/chapitres, rangement des
// onglets, zone « Masqués », drag & drop) et délègue au parent, via props :
//   - la source de données  (`catalog`, `initialLayout`)
//   - la persistance        (`onSave`, `onReset`)
//   - les libellés/textes    et le rendu optionnel du corps de carte (`renderItemBody`)
//
// Il ne connaît NI RTK Query NI les permissions : il reçoit un catalogue déjà
// filtré et une fonction de sauvegarde. C'est ce découplage qui le rend réutilisable.
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  HiViewGrid,
  HiPlus,
  HiTrash,
  HiChevronUp,
  HiChevronDown,
  HiEyeOff,
  HiSelector,
  HiSave,
  HiFolderAdd,
} from "react-icons/hi";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CHAPTER_ICONS, chapterIcon } from "../../../config/menuConfig";
import "./MenuBoard.css";

// Identifiants des deux conteneurs spéciaux (non-dossiers).
const NONCLASSE = "nonclasse";
const MASQUES = "masques";

// Préfixe d'id d'un conteneur « dossier/chapitre » (les autres ids sont des paths).
const cid = (key) => `c:${key}`;

// Profondeur maximale : dossier > sous-dossier. Le serveur applique la même
// limite (`PROFONDEUR_MAX` dans menuLayoutController) : au-delà, la sidebar
// devient illisible et le tableau ingérable.
const PROFONDEUR_MAX = 2;

// L'arborescence est stockée À PLAT (`parent` = key du dossier conteneur, null
// pour un dossier racine) et l'ordre du tableau est l'ordre d'affichage, en
// profondeur d'abord. Ces deux fonctions font l'aller-retour avec un arbre, la
// forme commode pour déplacer un dossier AVEC ses sous-dossiers.
const enArbre = (meta) => {
  const parParent = new Map();
  (meta || []).forEach((c) => {
    const parent = c.parent || null;
    if (!parParent.has(parent)) parParent.set(parent, []);
    parParent.get(parent).push({ ...c });
  });
  const construire = (parent) =>
    (parParent.get(parent) || []).map((c) => ({
      ...c,
      enfants: construire(c.key),
    }));
  return construire(null);
};

const aplatirArbre = (arbre, parent = null, out = []) => {
  (arbre || []).forEach((n) => {
    out.push({ key: n.key, label: n.label, icon: n.icon, parent });
    aplatirArbre(n.enfants, n.key, out);
  });
  return out;
};

// Clés de tous les descendants d'un dossier (suppression, déplacement).
const descendants = (meta, key) => {
  const out = [];
  const pile = [key];
  while (pile.length) {
    const k = pile.pop();
    (meta || []).forEach((c) => {
      if ((c.parent || null) === k) {
        out.push(c.key);
        pile.push(c.key);
      }
    });
  }
  return out;
};

// ── Carte d'onglet déplaçable ────────────────────────────────────────────────
// Le corps (`children`) est injecté par MenuBoard : libellé simple par défaut,
// ou libellé + éditeur d'infobulle côté admin (via `renderItemBody`).
const ItemCard = ({ path, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: path });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="mb-card">
      <span className="mb-handle" {...attributes} {...listeners} title="Déplacer">
        <HiSelector />
      </span>
      <div className="mb-card-body">{children}</div>
    </div>
  );
};

// ── Conteneur droppable (dossier / non classé / masqués) ─────────────────────
const Dropzone = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`mb-dropzone ${isOver ? "over" : ""}`}>
      {children}
    </div>
  );
};

/**
 * @param {object}   props
 * @param {ReactNode} props.title            Titre de la page (icône + texte).
 * @param {ReactNode} [props.intro]          Paragraphe d'aide sous le titre.
 * @param {Array}    props.catalog           Onglets disponibles [{ path, label, icon }] (déjà filtrés).
 * @param {object}   props.initialLayout     Layout de départ { chapitres, masques }.
 * @param {string}   [props.chapterNoun]     Nom d'un groupe : « chapitre » (défaut) ou « dossier ».
 * @param {Function} props.onSave            async (layout) => void — persiste { chapitres, masques }.
 * @param {string}   props.saveLabel         Libellé du bouton d'enregistrement.
 * @param {string}   props.saveSuccess       Message affiché après un enregistrement réussi.
 * @param {Function} [props.onReset]         async () => void — si fourni, affiche un bouton de réinitialisation.
 * @param {object}   [props.resetLayout]     Layout ré-appliqué après une réinitialisation réussie.
 * @param {string}   [props.resetLabel]      Libellé du bouton de réinitialisation.
 * @param {string}   [props.resetSuccess]    Message affiché après une réinitialisation.
 * @param {Function} [props.renderItemBody]  (path, cat) => ReactNode — corps de carte personnalisé.
 * @param {ReactNode}[props.statusSlot]      Zone de statut additionnelle (ex. message d'infobulle admin).
 */
const MenuBoard = ({
  title,
  intro,
  catalog,
  initialLayout,
  chapterNoun = "chapitre",
  onSave,
  saveLabel = "Enregistrer",
  saveSuccess = "Organisation enregistrée.",
  onReset,
  resetLayout,
  resetLabel = "Réinitialiser",
  resetSuccess = "Organisation réinitialisée.",
  renderItemBody,
  statusSlot = null,
}) => {
  const byPath = useMemo(
    () => new Map((catalog || []).map((c) => [c.path, c])),
    [catalog],
  );

  // État d'édition.
  const [chapMeta, setChapMeta] = useState([]); // [{ key, label, icon }]
  const [items, setItems] = useState({}); // { containerId: [path] }
  const [activeId, setActiveId] = useState(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ready, setReady] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Construit l'état interne à partir d'un layout { chapitres, masques }.
  // Tout onglet du catalogue non rangé/masqué atterrit dans « Non classé ».
  const hydrate = useCallback(
    (lay) => {
      const meta = [];
      const map = { [NONCLASSE]: [], [MASQUES]: [] };
      const placed = new Set();
      const clesConnues = new Set(
        ((lay && lay.chapitres) || []).map((c) => c.key).filter(Boolean),
      );
      for (const ch of (lay && lay.chapitres) || []) {
        const key = ch.key || `chap_${meta.length}`;
        // Un parent inconnu (document ancien, dossier supprimé ailleurs) fait
        // remonter le dossier à la racine plutôt que de le faire disparaître.
        const parent =
          ch.parent && ch.parent !== key && clesConnues.has(ch.parent)
            ? ch.parent
            : null;
        meta.push({
          key,
          label: ch.label || "Sans nom",
          icon: ch.icon || "folder",
          parent,
        });
        map[cid(key)] = [];
        for (const p of ch.items || []) {
          if (byPath.has(p) && !placed.has(p)) {
            map[cid(key)].push(p);
            placed.add(p);
          }
        }
      }
      ((lay && lay.masques) || []).forEach((p) => {
        if (byPath.has(p) && !placed.has(p)) {
          map[MASQUES].push(p);
          placed.add(p);
        }
      });
      (catalog || []).forEach((c) => {
        if (!placed.has(c.path)) map[NONCLASSE].push(c.path);
      });
      setChapMeta(meta);
      setItems(map);
    },
    [byPath, catalog],
  );

  // Initialisation unique, dès que le layout de départ est disponible.
  useEffect(() => {
    if (ready || initialLayout === undefined) return;
    hydrate(initialLayout);
    setReady(true);
  }, [initialLayout, ready, hydrate]);

  // Localise le conteneur d'un id (path), ou renvoie l'id si c'est un conteneur.
  const containerOf = (state, id) => {
    if (id in state) return id;
    return Object.keys(state).find((k) => state[k].includes(id));
  };

  // Déplacement inter-conteneurs en cours de drag.
  const onDragOver = ({ active, over }) => {
    if (!over) return;
    setItems((prev) => {
      const from = containerOf(prev, active.id);
      const to = over.id in prev ? over.id : containerOf(prev, over.id);
      if (!from || !to || from === to) return prev;
      const overItems = prev[to];
      const overIndex = overItems.indexOf(over.id);
      const insert = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...prev,
        [from]: prev[from].filter((i) => i !== active.id),
        [to]: [...overItems.slice(0, insert), active.id, ...overItems.slice(insert)],
      };
    });
  };

  // Réordonnancement au sein d'un même conteneur à la fin du drag.
  const onDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over) return;
    setItems((prev) => {
      const from = containerOf(prev, active.id);
      const to = over.id in prev ? over.id : containerOf(prev, over.id);
      if (!from || !to || from !== to) return prev;
      const list = prev[from];
      const oldI = list.indexOf(active.id);
      const newI = list.indexOf(over.id);
      if (oldI === -1 || newI === -1 || oldI === newI) return prev;
      return { ...prev, [from]: arrayMove(list, oldI, newI) };
    });
  };

  // ── Gestion des dossiers / sous-dossiers ───────────────────────────────────
  // `parent = null` -> dossier racine ; sinon sous-dossier du dossier `parent`.
  // Le nouveau dossier est inséré juste APRÈS le dernier descendant de son
  // parent, pour que le tableau reste en profondeur d'abord.
  const addChapter = (parent = null) => {
    const key = `chap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nom = parent ? `Nouveau sous-${chapterNoun}` : `Nouveau ${chapterNoun}`;
    setChapMeta((m) => {
      const nouveau = { key, label: nom, icon: "folder", parent };
      if (!parent) return [...m, nouveau];
      const bloc = [parent, ...descendants(m, parent)];
      let dernier = -1;
      m.forEach((c, i) => {
        if (bloc.includes(c.key)) dernier = i;
      });
      const copie = [...m];
      copie.splice(dernier + 1, 0, nouveau);
      return copie;
    });
    setItems((it) => ({ ...it, [cid(key)]: [] }));
  };
  const renameChapter = (key, label) =>
    setChapMeta((m) => m.map((c) => (c.key === key ? { ...c, label } : c)));
  const setChapterIcon = (key, icon) =>
    setChapMeta((m) => m.map((c) => (c.key === key ? { ...c, icon } : c)));

  // Monter / descendre : on déplace le dossier AVEC ses sous-dossiers, et
  // seulement entre frères — un dossier ne change jamais de parent par ce biais.
  const moveChapter = (key, dir) => {
    setChapMeta((m) => {
      const cible = m.find((c) => c.key === key);
      if (!cible) return m;
      const parent = cible.parent || null;
      const arbre = enArbre(m);
      const trouverFratrie = (noeuds) => {
        if (noeuds.some((n) => n.key === key)) return noeuds;
        for (const n of noeuds) {
          const trouve = trouverFratrie(n.enfants || []);
          if (trouve) return trouve;
        }
        return null;
      };
      const fratrie = parent === null ? arbre : trouverFratrie(arbre);
      if (!fratrie) return m;
      const i = fratrie.findIndex((n) => n.key === key);
      const j = i + dir;
      if (j < 0 || j >= fratrie.length) return m;
      // arrayMove muterait une copie détachée : on remplace le contenu du
      // tableau de fratrie en place, puis on ré-aplatit tout l'arbre.
      const ordonne = arrayMove(fratrie, i, j);
      fratrie.length = 0;
      ordonne.forEach((n) => fratrie.push(n));
      return aplatirArbre(arbre);
    });
  };

  // Supprimer un dossier supprime aussi ses sous-dossiers ; TOUS les onglets
  // qu'ils contenaient repartent en « Non classé » (rien n'est perdu).
  const deleteChapter = (key) => {
    const cles = [key, ...descendants(chapMeta, key)];
    setItems((it) => {
      const next = { ...it };
      const recuperes = [];
      cles.forEach((k) => {
        recuperes.push(...(next[cid(k)] || []));
        delete next[cid(k)];
      });
      next[NONCLASSE] = [...next[NONCLASSE], ...recuperes];
      return next;
    });
    setChapMeta((m) => m.filter((c) => !cles.includes(c.key)));
  };

  // Reconstruit le layout { chapitres, masques } à partir de l'état d'édition.
  const buildLayout = () => ({
    chapitres: chapMeta.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon,
      parent: c.parent || null,
      items: items[cid(c.key)] || [],
    })),
    masques: items[MASQUES] || [],
  });

  // Dossiers d'un niveau donné, dans l'ordre d'affichage.
  const enfantsDe = (parent) =>
    chapMeta.filter((c) => (c.parent || null) === parent);

  // ── Actions (délèguent la persistance au parent) ───────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(buildLayout());
      setMsg(saveSuccess);
    } catch {
      setMsg("Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await onReset();
      if (resetLayout) hydrate(resetLayout);
      setMsg(resetSuccess);
    } catch {
      setMsg("Erreur lors de la réinitialisation.");
    } finally {
      setResetting(false);
    }
  };

  const renderCards = (containerId) =>
    (items[containerId] || []).map((path) => {
      const cat = byPath.get(path);
      return (
        <ItemCard key={path} path={path}>
          {renderItemBody ? (
            renderItemBody(path, cat)
          ) : (
            <div className="mb-card-label">{cat?.label || path}</div>
          )}
        </ItemCard>
      );
    });

  // Rendu d'un dossier. RÉCURSIF : `niveau` 1 = dossier racine, 2 = sous-dossier
  // (au-delà, plus de bouton « sous-dossier » — cf. PROFONDEUR_MAX).
  const renderChapitre = (ch, idx, freres, niveau) => {
    const IconC = chapterIcon(ch.icon);
    const dropId = cid(ch.key);
    const sousDossiers = enfantsDe(ch.key);
    return (
      <div
        className={`mb-chapter ${niveau > 1 ? "mb-subchapter" : ""}`}
        key={ch.key}
      >
        <div className="mb-chapter-head">
          <span className="mb-chapter-ic">
            <IconC />
          </span>
          <input
            className="mb-chapter-name"
            value={ch.label}
            onChange={(e) => renameChapter(ch.key, e.target.value)}
          />
          <div className="mb-chapter-actions">
            {niveau < PROFONDEUR_MAX && (
              <button
                className="mb-btn"
                onClick={() => addChapter(ch.key)}
                title={`Ajouter un sous-${chapterNoun} dans « ${ch.label} »`}
              >
                <HiFolderAdd />
              </button>
            )}
            <button
              className="mb-btn"
              disabled={idx === 0}
              onClick={() => moveChapter(ch.key, -1)}
              title="Monter"
            >
              <HiChevronUp />
            </button>
            <button
              className="mb-btn"
              disabled={idx === freres.length - 1}
              onClick={() => moveChapter(ch.key, 1)}
              title="Descendre"
            >
              <HiChevronDown />
            </button>
            <button
              className="mb-btn danger"
              onClick={() => deleteChapter(ch.key)}
              title={
                sousDossiers.length
                  ? "Supprimer (sous-dossiers compris ; les onglets repassent en Non classé)"
                  : "Supprimer (les onglets repassent en Non classé)"
              }
            >
              <HiTrash />
            </button>
          </div>
        </div>
        <div className="mb-iconpick">
          {Object.keys(CHAPTER_ICONS).map((name) => {
            const I = CHAPTER_ICONS[name];
            return (
              <button
                key={name}
                className={`mb-iconbtn ${ch.icon === name ? "on" : ""}`}
                onClick={() => setChapterIcon(ch.key, name)}
                title={name}
              >
                <I />
              </button>
            );
          })}
        </div>
        <Dropzone id={dropId}>
          <SortableContext
            items={items[dropId] || []}
            strategy={verticalListSortingStrategy}
          >
            {renderCards(dropId)}
            {(items[dropId] || []).length === 0 && (
              <div className="mb-empty">Glissez des onglets ici</div>
            )}
          </SortableContext>
        </Dropzone>

        {/* Sous-dossiers : même carte, en retrait. Ils suivent les onglets du
            dossier, comme dans la sidebar. */}
        {sousDossiers.length > 0 && (
          <div className="mb-subchapters">
            {sousDossiers.map((sc, i, fr) => renderChapitre(sc, i, fr, niveau + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!ready) {
    return (
      <div className="ib-wrap">
        <h1>{title}</h1>
        <p className="ib-intro">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="ib-wrap">
      <h1>{title}</h1>
      {intro && <p className="ib-intro">{intro}</p>}

      <div className="mb-toolbar">
        <button className="ib-btn" onClick={() => addChapter(null)}>
          <HiPlus /> Ajouter un {chapterNoun}
        </button>
        <button className="ib-btn primary" onClick={handleSave} disabled={saving}>
          <HiSave /> {saving ? "Enregistrement…" : saveLabel}
        </button>
        {onReset && (
          <button className="ib-btn" onClick={handleReset} disabled={resetting}>
            <HiViewGrid /> {resetting ? "Réinitialisation…" : resetLabel}
          </button>
        )}
        {msg && <span className="mb-msg">{msg}</span>}
        {statusSlot}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => setActiveId(active.id)}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="mb-grid">
          {/* Dossiers, et leurs sous-dossiers imbriqués (profondeur 2 max). */}
          {enfantsDe(null).map((ch, idx, freres) =>
            renderChapitre(ch, idx, freres, 1),
          )}

          {/* Non classé */}
          <div className="mb-chapter mb-special">
            <div className="mb-chapter-head">
              <span className="mb-chapter-ic"><HiViewGrid /></span>
              <span className="mb-chapter-name static">Non classé</span>
            </div>
            <Dropzone id={NONCLASSE}>
              <SortableContext items={items[NONCLASSE] || []} strategy={verticalListSortingStrategy}>
                {renderCards(NONCLASSE)}
                {(items[NONCLASSE] || []).length === 0 && (
                  <div className="mb-empty">Aucun onglet non classé</div>
                )}
              </SortableContext>
            </Dropzone>
          </div>

          {/* Masqués */}
          <div className="mb-chapter mb-special mb-hidden-zone">
            <div className="mb-chapter-head">
              <span className="mb-chapter-ic"><HiEyeOff /></span>
              <span className="mb-chapter-name static">Masqués</span>
            </div>
            <Dropzone id={MASQUES}>
              <SortableContext items={items[MASQUES] || []} strategy={verticalListSortingStrategy}>
                {renderCards(MASQUES)}
                {(items[MASQUES] || []).length === 0 && (
                  <div className="mb-empty">Glissez ici pour masquer</div>
                )}
              </SortableContext>
            </Dropzone>
          </div>
        </div>

        <DragOverlay>
          {activeId ? (
            <div className="mb-card mb-drag">
              <span className="mb-handle"><HiSelector /></span>
              <div className="mb-card-body">
                <div className="mb-card-label">{byPath.get(activeId)?.label || activeId}</div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default MenuBoard;
