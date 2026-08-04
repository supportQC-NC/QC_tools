import React, { useState, useEffect, useMemo } from "react";
import {
  HiViewGrid,
  HiPlus,
  HiTrash,
  HiChevronUp,
  HiChevronDown,
  HiEyeOff,
  HiSelector,
  HiPencil,
  HiSave,
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
  CHAPTER_ICONS,
  chapterIcon,
  DEFAULT_MENU_HINTS,
} from "../../config/menuConfig";
import {
  useGetMenuLayoutQuery,
  useSaveMenuLayoutMutation,
} from "../../slices/menuLayoutApiSlice";
import {
  useGetMenuHintsQuery,
  useUpsertMenuHintMutation,
} from "../../slices/menuHintsApiSlice";
import "./AdminInfobullesScreen.css";

const NONCLASSE = "nonclasse";
const MASQUES = "masques";

// ── Carte d'onglet déplaçable ────────────────────────────────────────────────
const ItemCard = ({ path, label, hintValue, defaultHint, onHint, onSaveHint, dirty }) => {
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
        <div className="mb-card-hintrow">
          <input
            className="mb-hint"
            value={hintValue}
            placeholder={defaultHint || "Infobulle…"}
            maxLength={200}
            onChange={(e) => onHint(path, e.target.value)}
          />
          <button
            className="mb-btn"
            disabled={!dirty}
            onClick={() => onSaveHint(path)}
            title="Enregistrer l'infobulle"
          >
            <HiPencil />
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Conteneur droppable (chapitre / non classé / masqués) ────────────────────
const Container = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`mb-dropzone ${isOver ? "over" : ""}`}>
      {children}
    </div>
  );
};

const AdminMenuBuilderScreen = () => {
  const { data: layout } = useGetMenuLayoutQuery();
  const { data: hints = {} } = useGetMenuHintsQuery();
  const [saveLayout, { isLoading: savingLayout }] = useSaveMenuLayoutMutation();
  const [upsertHint] = useUpsertMenuHintMutation();

  const catalog = useMemo(() => getMenuCatalog(), []);
  const byPath = useMemo(() => new Map(catalog.map((c) => [c.path, c])), [catalog]);

  // État d'édition.
  const [chapMeta, setChapMeta] = useState([]); // [{key,label,icon}]
  const [items, setItems] = useState({}); // { containerId: [path] }
  const [hintDrafts, setHintDrafts] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Initialisation depuis la base (ou structure par défaut).
  useEffect(() => {
    if (ready) return;
    if (layout === undefined) return; // pas encore chargé
    const lay =
      layout && Array.isArray(layout.chapitres) && layout.chapitres.length
        ? layout
        : getDefaultLayout();
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
    // Reste du catalogue -> Non classé.
    catalog.forEach((c) => {
      if (!placed.has(c.path)) map[NONCLASSE].push(c.path);
    });
    setChapMeta(meta);
    setItems(map);
    setReady(true);
  }, [layout, ready, byPath, catalog]);

  // Localise le conteneur d'un id (path) ou renvoie l'id si c'est un conteneur.
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

  // Chapitres.
  const addChapter = () => {
    const key = `chap_${Date.now()}`;
    setChapMeta((m) => [...m, { key, label: "Nouveau chapitre", icon: "folder" }]);
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

  // Infobulles.
  const effHint = (path) => hints[path]?.hint || DEFAULT_MENU_HINTS[path] || "";
  const hintVal = (path) => (hintDrafts[path] !== undefined ? hintDrafts[path] : effHint(path));
  const onHint = (path, v) => setHintDrafts((d) => ({ ...d, [path]: v }));
  const saveHint = async (path) => {
    try {
      await upsertHint({ path, hint: hintVal(path) }).unwrap();
      setHintDrafts((d) => {
        const n = { ...d };
        delete n[path];
        return n;
      });
      setMsg("Infobulle enregistrée.");
    } catch {
      setMsg("Erreur infobulle.");
    }
  };

  // Enregistrement de l'organisation.
  const save = async () => {
    const chapitres = chapMeta.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon,
      items: items[`c:${c.key}`] || [],
    }));
    try {
      await saveLayout({ chapitres, masques: items[MASQUES] || [] }).unwrap();
      setMsg("Organisation du menu enregistrée pour tous les utilisateurs.");
    } catch {
      setMsg("Erreur lors de l'enregistrement.");
    }
  };

  const renderItems = (containerId) =>
    (items[containerId] || []).map((path) => (
      <ItemCard
        key={path}
        path={path}
        label={byPath.get(path)?.label}
        hintValue={hintVal(path)}
        defaultHint={DEFAULT_MENU_HINTS[path]}
        onHint={onHint}
        onSaveHint={saveHint}
        dirty={hintDrafts[path] !== undefined && hintDrafts[path] !== effHint(path)}
      />
    ));

  if (!ready) {
    return (
      <div className="ib-wrap">
        <h1>
          <HiViewGrid /> Organisation du menu
        </h1>
        <p className="ib-intro">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="ib-wrap">
      <h1>
        <HiViewGrid /> Organisation du menu
      </h1>
      <p className="ib-intro">
        Glissez les onglets pour les ranger dans des chapitres, les masquer, ou les
        laisser « Non classé ». Créez/renommez/ordonnez les chapitres. Éditez
        l'infobulle de chaque onglet. Cliquez <b>Enregistrer</b> — l'organisation
        s'applique à <b>tous les utilisateurs</b>.
      </p>
      <div className="mb-toolbar">
        <button className="ib-btn" onClick={addChapter}>
          <HiPlus /> Ajouter un chapitre
        </button>
        <button className="ib-btn primary" onClick={save} disabled={savingLayout}>
          <HiSave /> {savingLayout ? "Enregistrement…" : "Enregistrer l'organisation"}
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
          {/* Chapitres */}
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

export default AdminMenuBuilderScreen;
