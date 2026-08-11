// src/screens/user/MonDashboardScreen.jsx
//
// « Organiser mon tableau de bord » — l'utilisateur compose son écran d'accueil.
// Même esprit que « Organiser mon menu » : on part de la disposition courante,
// on la manipule localement, on enregistre en un coup.
//
// Deux natures de blocs :
//   - widget  : choisi dans le catalogue renvoyé par le serveur (donc déjà
//               limité aux modules de l'utilisateur) ;
//   - kpi     : tuile chiffrée composée ici (source + mesure + filtres), dont
//               la valeur est prévisualisée en direct.

import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  HiPlus,
  HiTrash,
  HiSelector,
  HiSave,
  HiRefresh,
  HiChartBar,
  HiChartPie,
  HiPresentationChartLine,
  HiViewList,
  HiDuplicate,
  HiViewGrid,
  HiX,
  HiEye,
} from "react-icons/hi";
import {
  useGetDashboardCatalogueQuery,
  useGetMonDashboardQuery,
  useSetMonDashboardMutation,
  useResetMonDashboardMutation,
  useEvaluerKpisQuery,
} from "../../slices/dashboardLayoutApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  ICONES_KPI,
  ICONE_KPI_KEYS,
  COULEURS_KPI,
  TAILLES,
  FORMATS,
  formaterValeur,
} from "../../config/dashboardCatalogue";
import "./MonDashboardScreen.css";

const nouvelId = (prefixe) =>
  `${prefixe}-${Math.random().toString(36).slice(2, 9)}`;

// Champs adressables par un bloc : ceux de sa source, plus ceux de la source
// croisée préfixés « <dataset>. ». Miroir de champsEffectifs() côté serveur.
const champsEffectifs = (datasets, form) => {
  const ds = datasets[form.dataset];
  if (!ds) return [];
  const champs = ds.champs.map((c) => ({ ...c }));
  const dsDroite = form.jointure?.dataset
    ? datasets[form.jointure.dataset]
    : null;
  if (dsDroite) {
    for (const c of dsDroite.champs) {
      champs.push({
        ...c,
        name: `${form.jointure.dataset}.${c.name}`,
        label: `${dsDroite.label} · ${c.label}`,
      });
    }
  }
  return champs;
};

