// src/components/Admin/ChampsDbfSection.jsx
//
// Droits « champ par champ » sur les bases DBF, pour UN utilisateur.
// L'admin choisit une table, passe en mode « liste » et coche les champs
// autorisés. Les champs proposés sont ceux du DBF RÉEL de la société de
// référence — rien n'est codé en dur.
//
// Enregistrement séparé du reste du formulaire utilisateur : ces droits vivent
// dans Permission.champsDbf et ont leur propre endpoint.

import React, { useEffect, useMemo, useState } from "react";
import {
  HiDatabase,
  HiCheck,
  HiX,
  HiSave,
  HiSearch,
  HiExclamation,
  HiLockClosed,
  HiLockOpen,
} from "react-icons/hi";
import {
  useGetDbfTablesQuery,
  useGetDbfChampsQuery,
  useGetChampsDbfUtilisateurQuery,
  useSetChampsDbfUtilisateurMutation,
} from "../../slices/champsDbfApiSlice";
import "./ChampsDbfSection.css";

const ChampsDbfSection = ({ userId }) => {
  const { data: tablesData } = useGetDbfTablesQuery();
  const { data: configData, isLoading: chargementConfig } =
    useGetChampsDbfUtilisateurQuery(userId, { skip: !userId });
  const [enregistrer, { isLoading: enregistrement }] =
    useSetChampsDbfUtilisateurMutation();

  const tables = useMemo(() => tablesData?.tables || [], [tablesData]);

  const [tableActive, setTableActive] = useState("");
  const [config, setConfig] = useState({}); // { table: { mode, champs:[] } }
  const [recherche, setRecherche] = useState("");
  const [message, setMessage] = useState(null);
  const [modifie, setModifie] = useState(false);

  // Table sélectionnée par défaut : la première du catalogue.
  useEffect(() => {
    if (!tableActive && tables.length > 0) setTableActive(tables[0].key);
  }, [tables, tableActive]);

  // Config serveur -> état local (on ne garde que mode + champs, `masques`
  // étant recalculé côté serveur à chaque enregistrement).
  useEffect(() => {
    if (!configData) return;
    const local = {};
    for (const [table, regle] of Object.entries(configData.champsDbf || {})) {
      local[table] = { mode: regle.mode || "tous", champs: regle.champs || [] };
    }
    setConfig(local);
    setModifie(false);
  }, [configData]);

  const { data: champsData, isFetching: chargementChamps, error: erreurChamps } =
    useGetDbfChampsQuery({ table: tableActive }, { skip: !tableActive });

  const champs = useMemo(() => champsData?.champs || [], [champsData]);
  const champsFiltres = useMemo(() => {
    const q = recherche.trim().toUpperCase();
    return q ? champs.filter((c) => c.name.toUpperCase().includes(q)) : champs;
  }, [champs, recherche]);

  const tableCourante = useMemo(
    () => tables.find((t) => t.key === tableActive),
    [tables, tableActive],
  );
  const regle = useMemo(
    () => config[tableActive] || { mode: "tous", champs: [] },
    [config, tableActive],
  );
  const autorises = useMemo(
    () => new Set((regle.champs || []).map((c) => c.toUpperCase())),
    [regle],
  );

  const majRegle = (patch) => {
    setConfig((p) => ({
      ...p,
      [tableActive]: { ...(p[tableActive] || { mode: "tous", champs: [] }), ...patch },
    }));
    setModifie(true);
    setMessage(null);
  };

  const basculerChamp = (nom) => {
    const cle = nom.toUpperCase();
    const suivant = new Set(autorises);
    if (suivant.has(cle)) suivant.delete(cle);
    else suivant.add(cle);
    majRegle({ champs: [...suivant] });
  };

  const toutCocher = () =>
    majRegle({ champs: champs.map((c) => c.name.toUpperCase()) });
  const toutDecocher = () => majRegle({ champs: [] });

  const sauver = async () => {
    setMessage(null);
    try {
      // On n'envoie que les tables réellement passées en mode « liste ».
      const aEnvoyer = {};
      for (const [table, r] of Object.entries(config)) {
        if (r.mode === "liste") aEnvoyer[table] = { mode: "liste", champs: r.champs };
      }
      const rep = await enregistrer({ userId, champsDbf: aEnvoyer }).unwrap();
      setModifie(false);
      setMessage({ ok: true, texte: rep.message });
    } catch (e) {
      setMessage({
        ok: false,
        texte: e?.data?.message || "Enregistrement impossible.",
      });
    }
  };

  const tablesRestreintes = Object.entries(config).filter(
    ([, r]) => r.mode === "liste",
  ).length;

  if (!userId) {
    return (
      <p className="cdbf-note">
        Enregistrez d'abord l'utilisateur pour définir ses droits par champ.
      </p>
    );
  }

  return (
    <div className="cdbf">
      <header className="cdbf-head">
        <div>
          <h3>
            <HiDatabase /> Champs visibles par base DBF
          </h3>
          <p className="cdbf-sous">
            Par défaut, cet utilisateur voit <strong>tous</strong> les champs.
            Passez une base en « liste restreinte » pour n'autoriser que les
            champs cochés. Ces droits sont les <strong>mêmes pour toutes les
            sociétés</strong> auxquelles l'utilisateur a accès ; sans accès à
            une société, il n'en voit aucune donnée de toute façon. Le filtrage
            s'applique à toutes les réponses de l'API et aux exports, pas
            seulement à l'écran.
          </p>
        </div>
        <div className="cdbf-head-actions">
          <button
            type="button"
            className="cdbf-btn cdbf-primaire"
            onClick={sauver}
            disabled={enregistrement || !modifie}
          >
            <HiSave /> {enregistrement ? "…" : "Enregistrer les droits"}
          </button>
        </div>
      </header>

      {message && (
        <div className={`cdbf-message ${message.ok ? "ok" : "ko"}`}>
          {message.texte}
        </div>
      )}
      {modifie && (
        <div className="cdbf-message avertir">
          Droits par champ non enregistrés.
        </div>
      )}
      {tablesRestreintes > 0 && (
        <div className="cdbf-message info">
          <HiLockClosed /> {tablesRestreintes} table(s) restreinte(s) pour cet
          utilisateur.
        </div>
      )}

      <div className="cdbf-corps">
        <nav className="cdbf-tables">
          {tables.map((t) => {
            const r = config[t.key];
            const restreinte = r?.mode === "liste";
            return (
              <button
                key={t.key}
                type="button"
                className={`cdbf-table ${tableActive === t.key ? "actif" : ""}`}
                onClick={() => {
                  setTableActive(t.key);
                  setRecherche("");
                }}
                title={t.description}
              >
                <span className="cdbf-table-texte">
                  <span className="cdbf-table-label">{t.label}</span>
                  <span className="cdbf-table-desc">{t.description}</span>
                </span>
                <span className={`cdbf-badge ${restreinte ? "restreint" : ""}`}>
                  {restreinte ? (
                    <>
                      <HiLockClosed /> {r.champs?.length || 0}
                    </>
                  ) : (
                    <>
                      <HiLockOpen /> tous
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </nav>

        <section className="cdbf-panneau">
          {chargementConfig ? (
            <p className="cdbf-note">Chargement…</p>
          ) : (
            <>
              <div className="cdbf-modes">
                <label>
                  <input
                    type="radio"
                    name={`mode-${tableActive}`}
                    checked={regle.mode !== "liste"}
                    onChange={() => majRegle({ mode: "tous" })}
                  />
                  <span>Tous les champs</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name={`mode-${tableActive}`}
                    checked={regle.mode === "liste"}
                    onChange={() => majRegle({ mode: "liste" })}
                  />
                  <span>Liste restreinte</span>
                </label>
              </div>

              {regle.mode !== "liste" ? (
                <p className="cdbf-note">
                  Aucune restriction sur {tableCourante?.label || "cette base"} :
                  tous ses champs sont visibles.
                </p>
              ) : erreurChamps ? (
                <p className="cdbf-alerte">
                  <HiExclamation />{" "}
                  {erreurChamps?.data?.message ||
                    "Structure illisible : fichier absent des sociétés actives."}
                </p>
              ) : chargementChamps ? (
                <p className="cdbf-note">Lecture de la structure DBF…</p>
              ) : (
                <>
                  <div className="cdbf-barre">
                    <span className="cdbf-recherche">
                      <HiSearch />
                      <input
                        type="text"
                        placeholder="Filtrer les champs…"
                        value={recherche}
                        onChange={(e) => setRecherche(e.target.value)}
                      />
                    </span>
                    <span className="cdbf-compte">
                      {autorises.size} / {champs.length} autorisés
                    </span>
                    <button type="button" className="cdbf-mini" onClick={toutCocher}>
                      <HiCheck /> Tout
                    </button>
                    <button type="button" className="cdbf-mini" onClick={toutDecocher}>
                      <HiX /> Aucun
                    </button>
                  </div>

                  <div className="cdbf-champs">
                    {champsFiltres.map((c) => {
                      const coche = autorises.has(c.name.toUpperCase());
                      return (
                        <label
                          key={c.name}
                          className={`cdbf-champ ${coche ? "coche" : ""}`}
                          title={`${c.type} (${c.size})`}
                        >
                          <input
                            type="checkbox"
                            checked={coche}
                            onChange={() => basculerChamp(c.name)}
                          />
                          <span className="cdbf-champ-nom">{c.name}</span>
                          <span className="cdbf-champ-type">{c.type}</span>
                        </label>
                      );
                    })}
                    {champsFiltres.length === 0 && (
                      <p className="cdbf-note">Aucun champ ne correspond.</p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default ChampsDbfSection;
