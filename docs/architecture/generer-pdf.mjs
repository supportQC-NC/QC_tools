// Generateur de documentation imprimable A3 paysage.
//   source : les .md d'architecture (texte + blocs mermaid)
//   sortie : un PDF par document, une page A3 par diagramme,
//            page de garde, sommaire pagine, en-tetes et pieds de page.
//
// Rendu : Chrome installe sur le poste, pilote par puppeteer-core.
// Les modules ES de mermaid sont bloques en file:// (CORS) -> on sert
// le dossier de travail par un petit serveur HTTP local.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Ce script vit dans le depot, mais ses dependances de rendu (puppeteer-core,
// mermaid, marked) sont installees ailleurs — on ne pollue pas le package.json
// du projet avec un outillage de documentation. Or un import ESM se resout
// depuis le FICHIER, pas depuis le dossier courant : on resout donc a la main
// depuis le repertoire d'ou la commande est lancee.
let puppeteer;
let marked;
try {
  ({ default: puppeteer } = await import('puppeteer-core'));
  ({ marked } = await import('marked'));
} catch {
  const exiger = createRequire(pathToFileURL(process.cwd() + '/_.js'));
  puppeteer = (await import(pathToFileURL(exiger.resolve('puppeteer-core')).href)).default;
  const m = await import(pathToFileURL(exiger.resolve('marked')).href);
  marked = m.marked || (m.default && m.default.marked);
}

// Dossier de travail : celui qui porte node_modules (mermaid y est servi au
// navigateur) et qui recoit les fichiers intermediaires .html / .plan.txt.
const TRAVAIL = process.cwd();
const PROJET = 'C:\\Users\\Support\\Desktop\\outil_en_ligne_qc - dev';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const DOCS = [
  {
    src: path.join(PROJET, 'docs', 'architecture', 'ARCHITECTURE_WEB.md'),
    out: path.join(PROJET, 'Architecture_Application_WEB_A3.pdf'),
    titre: 'Architecture de l\u2019application WEB',
    sous: 'Outil interne B2B multi-soci\u00e9t\u00e9s \u2014 groupe de quincailleries de Nouvelle-Cal\u00e9donie',
    cible: 'Backend Node.js / Express \u00b7 Frontend React (CRA) \u00b7 MongoDB \u00b7 fichiers DBF de l\u2019ERP',
  },
  {
    src: path.join(PROJET, 'docs', 'architecture', 'ARCHITECTURE_MOBILE.md'),
    out: path.join(PROJET, 'Architecture_Application_MOBILE_A3.pdf'),
    titre: 'Architecture de l\u2019application MOBILE',
    sous: 'QcApp \u2014 collecteur de code-barres pour le terrain (d\u00e9p\u00f4t git s\u00e9par\u00e9)',
    cible: 'Expo SDK 54 \u00b7 React Native 0.81 \u00b7 React 19 \u00b7 SQLite locale \u00b7 REST + Socket.IO',
  },
];

const DATE_DOC = '12 novembre 2026';

/* ------------------------------------------------------------------ */
/* 1. Lecture du markdown source -> liste lineaire d'elements          */
/* ------------------------------------------------------------------ */

// Les liens markdown n'ont aucun sens sur du papier : on garde le libelle.
const sansLiens = (md) => md.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

