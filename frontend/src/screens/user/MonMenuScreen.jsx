// src/screens/user/MonMenuScreen.jsx
//
// Organisation PERSONNELLE de la sidebar par l'utilisateur. Écran mince :
// la mécanique drag & drop vit dans <MenuBoard>. Ici on ne gère que :
//   - le catalogue restreint aux onglets AUTORISÉS pour l'utilisateur
//   - la source/persistance perso (useGetMyMenuLayout / useSaveMyMenuLayout / reset)
//   - le point de départ « copie du menu par défaut » à la première ouverture
// Pas d'édition d'infobulle ici (elle reste globale, gérée par l'admin).
import React, { useMemo } from "react";
import { useSelector } from "react-redux";
import { HiViewGrid } from "react-icons/hi";
import {
  getMenuCatalog,
  getDefaultLayout,
  catalogItemVisible,
} from "../../config/menuConfig";
import {
  useGetMenuLayoutQuery,
  useGetMyMenuLayoutQuery,
  useSaveMyMenuLayoutMutation,
  useResetMyMenuLayoutMutation,
} from "../../slices/menuLayoutApiSlice";
import MenuBoard from "../../components/menu/MenuBoard/MenuBoard";

const MonMenuScreen = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const { data: myLayout } = useGetMyMenuLayoutQuery();
  const { data: defaultLayout } = useGetMenuLayoutQuery();
  const [saveMine] = useSaveMyMenuLayoutMutation();
  const [resetMine] = useResetMyMenuLayoutMutation();

  // Catalogue restreint aux onglets autorisés (mêmes règles que la sidebar) :
  // l'utilisateur n'organise que ce à quoi il a accès.
  const catalog = useMemo(
    () => getMenuCatalog().filter((c) => catalogItemVisible(userInfo, c)),
    [userInfo],
  );

  // Menu par défaut effectif = config admin en base, sinon structure du code.
  // Sert de point de départ (copie) ET de cible après « Revenir au défaut ».
  const baseDefault =
    defaultLayout && (defaultLayout.chapitres || []).length
      ? defaultLayout
      : getDefaultLayout();

  // Layout de départ : ma config perso si elle existe, sinon copie du défaut.
  // `undefined` tant que l'une des requêtes charge -> MenuBoard patiente.
  const initialLayout =
    myLayout === undefined || defaultLayout === undefined
      ? undefined
      : myLayout && (myLayout.chapitres || []).length
        ? myLayout
        : baseDefault;

  return (
    <MenuBoard
      title={
        <>
          <HiViewGrid /> Organiser mon menu
        </>
      }
      intro={
        <>
          Rangez les onglets dans vos propres <b>dossiers</b>, réordonnez-les ou
          masquez-les. Ces réglages ne concernent que <b>vous</b> et n'affectent pas les
          autres utilisateurs. Cliquez <b>Enregistrer</b> : votre menu s'active
          automatiquement (bouton <b>« Perso »</b> de la sidebar). Vous pouvez repasser
          sur <b>« Défaut »</b> à tout moment sans perdre votre organisation.
        </>
      }
      catalog={catalog}
      initialLayout={initialLayout}
      chapterNoun="dossier"
      onSave={(nextLayout) =>
        saveMine({ ...nextLayout, useCustom: true }).unwrap()
      }
      saveLabel="Enregistrer mon menu"
      saveSuccess="Votre menu personnel a été enregistré et activé (bouton « Perso »)."
      onReset={() => resetMine().unwrap()}
      resetLayout={baseDefault}
      resetLabel="Revenir au menu par défaut"
      resetSuccess="Menu réinitialisé : la sidebar revient à l'organisation par défaut."
    />
  );
};

export default MonMenuScreen;
