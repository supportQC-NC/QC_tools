// src/screens/admin/AdminInfobullesScreen.jsx
//
// Constructeur de menu ADMIN (organisation GLOBALE de la sidebar + infobulles).
// Écran mince : toute la mécanique drag & drop vit dans <MenuBoard>. Ici on ne
// gère que les données propres à l'admin :
//   - source/persistance de l'organisation globale (useGetMenuLayout / useSaveMenuLayout)
//   - édition des infobulles par onglet (injectée dans chaque carte via renderItemBody)
import React, { useState, useMemo } from "react";
import { HiViewGrid, HiPencil } from "react-icons/hi";
import {
  getMenuCatalog,
  getDefaultLayout,
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
import MenuBoard from "../../components/menu/MenuBoard/MenuBoard";

const AdminInfobullesScreen = () => {
  const { data: layout } = useGetMenuLayoutQuery();
  const { data: hints = {} } = useGetMenuHintsQuery();
  const [saveLayout] = useSaveMenuLayoutMutation();
  const [upsertHint] = useUpsertMenuHintMutation();

  // L'admin voit TOUS les onglets du catalogue.
  const catalog = useMemo(() => getMenuCatalog(), []);

  // Layout de départ : la config en base, sinon la structure par défaut du code.
  // `undefined` tant que la requête charge -> MenuBoard patiente.
  const initialLayout =
    layout === undefined
      ? undefined
      : layout && (layout.chapitres || []).length
        ? layout
        : getDefaultLayout();

  // ── Édition des infobulles ─────────────────────────────────────────────────
  const [hintDrafts, setHintDrafts] = useState({});
  const [hintMsg, setHintMsg] = useState("");

  const effHint = (path) => hints[path]?.hint || DEFAULT_MENU_HINTS[path] || "";
  const hintVal = (path) =>
    hintDrafts[path] !== undefined ? hintDrafts[path] : effHint(path);
  const onHint = (path, v) => setHintDrafts((d) => ({ ...d, [path]: v }));
  const saveHint = async (path) => {
    try {
      await upsertHint({ path, hint: hintVal(path) }).unwrap();
      setHintDrafts((d) => {
        const n = { ...d };
        delete n[path];
        return n;
      });
      setHintMsg("Infobulle enregistrée.");
    } catch {
      setHintMsg("Erreur infobulle.");
    }
  };

  // Corps de carte admin = libellé + éditeur d'infobulle.
  const renderItemBody = (path, cat) => {
    const dirty = hintDrafts[path] !== undefined && hintDrafts[path] !== effHint(path);
    return (
      <>
        <div className="mb-card-label">{cat?.label || path}</div>
        <div className="mb-card-hintrow">
          <input
            className="mb-hint"
            value={hintVal(path)}
            placeholder={DEFAULT_MENU_HINTS[path] || "Infobulle…"}
            maxLength={200}
            onChange={(e) => onHint(path, e.target.value)}
          />
          <button
            className="mb-btn"
            disabled={!dirty}
            onClick={() => saveHint(path)}
            title="Enregistrer l'infobulle"
          >
            <HiPencil />
          </button>
        </div>
      </>
    );
  };

  return (
    <MenuBoard
      title={
        <>
          <HiViewGrid /> Organisation du menu
        </>
      }
      intro={
        <>
          Glissez les onglets pour les ranger dans des chapitres, les masquer, ou les
          laisser « Non classé ». Créez/renommez/ordonnez les chapitres. Éditez
          l'infobulle de chaque onglet. Cliquez <b>Enregistrer</b> — l'organisation
          s'applique à <b>tous les utilisateurs</b>.
        </>
      }
      catalog={catalog}
      initialLayout={initialLayout}
      chapterNoun="chapitre"
      onSave={(nextLayout) => saveLayout(nextLayout).unwrap()}
      saveLabel="Enregistrer l'organisation"
      saveSuccess="Organisation du menu enregistrée pour tous les utilisateurs."
      renderItemBody={renderItemBody}
      statusSlot={hintMsg ? <span className="mb-msg">{hintMsg}</span> : null}
    />
  );
};

export default AdminInfobullesScreen;