// ─── Ligne triable de la disposition ─────────────────────────────────────────
const Ligne = ({
  bloc,
  widgetsParCle,
  apercu,
  onGrille,
  onSupprimer,
  onEditer,
  onDupliquer,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: bloc.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const estKpi = bloc.type === "kpi";
  const estGraphique = bloc.type === "graphique";
  const estTableau = bloc.type === "tableau";
  const calcule = estKpi || estGraphique || estTableau;
  const widget = widgetsParCle[bloc.source];
  const Icone = estKpi
    ? ICONES_KPI[bloc.icone] || HiChartBar
    : estGraphique
      ? HiChartPie
      : estTableau
        ? HiViewList
        : HiViewGrid;

  return (
    <div ref={setNodeRef} style={style} className="md-ligne">
      <button className="md-poignee" {...attributes} {...listeners} title="Déplacer">
        <HiSelector />
      </button>

      <span
        className="md-ligne-icone"
        style={calcule ? { background: `${bloc.couleur}22`, color: bloc.couleur } : undefined}
      >
        <Icone />
      </span>

      <div className="md-ligne-texte">
        <span className="md-ligne-titre">
          {calcule
            ? bloc.titre || (estGraphique ? "Graphique sans titre" : "Tuile sans titre")
            : widget?.label || bloc.source}
        </span>
        <span className="md-ligne-sous">
          {calcule ? (
            <>
              {bloc.dataset}
              {bloc.jointure?.dataset ? ` × ${bloc.jointure.dataset}` : ""}
              {estTableau ? (
                <> · {bloc.colonnes?.length || 0} colonne(s) · {bloc.limite} lignes</>
              ) : (
                <>
                  {" "}
                  · {bloc.mesure}
                  {bloc.champ ? ` (${bloc.champ})` : ""}
                  {estGraphique ? ` · par ${bloc.dimension}` : ""}
                  {estGraphique && bloc.serie ? ` × ${bloc.serie}` : ""}
                </>
              )}
              {bloc.filtres?.length ? ` · ${bloc.filtres.length} filtre(s)` : ""}
            </>
          ) : (
            widget?.description || "Widget"
          )}
        </span>
      </div>

      {calcule && (
        <span className="md-apercu">
          {apercu?.erreur ? (
            <em title={apercu.erreur}>indisponible</em>
          ) : !apercu ? (
            "…"
          ) : estTableau ? (
            `${Number(apercu.total || 0).toLocaleString("fr-FR")} ligne(s)`
          ) : estGraphique ? (
            `${apercu.groupes ?? 0} groupe(s)`
          ) : (
            formaterValeur(apercu.valeur, bloc.format)
          )}
        </span>
      )}

      {/* Grille : largeur en colonnes (sur 12) et hauteur en unités de 90 px */}
      <label className="md-grille-champ" title="Largeur, en colonnes sur 12">
        L
        <input
          type="number"
          min="1"
          max="12"
          value={bloc.w ?? 4}
          onChange={(e) => onGrille(bloc.id, "w", Number(e.target.value))}
        />
      </label>
      <label className="md-grille-champ" title="Hauteur, en unités de 90 px">
        H
        <input
          type="number"
          min="1"
          max="12"
          value={bloc.h ?? 3}
          onChange={(e) => onGrille(bloc.id, "h", Number(e.target.value))}
        />
      </label>

      {calcule && (
        <button className="md-icone-btn" onClick={() => onEditer(bloc)} title="Modifier">
          <HiChartBar />
        </button>
      )}
      <button
        className="md-icone-btn"
        onClick={() => onDupliquer(bloc)}
        title="Dupliquer ce bloc"
      >
        <HiDuplicate />
      </button>
      <button
        className="md-icone-btn md-danger"
        onClick={() => onSupprimer(bloc.id)}
        title="Retirer"
      >
        <HiTrash />
      </button>
    </div>
  );
};

// ─── Constructeur de bloc calculé (tuile chiffrée OU graphique) ──────────────
// Les deux natures partagent source, mesure, champ et filtres ; le graphique
// ajoute un regroupement, un type de tracé, un tri et une limite.
const ConstructeurKpi = ({
  datasets,
  mesures,
  operateurs,
  typesGraphique,
  tris,
  limites,
  lignesBornes = { min: 5, max: 200 },
  initial,
  natureInitiale = "kpi",
  onValider,
  onFermer,
}) => {
  const clesDatasets = Object.keys(datasets);
  const [form, setForm] = useState(
    () =>
      initial || {
        id: nouvelId(natureInitiale),
        type: natureInitiale,
        taille: natureInitiale === "graphique" ? "moitie" : "tiers",
        titre: "",
        dataset: clesDatasets[0] || "",
        mesure: "count",
        champ: "",
        filtres: [],
        format: "nombre",
        couleur: COULEURS_KPI[0],
        icone: "HiChartBar",
        jointure: null,
        // graphique
        dimension: "",
        serie: "",
        empile: false,
        typeGraphique: "barres",
        limite: natureInitiale === "tableau" ? 25 : 10,
        tri: "valeurDesc",
        // tableau
        colonnes: [],
      },
  );

  const estGraphique = form.type === "graphique";
  const estTableau = form.type === "tableau";

  const ds = datasets[form.dataset];
  const champs = champsEffectifs(datasets, form);
  const champsNumeriques = champs.filter((c) => c.type === "nombre");
  const mesureDef = mesures.find((m) => m.key === form.mesure);
  const besoinChamp = !!mesureDef?.besoinChamp;

  // Le croisement est réservé aux bases DBF (règle appliquée côté serveur) :
  // on ne propose que des sources DBF, et seulement si la source principale
  // en est une.
  const sourcePrincipaleDbf = ds?.origine === "dbf";
  const datasetsCroisables = clesDatasets.filter(
    (c) => c !== form.dataset && datasets[c].origine === "dbf",
  );
  const croisementPossible = sourcePrincipaleDbf && datasetsCroisables.length > 0;
  const champsGauche = ds?.champs || [];
  const champsDroite = form.jointure?.dataset
    ? datasets[form.jointure.dataset]?.champs || []
    : [];

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Changer de source invalide tout ce qui dépendait de l'ancienne.
  const changerDataset = (cle) =>
    setForm((p) => ({
      ...p,
      dataset: cle,
      champ: "",
      dimension: "",
      filtres: [],
      jointure: null,
    }));

  // Activer / désactiver le croisement.
  const changerJointure = (cleDroite) => {
    if (!cleDroite) {
      setForm((p) => ({ ...p, jointure: null, champ: "", dimension: "", filtres: [] }));
      return;
    }
    const dsD = datasets[cleDroite];
    // Pré-remplit avec un champ de même nom des deux côtés s'il existe
    // (cas courant : FOURN dans articles et dans fournisseurs).
    const commun = (ds?.champs || []).find((c) =>
      dsD.champs.some((d) => d.name === c.name),
    );
    setForm((p) => ({
      ...p,
      jointure: {
        dataset: cleDroite,
        champGauche: commun?.name || ds?.champs?.[0]?.name || "",
        champDroit: commun?.name || dsD.champs?.[0]?.name || "",
      },
    }));
  };

  const majJointure = (k, v) =>
    setForm((p) => ({ ...p, jointure: { ...p.jointure, [k]: v } }));

  const ajouterFiltre = () => {
    const premier = champs[0];
    if (!premier) return;
    set("filtres", [
      ...form.filtres,
      { champ: premier.name, operateur: "egal", valeur: "" },
    ]);
  };

  const majFiltre = (i, k, v) =>
    set(
      "filtres",
      form.filtres.map((f, idx) => (idx === i ? { ...f, [k]: v } : f)),
    );

  const retirerFiltre = (i) =>
    set("filtres", form.filtres.filter((_, idx) => idx !== i));

  const typeDuChamp = (nom) => champs.find((c) => c.name === nom)?.type || "texte";

  const basculerColonne = (nom) => {
    const suivant = form.colonnes.includes(nom)
      ? form.colonnes.filter((c) => c !== nom)
      : [...form.colonnes, nom];
    set("colonnes", suivant);
  };

  const valide =
    !!form.dataset &&
    !!form.titre.trim() &&
    (estTableau
      ? form.colonnes.length > 0
      : (!besoinChamp || !!form.champ) && (!estGraphique || !!form.dimension));

  const nomNature = estTableau
    ? "tableau"
    : estGraphique
      ? "graphique"
      : "tuile chiffrée";

  return (
    <div className="md-modale-fond" onClick={onFermer}>
      <div className="md-modale" onClick={(e) => e.stopPropagation()}>
        <header className="md-modale-head">
          <h3>
            {initial ? `Modifier le ${nomNature}` : `Nouveau ${nomNature}`}
          </h3>
          <button className="md-icone-btn" onClick={onFermer}><HiX /></button>
        </header>

        <div className="md-modale-corps">
          <div className="md-champ">
            <label>Titre</label>
            <input
              type="text"
              value={form.titre}
              maxLength={60}
              placeholder="Ex. Valeur du stock déprécié"
              onChange={(e) => set("titre", e.target.value)}
            />
          </div>

          <div className="md-duo">
            <div className="md-champ">
              <label>Source</label>
              <select value={form.dataset} onChange={(e) => changerDataset(e.target.value)}>
                {clesDatasets.map((c) => (
                  <option key={c} value={c}>{datasets[c].label}</option>
                ))}
              </select>
              {ds?.description && <small>{ds.description}</small>}
            </div>

            {!estTableau && (
              <div className="md-champ">
                <label>Mesure</label>
                <select value={form.mesure} onChange={(e) => set("mesure", e.target.value)}>
                  {mesures.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Croisement avec une seconde source — bases DBF uniquement */}
          <div className="md-jointure">
            <div className="md-champ">
              <label>Croiser avec (facultatif)</label>
              {croisementPossible ? (
                <select
                  value={form.jointure?.dataset || ""}
                  onChange={(e) => changerJointure(e.target.value)}
                >
                  <option value="">— aucun croisement —</option>
                  {datasetsCroisables.map((c) => (
                    <option key={c} value={c}>{datasets[c].label}</option>
                  ))}
                </select>
              ) : (
                <small className="md-note">
                  {sourcePrincipaleDbf
                    ? "Aucune autre base DBF accessible à croiser."
                    : `« ${ds?.label} » n'est pas une base DBF : le croisement est réservé aux bases DBF de l'ERP.`}
                </small>
              )}
            </div>

            {croisementPossible && form.jointure?.dataset && (
              <>
                <div className="md-duo">
                  <div className="md-champ">
                    <label>{ds?.label} — champ</label>
                    <select
                      value={form.jointure.champGauche}
                      onChange={(e) => majJointure("champGauche", e.target.value)}
                    >
                      {champsGauche.map((c) => (
                        <option key={c.name} value={c.name}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md-champ">
                    <label>{datasets[form.jointure.dataset].label} — champ</label>
                    <select
                      value={form.jointure.champDroit}
                      onChange={(e) => majJointure("champDroit", e.target.value)}
                    >
                      {champsDroite.map((c) => (
                        <option key={c.name} value={c.name}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <small className="md-note">
                  Les lignes sont rapprochées quand ces deux champs sont égaux.
                  Une ligne sans correspondance est conservée, ses champs
                  rapportés restent vides. Les champs de la source croisée
                  deviennent disponibles ci-dessous.
                </small>
              </>
            )}
          </div>

          {estTableau && (
            <>
              <div className="md-champ">
                <label>
                  Colonnes affichées ({form.colonnes.length} / {limites.colonnesMax ?? 12})
                </label>
                <div className="md-choix-colonnes">
                  {champs.map((c) => {
                    const coche = form.colonnes.includes(c.name);
                    return (
                      <label
                        key={c.name}
                        className={`md-choix-colonne ${coche ? "coche" : ""}`}
                        title={c.name}
                      >
                        <input
                          type="checkbox"
                          checked={coche}
                          onChange={() => basculerColonne(c.name)}
                        />
                        <span>{c.label}</span>
                      </label>
                    );
                  })}
                </div>
                <small>
                  L'ordre des colonnes suit l'ordre dans lequel vous les cochez.
                </small>
              </div>

              <div className="md-duo">
                <div className="md-champ">
                  <label>Trier sur</label>
                  <select value={form.champ} onChange={(e) => set("champ", e.target.value)}>
                    <option value="">— ordre de la base —</option>
                    {champs.map((c) => (
                      <option key={c.name} value={c.name}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="md-champ">
                  <label>Sens</label>
                  <select
                    value={form.tri}
                    onChange={(e) => set("tri", e.target.value)}
                    disabled={!form.champ}
                  >
                    <option value="valeurDesc">Décroissant</option>
                    <option value="valeurAsc">Croissant</option>
                  </select>
                </div>
              </div>

              <div className="md-champ">
                <label>Lignes affichées : {form.limite}</label>
                <input
                  type="range"
                  min={lignesBornes.min}
                  max={lignesBornes.max}
                  step="5"
                  value={form.limite}
                  onChange={(e) => set("limite", Number(e.target.value))}
                />
                <small>
                  Le tri porte sur l'ensemble des lignes filtrées, pas seulement
                  sur celles affichées. Le total réel est rappelé sur le bloc.
                </small>
              </div>
            </>
          )}

          {!estTableau && besoinChamp && (
            <div className="md-champ">
              <label>Champ à mesurer</label>
              <select value={form.champ} onChange={(e) => set("champ", e.target.value)}>
                <option value="">— choisir —</option>
                {champsNumeriques.map((c) => (
                  <option key={c.name} value={c.name}>{c.label}</option>
                ))}
              </select>
              {champsNumeriques.length === 0 && (
                <small className="md-alerte">
                  Cette source n'a aucun champ numérique : seule la mesure
                  « Nombre de lignes » est possible.
                </small>
              )}
            </div>
          )}

          {estGraphique && (
            <>
              <div className="md-champ">
                <label>Regrouper par</label>
                <select
                  value={form.dimension}
                  onChange={(e) => set("dimension", e.target.value)}
                >
                  <option value="">— choisir —</option>
                  {champs.map((c) => (
                    <option key={c.name} value={c.name}>{c.label}</option>
                  ))}
                </select>
                <small>
                  Une barre (ou une part) par valeur distincte de ce champ.
                </small>
              </div>

              <div className="md-duo">
                <div className="md-champ">
                  <label>Ventiler par (facultatif)</label>
                  <select
                    value={form.serie}
                    onChange={(e) => set("serie", e.target.value)}
                    disabled={form.typeGraphique === "camembert"}
                  >
                    <option value="">— série unique —</option>
                    {champs
                      .filter((c) => c.name !== form.dimension)
                      .map((c) => (
                        <option key={c.name} value={c.name}>{c.label}</option>
                      ))}
                  </select>
                  <small>
                    {form.typeGraphique === "camembert"
                      ? "Indisponible sur un camembert."
                      : "Découpe chaque groupe en plusieurs séries."}
                  </small>
                </div>
                <div className="md-champ">
                  <label>Disposition des séries</label>
                  <select
                    value={form.empile ? "empile" : "cote"}
                    onChange={(e) => set("empile", e.target.value === "empile")}
                    disabled={!form.serie}
                  >
                    <option value="cote">Côte à côte</option>
                    <option value="empile">Empilées</option>
                  </select>
                </div>
              </div>

              <div className="md-duo">
                <div className="md-champ">
                  <label>Type de graphique</label>
                  <select
                    value={form.typeGraphique}
                    onChange={(e) => set("typeGraphique", e.target.value)}
                  >
                    {typesGraphique.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="md-champ">
                  <label>Tri</label>
                  <select value={form.tri} onChange={(e) => set("tri", e.target.value)}>
                    {tris.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="md-champ">
                <label>
                  Groupes affichés : {form.limite}
                </label>
                <input
                  type="range"
                  min={limites.min}
                  max={limites.max}
                  value={form.limite}
                  onChange={(e) => set("limite", Number(e.target.value))}
                />
                <small>
                  Au-delà, le reste est cumulé dans « Autres » (pour un nombre
                  ou une somme) — rien n'est masqué en silence.
                </small>
              </div>
            </>
          )}

          <div className="md-filtres">
            <div className="md-filtres-head">
              <label>Filtres</label>
              <button type="button" className="md-mini-btn" onClick={ajouterFiltre}>
                <HiPlus /> Ajouter
              </button>
            </div>
            {form.filtres.length === 0 && (
              <p className="md-note">Aucun filtre : la mesure porte sur toutes les lignes.</p>
            )}
            {form.filtres.map((f, i) => {
              const type = typeDuChamp(f.champ);
              const opsValides = operateurs.filter((o) => o.types.includes(type));
              const sansValeur = f.operateur === "vide" || f.operateur === "nonVide";
              return (
                <div className="md-filtre" key={i}>
                  <select
                    value={f.champ}
                    onChange={(e) => majFiltre(i, "champ", e.target.value)}
                  >
                    {champs.map((c) => (
                      <option key={c.name} value={c.name}>{c.label}</option>
                    ))}
                  </select>
                  <select
                    value={f.operateur}
                    onChange={(e) => majFiltre(i, "operateur", e.target.value)}
                  >
                    {opsValides.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={f.valeur}
                    disabled={sansValeur}
                    placeholder={type === "booleen" ? "oui / non" : "valeur"}
                    onChange={(e) => majFiltre(i, "valeur", e.target.value)}
                  />
                  <button className="md-icone-btn md-danger" onClick={() => retirerFiltre(i)}>
                    <HiTrash />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="md-duo">
            <div className="md-champ">
              <label>Format</label>
              <select value={form.format} onChange={(e) => set("format", e.target.value)}>
                {FORMATS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="md-champ">
              <label>Largeur</label>
              <select value={form.taille} onChange={(e) => set("taille", e.target.value)}>
                {TAILLES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {!estGraphique && (
            <div className="md-champ">
              <label>Icône</label>
              <div className="md-icones">
                {ICONE_KPI_KEYS.map((cle) => {
                  const I = ICONES_KPI[cle];
                  return (
                    <button
                      key={cle}
                      type="button"
                      className={`md-icone-choix ${form.icone === cle ? "actif" : ""}`}
                      onClick={() => set("icone", cle)}
                    >
                      <I />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="md-champ">
            <label>{estGraphique ? "Couleur du tracé" : "Couleur"}</label>
            <div className="md-couleurs">
              {COULEURS_KPI.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`md-couleur ${form.couleur === c ? "actif" : ""}`}
                  style={{ background: c }}
                  onClick={() => set("couleur", c)}
                />
              ))}
            </div>
          </div>
        </div>

        <footer className="md-modale-pied">
          <button className="md-btn md-fantome" onClick={onFermer}>Annuler</button>
          <button
            className="md-btn md-primaire"
            disabled={!valide}
            onClick={() => onValider(form)}
          >
            {initial
              ? "Mettre à jour"
              : estGraphique
                ? "Ajouter le graphique"
                : "Ajouter la tuile"}
          </button>
        </footer>
      </div>
    </div>
  );
};

// ─── Écran ───────────────────────────────────────────────────────────────────
const MonDashboardScreen = () => {
  const dossier = useSelector(selectGlobalDossier) || "";

  const { data: catalogue, isLoading: chargementCat } = useGetDashboardCatalogueQuery();
  const { data: disposition, isLoading: chargementDisp } = useGetMonDashboardQuery();
  const [enregistrer, { isLoading: enregistrement }] = useSetMonDashboardMutation();
  const [reinitialiser] = useResetMonDashboardMutation();

  const [pages, setPages] = useState([]);
  const [iPage, setIPage] = useState(0);
  const [modale, setModale] = useState(null); // null | { initial? }
  const [message, setMessage] = useState(null);
  const [modifie, setModifie] = useState(false);

  // Charge la disposition serveur une fois.
  useEffect(() => {
    if (disposition?.pages) {
      setPages(
        disposition.pages.length
          ? disposition.pages.map((p) => ({
              ...p,
              blocs: p.blocs.map((b) => ({ ...b })),
            }))
          : [{ id: "page-1", nom: "Mon tableau", blocs: [] }],
      );
      setIPage(0);
      setModifie(false);
    }
  }, [disposition]);

  const pageCourante = pages[iPage] || { blocs: [] };
  const blocs = useMemo(() => pageCourante.blocs || [], [pageCourante]);

  const widgets = useMemo(() => catalogue?.widgets || [], [catalogue]);
  const widgetsParCle = useMemo(
    () => Object.fromEntries(widgets.map((w) => [w.key, w])),
    [widgets],
  );
  const datasets = catalogue?.datasets || {};
  const mesures = catalogue?.mesures || [];
  const operateurs = catalogue?.operateurs || [];
  const typesGraphique = catalogue?.typesGraphique || [];
  const tris = catalogue?.tris || [];
  const limites = catalogue?.limites || { min: 3, max: 30 };
  const lignesBornes = catalogue?.lignes || { min: 5, max: 200, colonnesMax: 12 };

  // Aperçu en direct des blocs calculés de la page en cours d'édition.
  const blocsCalcules = useMemo(
    () => blocs.filter((b) => ["kpi", "graphique", "tableau"].includes(b.type)),
    [blocs],
  );
  const { data: evaluation } = useEvaluerKpisQuery(
    { blocs: blocsCalcules, nomDossierDBF: dossier },
    { skip: blocsCalcules.length === 0 },
  );
  const apercuParId = useMemo(() => {
    const m = new Map();
    for (const r of evaluation?.resultats || []) m.set(r.id, r);
    return m;
  }, [evaluation]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Toute modification de blocs porte sur la PAGE COURANTE.
  const majBlocs = (next) => {
    setPages((p) =>
      p.map((page, i) => (i === iPage ? { ...page, blocs: next } : page)),
    );
    setModifie(true);
    setMessage(null);
  };

  const majPages = (next) => {
    setPages(next);
    setModifie(true);
    setMessage(null);
  };

  const ajouterPage = () => {
    const nom = `Page ${pages.length + 1}`;
    majPages([...pages, { id: nouvelId("page"), nom, blocs: [] }]);
    setIPage(pages.length);
  };

  const renommerPage = (nom) =>
    majPages(pages.map((p, i) => (i === iPage ? { ...p, nom } : p)));

  const supprimerPage = () => {
    if (pages.length <= 1) return;
    if (!window.confirm(`Supprimer la page « ${pageCourante.nom} » et ses blocs ?`)) {
      return;
    }
    const suivant = pages.filter((_, i) => i !== iPage);
    majPages(suivant);
    setIPage(Math.max(0, iPage - 1));
  };

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const de = blocs.findIndex((b) => b.id === active.id);
    const vers = blocs.findIndex((b) => b.id === over.id);
    if (de < 0 || vers < 0) return;
    majBlocs(arrayMove(blocs, de, vers));
  };

  const ajouterWidget = (w) => {
    majBlocs([
      ...blocs,
      { id: nouvelId(w.key), type: "widget", source: w.key, taille: w.tailleDefaut },
    ]);
  };

  // Duplique un bloc juste après l'original, avec un identifiant neuf.
  const dupliquer = (bloc) => {
    const copie = {
      ...JSON.parse(JSON.stringify(bloc)),
      id: nouvelId(bloc.type),
      titre: bloc.titre ? `${bloc.titre} (copie)` : bloc.titre,
    };
    const i = blocs.findIndex((b) => b.id === bloc.id);
    const suivant = [...blocs];
    suivant.splice(i + 1, 0, copie);
    majBlocs(suivant);
  };

  const validerKpi = (form) => {
    const existe = blocs.some((b) => b.id === form.id);
    majBlocs(existe ? blocs.map((b) => (b.id === form.id ? form : b)) : [...blocs, form]);
    setModale(null);
  };

  const sauver = async () => {
    setMessage(null);
    try {
      await enregistrer(pages).unwrap();
      setModifie(false);
      setMessage({ ok: true, texte: "Tableau de bord enregistré." });
    } catch (e) {
      setMessage({ ok: false, texte: e?.data?.message || "Enregistrement impossible." });
    }
  };

  const remettreDefaut = async () => {
    setMessage(null);
    try {
      await reinitialiser().unwrap();
      setModifie(false);
      setMessage({ ok: true, texte: "Disposition par défaut rétablie." });
    } catch (e) {
      setMessage({ ok: false, texte: e?.data?.message || "Réinitialisation impossible." });
    }
  };

  const dejaPose = new Set(blocs.filter((b) => b.type === "widget").map((b) => b.source));

  if (chargementCat || chargementDisp) {
    return <div className="md-page"><p className="md-note">Chargement…</p></div>;
  }

  return (
    <div className="md-page">
      <header className="md-head">
        <div>
          <h1><HiViewGrid /> Organiser mon tableau de bord</h1>
          <p className="md-sous">
            Glissez pour réordonner, réglez la largeur de chaque bloc, ajoutez
            vos propres tuiles chiffrées. Vous ne voyez ici que ce à quoi vos
            modules vous donnent accès.
          </p>
        </div>
        <div className="md-head-actions">
          <Link to="/" className="md-btn md-fantome"><HiEye /> Voir le tableau</Link>
          <button className="md-btn md-fantome" onClick={remettreDefaut}>
            <HiRefresh /> Par défaut
          </button>
          <button
            className="md-btn md-primaire"
            onClick={sauver}
            disabled={enregistrement || !modifie}
          >
            <HiSave /> {enregistrement ? "…" : "Enregistrer"}
          </button>
        </div>
      </header>

      {message && (
        <div className={`md-message ${message.ok ? "ok" : "ko"}`}>{message.texte}</div>
      )}
      {modifie && (
        <div className="md-message avertir">
          Modifications non enregistrées.
        </div>
      )}

      {/* Pages du tableau de bord */}
      <div className="md-pages">
        <div className="md-pages-onglets">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`md-page-onglet ${i === iPage ? "actif" : ""}`}
              onClick={() => setIPage(i)}
            >
              {p.nom}
              <span className="md-page-nb">{p.blocs.length}</span>
            </button>
          ))}
          <button
            type="button"
            className="md-page-ajout"
            onClick={ajouterPage}
            disabled={pages.length >= 10}
            title={pages.length >= 10 ? "10 pages au maximum" : "Ajouter une page"}
          >
            <HiPlus />
          </button>
        </div>

        <div className="md-page-outils">
          <input
            type="text"
            className="md-page-nom"
            value={pageCourante.nom || ""}
            maxLength={40}
            onChange={(e) => renommerPage(e.target.value)}
            title="Renommer la page courante"
          />
          <button
            type="button"
            className="md-icone-btn md-danger"
            onClick={supprimerPage}
            disabled={pages.length <= 1}
            title={
              pages.length <= 1
                ? "Il doit rester au moins une page"
                : "Supprimer cette page"
            }
          >
            <HiTrash />
          </button>
        </div>
      </div>

      <div className="md-colonnes">
        {/* Disposition courante */}
        <section className="md-panneau">
          <h2>
            {pageCourante.nom || "Page"} — {blocs.length} bloc(s)
          </h2>
          {blocs.length === 0 ? (
            <p className="md-note">
              Aucun bloc. Ajoutez un widget depuis la colonne de droite ou créez
              une tuile chiffrée.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={blocs.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                {blocs.map((b) => (
                  <Ligne
                    key={b.id}
                    bloc={b}
                    widgetsParCle={widgetsParCle}
                    apercu={apercuParId.get(b.id)}
                    onGrille={(id, cle, valeur) =>
                      majBlocs(
                        blocs.map((x) =>
                          x.id === id
                            ? { ...x, [cle]: Math.min(12, Math.max(1, valeur || 1)) }
                            : x,
                        ),
                      )
                    }
                    onSupprimer={(id) => majBlocs(blocs.filter((x) => x.id !== id))}
                    onEditer={(bloc) => setModale({ initial: { ...bloc } })}
                    onDupliquer={dupliquer}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </section>

        {/* Catalogue */}
        <aside className="md-panneau">
          <h2>Widgets disponibles</h2>
          {widgets.length === 0 ? (
            <p className="md-note">Aucun widget accessible avec vos modules.</p>
          ) : (
            <div className="md-catalogue">
              {widgets.map((w) => (
                <button
                  key={w.key}
                  className="md-cat-item"
                  onClick={() => ajouterWidget(w)}
                  title={w.description}
                >
                  <span className="md-cat-label">{w.label}</span>
                  <span className="md-cat-desc">{w.description}</span>
                  <span className="md-cat-plus">
                    <HiPlus /> {dejaPose.has(w.key) ? "Ajouter à nouveau" : "Ajouter"}
                  </span>
                </button>
              ))}
            </div>
          )}

          <h2 className="md-h2-espace">Sur mesure</h2>
          {Object.keys(datasets).length === 0 ? (
            <p className="md-note">Aucune source de données accessible.</p>
          ) : (
            <div className="md-sur-mesure">
              <button
                className="md-btn md-primaire md-plein"
                onClick={() => setModale({ nature: "kpi" })}
              >
                <HiChartBar /> Composer une tuile
              </button>
              <button
                className="md-btn md-primaire md-plein"
                onClick={() => setModale({ nature: "graphique" })}
              >
                <HiPresentationChartLine /> Composer un graphique
              </button>
              <button
                className="md-btn md-primaire md-plein"
                onClick={() => setModale({ nature: "tableau" })}
              >
                <HiViewList /> Composer un tableau
              </button>
            </div>
          )}
        </aside>
      </div>

      {modale && (
        <ConstructeurKpi
          datasets={datasets}
          mesures={mesures}
          operateurs={operateurs}
          typesGraphique={typesGraphique}
          tris={tris}
          limites={{ ...limites, colonnesMax: lignesBornes.colonnesMax }}
          lignesBornes={lignesBornes}
          initial={modale.initial}
          natureInitiale={modale.nature || "kpi"}
          onValider={validerKpi}
          onFermer={() => setModale(null)}
        />
      )}
    </div>
  );
};

export default MonDashboardScreen;
