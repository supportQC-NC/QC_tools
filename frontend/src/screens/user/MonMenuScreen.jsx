// src/screens/user/MonMenuScreen.jsx
//
// Organisation PERSONNELLE de la sidebar par l'utilisateur : mêmes gestes que le
// constructeur admin (glisser/ranger dans des dossiers, créer/renommer, masquer),
// mais sauvegardé pour lui seul (/api/menu-layout/me) et sans édition des
// infobulles (qui restent globales, gérées par l'admin).
// À la première ouverture, la config perso démarre en COPIE du menu par défaut.
import React, { useState, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import {
  HiViewGrid,
  HiPlus,
  HiTrash,
  HiChevronUp,
  HiChevronDown,
  HiEyeOff,
  HiSelector,
  HiSave,
  HiRefresh,
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
import {
  getMenuCatalog,
  getDefaultLayout,
  catalogItemVisible,
  CHAPTER_ICONS,
  chapterIcon,
} from "../../config/menuConfig";
import {
  useGetMenuLayoutQuery,
  useGetMyMenuLayoutQuery,
  useSaveMyMenuLayoutMutation,
  useResetMyMenuLayoutMutation,
} from "../../slices/menuLayoutApiSlice";
// Réutilise les styles du constructeur admin (classes .ib-* / .mb-* globales).
import "../admin/AdminInfobullesScreen.css";

const NONCLASSE = "nonclasse";
const MASQUES = "masques";

// ── Carte d'onglet déplaçable (sans infobulle) ───────────────────────────────
const ItemCard = ({ path, label }) => {
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
      <div className="mb-card-body">
        <div className="mb-card-label">{label || path}</div>
      </div>
    </div>
  );
};

// ── Conteneur droppable ──────────────────────────────────────────────────────
const Container = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`mb-dropzone ${isOver ? "over" : ""}`}>
      {children}
    </div>
  );
};