function lireElements(texte) {
  const lignes = texte.split(/\r?\n/);
  const elements = [];
  let tampon = [];
  const vider = () => {
    const t = tampon.join('\n').trim();
    if (t) elements.push({ type: 'md', md: sansLiens(t) });
    tampon = [];
  };

  for (let i = 0; i < lignes.length; i += 1) {
    const L = lignes[i];

    if (L.startsWith('```mermaid')) {
      vider();
      const code = [];
      i += 1;
      while (i < lignes.length && !lignes[i].startsWith('```')) {
        code.push(lignes[i]);
        i += 1;
      }
      elements.push({ type: 'mermaid', code: code.join('\n') });
      continue;
    }
    if (/^#\s+/.test(L)) { vider(); elements.push({ type: 'h1', texte: L.replace(/^#\s+/, '').trim() }); continue; }
    if (/^##\s+/.test(L)) { vider(); elements.push({ type: 'h2', texte: L.replace(/^##\s+/, '').trim() }); continue; }
    if (/^###\s+/.test(L)) { vider(); elements.push({ type: 'h3', texte: L.replace(/^###\s+/, '').trim() }); continue; }
    if (/^---\s*$/.test(L)) { vider(); continue; }

    tampon.push(L);
  }
  vider();
  return elements;
}

/* ------------------------------------------------------------------ */
/* 2. Decoupage en pages A3                                            */
/* ------------------------------------------------------------------ */

const SEUIL_INTRO = 520;   // au-dela, l'intro prend sa propre page
const SEUIL_NOTES = 900;   // au-dela, les notes prennent leur propre page
const SEUIL_TEXTE = 3200;  // au-dela, une page de texte est coupee en deux

function couperTexte(md) {
  if (md.length <= SEUIL_TEXTE) return [md];
  const blocs = md.split(/\n\n+/);
  const moitie = md.length / 2;
  const a = [];
  const b = [];
  let n = 0;
  for (const bloc of blocs) {
    if (n < moitie) { a.push(bloc); n += bloc.length; } else { b.push(bloc); }
  }
  return [a.join('\n\n'), b.join('\n\n')].filter(Boolean);
}

// Le preambule du .md (note sur Mermaid, sommaire, ordres de grandeur) ne va
// pas dans le corps imprime : la page de garde le porte deja.
function corpsUtile(elements) {
  const debut = elements.findIndex((e) => e.type === 'h2' && /^\d+\./.test(e.texte));
  return debut === -1 ? elements : elements.slice(debut);
}

const SEUIL_FUSION = 1300;   // une page de texte plus courte rejoint la precedente

function regrouper(pages) {
  const out = [];
  for (const p of pages) {
    const prec = out[out.length - 1];
    if (p.genre === 'texte' && prec) {
      // texte court juste apres un diagramme sans notes -> devient ses notes
      if (prec.genre === 'diagramme' && !prec.notes && p.md.length <= SEUIL_FUSION) {
        prec.notes = p.md;
        continue;
      }
      // deux pages de texte qui tiennent ensemble -> une seule
      if (prec.genre === 'texte' && prec.md.length + p.md.length <= SEUIL_TEXTE) {
        prec.md += '\n\n' + p.md;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

function paginer(elements) {
  const pages = [];
  let section = null;
  let numSection = 0;
  let titreCourant = null;
  let attente = [];

  const viderTexte = () => {
    if (!attente.length) return;
    const md = attente.join('\n\n');
    attente = [];
    for (const part of couperTexte(md)) {
      pages.push({ genre: 'texte', section, titre: titreCourant, md: part });
    }
  };

  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];

    if (el.type === 'h1') continue;                       // -> page de garde
    if (el.type === 'h2') {
      viderTexte();
      const brut = el.texte.replace(/`/g, '');            // pas de markdown sur papier
      const m = brut.match(/^(\d+)\.\s*(.*)$/);
      if (m) { numSection = Number(m[1]); section = { num: String(numSection), titre: m[2] }; }
      else { section = { num: '\u2022', titre: brut }; }
      titreCourant = null;
      continue;
    }
    if (el.type === 'h3') {
      viderTexte();
      titreCourant = el.texte.replace(/`/g, '');
      continue;
    }
    if (el.type === 'md') { attente.push(el.md); continue; }

    if (el.type === 'mermaid') {
      // ce qui precede le diagramme : intro courte, sinon page a part
      let intro = null;
      if (attente.length) {
        const md = attente.join('\n\n');
        attente = [];
        if (md.length <= SEUIL_INTRO) intro = md;
        else pages.push({ genre: 'texte', section, titre: titreCourant, md });
      }
      // ce qui suit : notes de la meme page, sinon page a part
      const suite = [];
      let j = i + 1;
      while (j < elements.length && elements[j].type === 'md') { suite.push(elements[j].md); j += 1; }
      const apres = suite.join('\n\n');
      let notes = null;
      let notesAPart = null;
      if (apres) {
        if (apres.length <= SEUIL_NOTES) notes = apres; else notesAPart = apres;
      }
      i = j - 1;

      pages.push({
        genre: 'diagramme',
        section,
        titre: titreCourant || (section ? section.titre : ''),
        intro,
        notes,
        code: el.code,
      });
      if (notesAPart) {
        for (const part of couperTexte(notesAPart)) {
          pages.push({ genre: 'texte', section, titre: (titreCourant || '') + ' \u2014 pr\u00e9cisions', md: part });
        }
      }
    }
  }
  viderTexte();
  return regrouper(pages);
}

/* ------------------------------------------------------------------ */
/* 3. Gabarit HTML                                                     */
/* ------------------------------------------------------------------ */

const ech = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const echAttr = (s) => ech(s).replace(/"/g, '&quot;');

function volumetrie(elements) {
  // recupere le premier tableau du document (les ordres de grandeur)
  const t = elements.find((e) => e.type === 'md' && e.md.includes('|---'));
  return t ? marked.parse(t.md) : '';
}

function construireHtml(doc, pages, elements) {
  const NB = pages.length + 2; // garde + sommaire

  const sommaire = [];
  let derniere = null;
  pages.forEach((p, idx) => {
    const noPage = idx + 3;
    const cle = p.section ? p.section.num + '|' + p.section.titre : '?';
    if (cle !== derniere) {
      derniere = cle;
      sommaire.push(
        `<li class="toc-sec"><span class="toc-num">${ech(p.section ? p.section.num : '')}</span>` +
        `<span class="toc-txt">${ech(p.section ? p.section.titre : '')}</span>` +
        `<span class="toc-dots"></span><span class="toc-p">${noPage}</span></li>`
      );
    }
    // on ne repete pas le titre de section quand le diagramme porte le meme
    const repetition = p.section && p.titre && p.titre.trim() === p.section.titre.trim();
    if (p.genre === 'diagramme' && !repetition) {
      sommaire.push(
        `<li class="toc-dia"><span class="toc-txt">${ech(p.titre)}</span>` +
        `<span class="toc-dots"></span><span class="toc-p">${noPage}</span></li>`
      );
    }
  });

  const corps = pages.map((p, idx) => {
    const noPage = idx + 3;
    const entete =
      `<header class="ph"><span class="ph-sec">${p.section ? ech(p.section.num) + ' \u00b7 ' + ech(p.section.titre) : ''}</span>` +
      `<span class="ph-doc">${ech(doc.titre)}</span></header>`;
    const pied = `<footer class="pf"><span>${ech(doc.sous)}</span><span>${noPage} / ${NB}</span></footer>`;

    // le bandeau porte deja le titre de section : on ne le repete pas
    const memeTitre = p.section && p.titre && p.titre.trim() === p.section.titre.trim();

    if (p.genre === 'diagramme') {
      return `<section class="page diag-page">${entete}
  ${memeTitre ? '' : `<h2 class="pt">${ech(p.titre)}</h2>`}
  ${p.intro ? `<div class="md intro">${marked.parse(p.intro)}</div>` : ''}
  <figure class="diag" data-src="${echAttr(p.code)}"><pre class="mermaid">${ech(p.code)}</pre></figure>
  ${p.notes ? `<div class="md notes">${marked.parse(p.notes)}</div>` : ''}
  ${pied}</section>`;
    }
    return `<section class="page texte-page">${entete}
  <h2 class="pt">${ech(p.titre || (p.section ? p.section.titre : ''))}</h2>
  <div class="md colonnes">${marked.parse(p.md)}</div>
  ${pied}</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${ech(doc.titre)}</title>
<style>
  @page { size: 420mm 297mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #11161d; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .page {
    position: relative; width: 420mm; height: 297mm; padding: 13mm 16mm 12mm;
    overflow: hidden; break-after: page; page-break-after: always;
    display: flex; flex-direction: column;
    --ts: 1; --dmax: 198mm;
  }
  .page:last-child { break-after: auto; page-break-after: auto; }

  .ph { display: flex; justify-content: space-between; align-items: baseline;
        border-bottom: 1.6pt solid #1f3b5c; padding-bottom: 2.5mm; margin-bottom: 5mm;
        font-size: 10.5pt; letter-spacing: .02em; flex: 0 0 auto; }
  .ph-sec { font-weight: 700; color: #1f3b5c; text-transform: uppercase; }
  .ph-doc { color: #7b8794; }

  .pf { position: absolute; left: 16mm; right: 16mm; bottom: 6mm;
        display: flex; justify-content: space-between;
        border-top: .6pt solid #cfd6de; padding-top: 2mm;
        font-size: 8.5pt; color: #8a95a1; }

  .pt { margin: 0 0 4mm; font-size: calc(19pt * var(--ts)); line-height: 1.15;
        color: #0d2744; font-weight: 650; flex: 0 0 auto; }

  /* le diagramme occupe TOUTE la place restante de la page.
     mermaid pose un style inline max-width : il faut le neutraliser,
     sinon le dessin reste minuscule au milieu de l'A3. */
  .diag { flex: 1 1 auto; margin: 0; display: flex; align-items: center; justify-content: center;
          min-height: 0; overflow: hidden; }
  .diag svg { max-width: none !important; max-height: none !important;
              width: 100%; height: 100%; display: block; }

  .md { font-size: calc(11pt * var(--ts)); line-height: 1.45; color: #243041; }
  .md.intro { margin: 0 0 4mm; flex: 0 0 auto; }
  .md.notes { margin: 5mm 0 0; flex: 0 0 auto;
              border-left: 2.5pt solid #1f3b5c; background: #f4f7fa;
              padding: 3.5mm 5mm; border-radius: 0 2mm 2mm 0; }
  .md p { margin: 0 0 2.5mm; }
  .md ul, .md ol { margin: 0 0 2.5mm; padding-left: 6mm; }
  .md li { margin: 0 0 1.2mm; }
  .md code { font-family: Consolas, "Courier New", monospace; font-size: .92em;
             background: #eef2f7; padding: .3mm 1.2mm; border-radius: 1mm; }
  .md strong { color: #0d2744; }
  .md blockquote { margin: 0 0 3mm; padding: 2.5mm 4mm; background: #fff8e6;
                   border-left: 2.5pt solid #d79a1e; }
  .md blockquote p:last-child { margin-bottom: 0; }
  .md table { border-collapse: collapse; width: 100%; margin: 0 0 3mm; font-size: .94em; }
  .md th, .md td { border: .5pt solid #c6cfd9; padding: 1.6mm 2.4mm; text-align: left;
                   vertical-align: top; }
  .md th { background: #1f3b5c; color: #fff; font-weight: 650; }
  .md tbody tr:nth-child(even) { background: #f5f8fb; }
  .md h4 { margin: 3mm 0 2mm; font-size: 1.05em; color: #0d2744; }

  .colonnes { column-count: 2; column-gap: 12mm; column-fill: auto; flex: 1 1 auto; min-height: 0; }
  .colonnes table, .colonnes blockquote { break-inside: avoid; }

  /* ---- page de garde ---- */
  .garde { justify-content: space-between; padding: 24mm 26mm 18mm; }
  .garde .marque { font-size: 11pt; letter-spacing: .22em; text-transform: uppercase; color: #7b8794; }
  .garde h1 { margin: 6mm 0 0; font-size: 44pt; line-height: 1.05; color: #0d2744; font-weight: 700; }
  .garde .sous { margin: 5mm 0 0; font-size: 15pt; color: #2d4a6b; max-width: 250mm; }
  .garde .cible { margin: 3mm 0 0; font-size: 11.5pt; color: #6b7684; max-width: 250mm; }
  .garde .regle { height: 2.4mm; background: #1f3b5c; width: 90mm; margin: 9mm 0 0; }
  .garde .bas { display: flex; gap: 14mm; align-items: flex-start; }
  .garde .bloc { flex: 1 1 0; }
  .garde .bloc:first-child { flex: 1.35 1 0; }
  .garde .bloc h3 { margin: 0 0 3mm; font-size: 10.5pt; text-transform: uppercase;
                    letter-spacing: .08em; color: #1f3b5c; border-bottom: .8pt solid #cfd6de;
                    padding-bottom: 1.6mm; }
  .garde .bloc .md { font-size: 10pt; }
  .legende { display: grid; grid-template-columns: auto 1fr; gap: 2mm 3mm; font-size: 10pt; }
  .pastille { width: 7mm; height: 4.4mm; border-radius: 1mm; border: .8pt solid #9aa5b1; }
  .p-rouge { background: #ffd9d9; border-color: #cc3333; }
  .p-jaune { background: #fff2cc; border-color: #cc9933; }
  .p-vert  { background: #d9f2d9; border-color: #339933; }
  .p-rose  { background: #ffe0e8; border-color: #cc6677; }

  /* ---- sommaire ---- */
  .toc ol { list-style: none; margin: 0; padding: 0; column-count: 2; column-gap: 14mm;
            font-size: 11pt; flex: 1 1 auto; }
  .toc li { display: flex; align-items: baseline; gap: 2mm; break-inside: avoid; }
  .toc .toc-sec { margin: 4mm 0 1.5mm; font-weight: 700; color: #0d2744; font-size: 12pt; }
  .toc .toc-sec:first-child { margin-top: 0; }
  .toc .toc-dia { color: #3c4a5c; padding-left: 7mm; }
  .toc .toc-num { min-width: 7mm; color: #1f3b5c; }
  .toc .toc-dots { flex: 1 1 auto; border-bottom: .6pt dotted #b4bec9; margin: 0 1.5mm 1mm; }
  .toc .toc-p { font-variant-numeric: tabular-nums; color: #6b7684; }
</style>
</head><body>

<section class="page garde">
  <div>
    <div class="marque">Documentation technique \u00b7 ${ech(DATE_DOC)}</div>
    <h1>${ech(doc.titre)}</h1>
    <div class="sous">${ech(doc.sous)}</div>
    <div class="cible">${ech(doc.cible)}</div>
    <div class="regle"></div>
  </div>
  <div class="bas">
    <div class="bloc">
      <h3>Ordres de grandeur</h3>
      <div class="md">${volumetrie(elements)}</div>
    </div>
    <div class="bloc">
      <h3>Comment lire ce document</h3>
      <div class="md">
        <p>Une page A3 par diagramme. L\u2019ent\u00eate rappelle la section, le pied de page
        la pagination. Les encadr\u00e9s bleus sous un diagramme portent les pr\u00e9cisions
        et les arbitrages clients associ\u00e9s.</p>
        <p>\u00c9tabli par lecture du d\u00e9p\u00f4t, sans supposition : routeurs, contr\u00f4leurs,
        services, mod\u00e8les, \u00e9crans et slices ont \u00e9t\u00e9 \u00e9num\u00e9r\u00e9s sur le code.</p>
      </div>
    </div>
    <div class="bloc">
      <h3>L\u00e9gende des couleurs</h3>
      <div class="legende">
        <div class="pastille p-rouge"></div><div>Interdit, pi\u00e8ge grave ou dette ouverte</div>
        <div class="pastille p-jaune"></div><div>Point de vigilance \u00e0 v\u00e9rifier</div>
        <div class="pastille p-vert"></div><div>Source de v\u00e9rit\u00e9 \u00b7 r\u00e8gle \u00e0 suivre</div>
        <div class="pastille p-rose"></div><div>Donn\u00e9e en LECTURE SEULE (ERP)</div>
      </div>
    </div>
  </div>
  <footer class="pf"><span>${ech(doc.sous)}</span><span>1 / ${NB}</span></footer>
</section>

<section class="page toc">
  <header class="ph"><span class="ph-sec">Sommaire</span><span class="ph-doc">${ech(doc.titre)}</span></header>
  <h2 class="pt">Sommaire</h2>
  <ol>${sommaire.join('\n')}</ol>
  <footer class="pf"><span>${ech(doc.sous)}</span><span>2 / ${NB}</span></footer>
</section>

${corps}

<script type="module">
  import mermaid from './node_modules/mermaid/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    fontFamily: '"Segoe UI", Calibri, Arial, sans-serif',
    themeVariables: {
      fontSize: '15px',
      primaryColor: '#eaf0f7',
      primaryTextColor: '#11161d',
      primaryBorderColor: '#4a6b8a',
      lineColor: '#44525f',
      secondaryColor: '#f3f6f9',
      tertiaryColor: '#fbfcfd',
      clusterBkg: '#f7f9fb',
      clusterBorder: '#aebac7',
      edgeLabelBackground: '#ffffff',
      actorBkg: '#eaf0f7',
      actorBorder: '#1f3b5c',
      noteBkgColor: '#fff8e6',
      noteBorderColor: '#d79a1e',
    },
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis', nodeSpacing: 34, rankSpacing: 46, padding: 10 },
    sequence: { useMaxWidth: true, wrap: false, messageFontSize: 13, actorFontSize: 13, noteFontSize: 12.5 },
    er: { useMaxWidth: true, fontSize: 13 },
    state: { useMaxWidth: true },
  });

  const echelles = [1, .96, .92, .88, .84, .8, .76, .72, .68];
  const AGRANDISSEMENT_MAX = 2.6;   // au-dela, un petit schema deviendrait grotesque
  const PART_MINI_DIAGRAMME = .42;  // le dessin garde au moins 42 % de la hauteur

  (async () => {
    try {
      await mermaid.run({ querySelector: 'pre.mermaid' });
    } catch (e) {
      window.__erreurMermaid = String(e && e.message || e);
    }

    // 1. ajustement du TEXTE : il cede la place au diagramme, jamais l'inverse.
    //    Calcul analytique : une seule mesure par page. Une boucle d'essais
    //    forcerait des centaines de reflows sur un document de ~50 pages A3
    //    bourrees de SVG, et le rendu n'en finirait plus.
    const MINI = echelles[echelles.length - 1];
    document.querySelectorAll('.page').forEach((page) => {
      const boite = page.querySelector('.diag');
      const dispo = page.clientHeight;

      if (!boite) {                       // page de texte : seul le debordement compte
        const trop = page.scrollHeight - dispo;
        if (trop > 2) {
          const t = Math.max(MINI, Math.min(1, dispo / page.scrollHeight));
          page.style.setProperty('--ts', String(t));
        }
        return;
      }

      // le diagramme est l'element elastique : tout le reste est du texte
      const hDiag = boite.getBoundingClientRect().height;
      const hTexte = Math.max(1, page.scrollHeight - hDiag);
      const budget = dispo * (1 - PART_MINI_DIAGRAMME);
      if (hTexte <= budget) return;
      page.style.setProperty('--ts', String(Math.max(MINI, budget / hTexte)));
    });

    // 2. un flowchart en colonne, beaucoup plus haut que large, gaspille l'A3
    //    paysage : il finit minuscule au centre. On le re-rend en rendant la
    //    main a mermaid sur le decoupage des libelles, avec une largeur de
    //    ligne confortable -> le schema s'elargit et se raccourcit.
    // ATTENTION : ce script est injecte depuis un template literal Node.
    //   Tout antislash y serait mange ( \\s devient s ) : ni regex, ni \\n ici.
    console.log('etape: rendu initial termine');
    const SAUT = String.fromCharCode(10);

    const viewBoxDe = (texte) => {
      const i = texte.indexOf('viewBox="');
      if (i < 0) return null;
      const j = texte.indexOf('"', i + 9);
      const p = texte.slice(i + 9, j).trim().split(' ').filter(Boolean).map(Number);
      return (p.length === 4 && p[2] > 0 && p[3] > 0) ? { w: p[2], h: p[3] } : null;
    };
    const facteur = (vb, r) => Math.min(r.width / vb.w, r.height / vb.h, AGRANDISSEMENT_MAX);

    // Mises en page alternatives selon le type de schema. On les essaie et on
    // garde celle qui permet le plus gros facteur d'echelle : sur une A3
    // paysage, un schema en colonne ou un ER etale en ligne finissent illisibles.
    const variantes = (src) => {
      const t = src.trim();
      const sansSaut = src.split('<br/>').join(' ').split('<br>').join(' ')
        .split('<br />').join(' ');
      if (t.startsWith('flowchart TB') || t.startsWith('flowchart TD')) {
        return ['%%{init: {"flowchart": {"wrappingWidth": 470}} }%%' + SAUT + sansSaut];
      }
      if (t.startsWith('flowchart LR')) {
        const i = src.indexOf('flowchart LR');
        return [src.slice(0, i) + 'flowchart TB' + src.slice(i + 12)];
      }
      if (t.startsWith('erDiagram')) {
        const i = src.indexOf('erDiagram');
        return [src.slice(0, i + 9) + SAUT + '    direction TB' + src.slice(i + 9)];
      }
      return [];
    };

    let nbRemis = 0;
    const boites = [...document.querySelectorAll('.diag')];
    for (let i = 0; i < boites.length; i += 1) {
      const boite = boites[i];
      const svg = boite.querySelector('svg');
      const src = boite.dataset.src || '';
      if (!svg || !svg.viewBox || !svg.viewBox.baseVal.width) continue;
      const r = boite.getBoundingClientRect();
      if (!r.width || !r.height) continue;

      const actuel = { w: svg.viewBox.baseVal.width, h: svg.viewBox.baseVal.height };
      let meilleur = facteur(actuel, r);
      if (meilleur > 0.8) continue;              // deja lisible : on n'y touche pas
      let gagnant = null;

      const essais = variantes(src);
      for (let v = 0; v < essais.length; v += 1) {
        try {
          const rendu = await mermaid.render('variante' + i + '_' + v, essais[v]);
          const vb = viewBoxDe(rendu.svg);
          if (!vb) continue;
          const k = facteur(vb, r);
          if (k > meilleur * 1.12) { meilleur = k; gagnant = rendu.svg; }
        } catch (e) { /* variante refusee : on garde ce qu'on a */ }
      }
      if (gagnant) { boite.innerHTML = gagnant; nbRemis += 1; }
    }
    console.log('etape: mises en page remplacees = ' + nbRemis);
    window.__relargis = nbRemis;

    // 3. mise a l'echelle des diagrammes dans la place qui reste.
    document.querySelectorAll('.diag').forEach((boite) => {
      const svg = boite.querySelector('svg');
      if (!svg) return;
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height) return;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      const r = boite.getBoundingClientRect();
      const k = Math.min(r.width / vb.width, r.height / vb.height, AGRANDISSEMENT_MAX);
      svg.style.width = (vb.width * k) + 'px';
      svg.style.height = (vb.height * k) + 'px';
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    });

    window.__pret = true;
  })();
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* 4. Rendu                                                            */
/* ------------------------------------------------------------------ */

async function servir(racine) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json',
    '.css': 'text/css; charset=utf-8',
  };
  const serveur = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const abs = path.join(racine, rel);
    if (!abs.startsWith(racine) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404).end('non trouve');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(abs)] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  });
  await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
  return { serveur, port: serveur.address().port };
}

const { serveur, port } = await servir(TRAVAIL);
const navigateur = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  protocolTimeout: 900000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

for (const doc of DOCS) {
  const texte = fs.readFileSync(doc.src, 'utf8');
  const elements = lireElements(texte);
  const pages = paginer(corpsUtile(elements));
  const html = construireHtml(doc, pages, elements);
  const nomHtml = path.basename(doc.out, '.pdf') + '.html';
  fs.writeFileSync(path.join(TRAVAIL, nomHtml), html, 'utf8');

  const page = await navigateur.newPage();
  await page.setViewport({ width: 1588, height: 1123, deviceScaleFactor: 1 });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message)));
  page.on('console', (m) => console.log('   [page] ' + m.text()));
  await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(nomHtml)}`, {
    waitUntil: 'load', timeout: 120000,
  });
  await page.waitForFunction('window.__pret === true', { timeout: 300000 });

  const diag = await page.evaluate(() => ({
    pages: document.querySelectorAll('.page').length,
    svg: document.querySelectorAll('.diag svg').length,
    mermaidRestant: document.querySelectorAll('pre.mermaid:not([data-processed])').length,
    erreurMermaid: window.__erreurMermaid || null,
    relargis: window.__relargis || 0,
    // facteur d'echelle reellement applique : < 1 = le dessin est reduit,
    // donc son texte devient plus petit que la taille nominale.
    tropPetits: (() => {
      const pages = [...document.querySelectorAll('.page')];
      return [...document.querySelectorAll('.diag')].map((b) => {
        const s = b.querySelector('svg');
        if (!s || !s.viewBox || !s.viewBox.baseVal.width) return null;
        const k = s.getBoundingClientRect().width / s.viewBox.baseVal.width;
        const p = pages.indexOf(b.closest('.page')) + 1;
        return k < 0.85 ? { page: p, k: Math.round(k * 100) / 100 } : null;
      }).filter(Boolean);
    })(),
    debordements: [...document.querySelectorAll('.page')]
      .map((p, i) => ({ i: i + 1, d: p.scrollHeight - p.clientHeight }))
      .filter((x) => x.d > 2),
  }));

  await page.pdf({
    path: doc.out,
    width: '420mm',
    height: '297mm',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    timeout: 300000,
  });
  await page.close();

  // plan de pagination, pour reperer vite quel schema occupe quelle page
  fs.writeFileSync(
    path.join(TRAVAIL, path.basename(doc.out, '.pdf') + '.plan.txt'),
    pages.map((p, i) => `${i + 3}\t${p.genre}\t${(p.titre || '').slice(0, 70)}`).join('\n'),
    'utf8',
  );
  console.log(`\n${path.basename(doc.out)}`);
  console.log(`  pages A3        : ${diag.pages}  (diagrammes rendus : ${diag.svg})`);
  console.log(`  mermaid restant : ${diag.mermaidRestant}   relargis : ${diag.relargis}`);
  if (diag.tropPetits.length) {
    console.log(`  schemas reduits : ${diag.tropPetits.map((x) => `p${x.page}:x${x.k}`).join(', ')}`);
  }
  if (diag.erreurMermaid) console.log(`  ERREUR mermaid  : ${diag.erreurMermaid}`);
  if (erreurs.length) console.log(`  erreurs page    : ${erreurs.slice(0, 3).join(' | ')}`);
  if (diag.debordements.length) {
    console.log(`  DEBORDEMENTS    : ${diag.debordements.map((x) => `p${x.i}:+${x.d}px`).join(', ')}`);
  } else {
    console.log('  debordements    : aucun');
  }
  console.log(`  taille          : ${(fs.statSync(doc.out).size / 1024 / 1024).toFixed(2)} Mo`);
}

await navigateur.close();
serveur.close();
console.log('\ntermine');