const MonMenuScreen = () => {
  const { data: myLayout } = useGetMyMenuLayoutQuery();
  const { data: defaultLayout } = useGetMenuLayoutQuery();
  const [saveMine, { isLoading: saving }] = useSaveMyMenuLayoutMutation();
  const [resetMine, { isLoading: resetting }] = useResetMyMenuLayoutMutation();

  const { userInfo } = useSelector((state) => state.auth);

  // Catalogue restreint aux onglets AUTORISÉS pour cet utilisateur (mêmes règles
  // que la sidebar). Il ne peut donc organiser que ce à quoi il a accès.
  const catalog = useMemo(
    () => getMenuCatalog().filter((c) => catalogItemVisible(userInfo, c)),
    [userInfo],
  );
  const byPath = useMemo(() => new Map(catalog.map((c) => [c.path, c])), [catalog]);

  const [chapMeta, setChapMeta] = useState([]); // [{key,label,icon}]
  const [items, setItems] = useState({}); // { containerId: [path] }
  const [activeId, setActiveId] = useState(null);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Construit l'état d'édition à partir d'un layout { chapitres, masques }.
  const hydrate = (lay) => {
    const meta = [];
    const map = { [NONCLASSE]: [], [MASQUES]: [] };
    const placed = new Set();
    for (const ch of lay.chapitres || []) {
      const key = ch.key || `chap_${meta.length}`;
      meta.push({ key, label: ch.label || "Sans nom", icon: ch.icon || "folder" });
      map[`c:${key}`] = [];
      for (const p of ch.items || []) {
        if (byPath.has(p) && !placed.has(p)) {
          map[`c:${key}`].push(p);
          placed.add(p);
        }
      }
    }
    (lay.masques || []).forEach((p) => {
      if (byPath.has(p) && !placed.has(p)) {
        map[MASQUES].push(p);
        placed.add(p);
      }
    });
    catalog.forEach((c) => {
      if (!placed.has(c.path)) map[NONCLASSE].push(c.path);
    });
    setChapMeta(meta);
    setItems(map);
  };

  // Initialisation : ma config perso si elle existe, sinon COPIE du défaut
  // (config admin en base, ou repli sur la structure du code).
  useEffect(() => {
    if (ready) return;
    if (myLayout === undefined || defaultLayout === undefined) return; // pas chargé
    const base =
      defaultLayout && (defaultLayout.chapitres || []).length
        ? defaultLayout
        : getDefaultLayout();
    const source =
      myLayout && (myLayout.chapitres || []).length ? myLayout : base;
    hydrate(source);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLayout, defaultLayout, ready]);

  const containerOf = (state, id) => {
    if (id in state) return id;
    return Object.keys(state).find((k) => state[k].includes(id));
  };

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

  // Chapitres (dossiers).
  const addChapter = () => {
    const key = `chap_${Date.now()}`;
    setChapMeta((m) => [...m, { key, label: "Nouveau dossier", icon: "folder" }]);
    setItems((it) => ({ ...it, [`c:${key}`]: [] }));
  };
  const renameChapter = (key, label) =>
    setChapMeta((m) => m.map((c) => (c.key === key ? { ...c, label } : c)));
  const setChapterIcon = (key, icon) =>
    setChapMeta((m) => m.map((c) => (c.key === key ? { ...c, icon } : c)));
  const moveChapter = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= chapMeta.length) return;
    setChapMeta((m) => arrayMove(m, index, j));
  };
  const deleteChapter = (key) => {
    const cid = `c:${key}`;
    setItems((it) => {
      const moved = it[cid] || [];
      const next = { ...it, [NONCLASSE]: [...it[NONCLASSE], ...moved] };
      delete next[cid];
      return next;
    });
    setChapMeta((m) => m.filter((c) => c.key !== key));
  };

  // Enregistrement (active automatiquement la config perso côté serveur).
  const save = async () => {
    const chapitres = chapMeta.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon,
      items: items[`c:${c.key}`] || [],
    }));
    try {
      await saveMine({ chapitres, masques: items[MASQUES] || [], useCustom: true }).unwrap();
      setMsg("Votre menu personnel a été enregistré et activé (bouton « Perso »).");
    } catch {
      setMsg("Erreur lors de l'enregistrement.");
    }
  };

  // Réinitialisation : supprime la config perso -> retour au menu par défaut.
  const reset = async () => {
    try {
      await resetMine().unwrap();
      const base =
        defaultLayout && (defaultLayout.chapitres || []).length
          ? defaultLayout
          : getDefaultLayout();
      hydrate(base);
      setMsg("Menu réinitialisé : la sidebar revient à l'organisation par défaut.");
    } catch {
      setMsg("Erreur lors de la réinitialisation.");
    }
  };

  const renderItems = (containerId) =>
    (items[containerId] || []).map((path) => (
      <ItemCard key={path} path={path} label={byPath.get(path)?.label} />
    ));

  if (!ready) {
    return (
      <div className="ib-wrap">
        <h1>
          <HiViewGrid /> Organiser mon menu
        </h1>
        <p className="ib-intro">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="ib-wrap">
      <h1>
        <HiViewGrid /> Organiser mon menu
      </h1>
      <p className="ib-intro">
        Rangez les onglets dans vos propres <b>dossiers</b>, réordonnez-les ou
        masquez-les. Ces réglages ne concernent que <b>vous</b> et n'affectent pas les
        autres utilisateurs. Cliquez <b>Enregistrer</b> : votre menu s'active
        automatiquement (bouton <b>« Perso »</b> de la sidebar). Vous pouvez repasser
        sur <b>« Défaut »</b> à tout moment sans perdre votre organisation.
      </p>
      <div className="mb-toolbar">
        <button className="ib-btn" onClick={addChapter}>
          <HiPlus /> Ajouter un dossier
        </button>
        <button className="ib-btn primary" onClick={save} disabled={saving}>
          <HiSave /> {saving ? "Enregistrement…" : "Enregistrer mon menu"}
        </button>
        <button className="ib-btn" onClick={reset} disabled={resetting}>
          <HiRefresh /> {resetting ? "Réinitialisation…" : "Revenir au menu par défaut"}
        </button>
        {msg && <span className="mb-msg">{msg}</span>}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => setActiveId(active.id)}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="mb-grid">
          {/* Dossiers */}
          {chapMeta.map((ch, idx) => {
            const cid = `c:${ch.key}`;
            const IconC = chapterIcon(ch.icon);
            return (
              <div className="mb-chapter" key={ch.key}>
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
                    <button className="mb-btn" disabled={idx === 0} onClick={() => moveChapter(idx, -1)} title="Monter">
                      <HiChevronUp />
                    </button>
                    <button className="mb-btn" disabled={idx === chapMeta.length - 1} onClick={() => moveChapter(idx, 1)} title="Descendre">
                      <HiChevronDown />
                    </button>
                    <button className="mb-btn danger" onClick={() => deleteChapter(ch.key)} title="Supprimer (les onglets repassent en Non classé)">
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
                <Container id={cid}>
                  <SortableContext items={items[cid] || []} strategy={verticalListSortingStrategy}>
                    {renderItems(cid)}
                    {(items[cid] || []).length === 0 && (
                      <div className="mb-empty">Glissez des onglets ici</div>
                    )}
                  </SortableContext>
                </Container>
              </div>
            );
          })}

          {/* Non classé */}
          <div className="mb-chapter mb-special">
            <div className="mb-chapter-head">
              <span className="mb-chapter-ic"><HiViewGrid /></span>
              <span className="mb-chapter-name static">Non classé</span>
            </div>
            <Container id={NONCLASSE}>
              <SortableContext items={items[NONCLASSE] || []} strategy={verticalListSortingStrategy}>
                {renderItems(NONCLASSE)}
                {(items[NONCLASSE] || []).length === 0 && (
                  <div className="mb-empty">Aucun onglet non classé</div>
                )}
              </SortableContext>
            </Container>
          </div>

          {/* Masqués */}
          <div className="mb-chapter mb-special mb-hidden-zone">
            <div className="mb-chapter-head">
              <span className="mb-chapter-ic"><HiEyeOff /></span>
              <span className="mb-chapter-name static">Masqués</span>
            </div>
            <Container id={MASQUES}>
              <SortableContext items={items[MASQUES] || []} strategy={verticalListSortingStrategy}>
                {renderItems(MASQUES)}
                {(items[MASQUES] || []).length === 0 && (
                  <div className="mb-empty">Glissez ici pour masquer</div>
                )}
              </SortableContext>
            </Container>
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

export default MonMenuScreen;
