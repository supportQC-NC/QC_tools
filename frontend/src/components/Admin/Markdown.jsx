// src/components/Admin/Markdown.jsx
//
// Rendu markdown LÉGER et sûr (sans dépendance) pour les réponses de l'assistant :
// titres (#, ##, ###), listes à puces / numérotées, gras/italique, `code`, blocs
// de code, et surtout LIENS CLIQUABLES ([texte](url) + URLs brutes → nouvel onglet).
// On construit des éléments React (pas de dangerouslySetInnerHTML).
import React from "react";

// Analyse INLINE : **gras**, *italique*, _italique_, `code`, [texte](url), URL brute.
const inlineParse = (text) => {
  const nodes = [];
  let key = 0;
  const re =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\bhttps?:\/\/[^\s)]+)|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(
        <a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      nodes.push(
        <a key={key++} href={m[4]} target="_blank" rel="noopener noreferrer">
          {m[4]}
        </a>,
      );
    } else if (m[5]) {
      nodes.push(<strong key={key++}>{m[6]}</strong>);
    } else if (m[7]) {
      nodes.push(<code key={key++}>{m[8]}</code>);
    } else if (m[9]) {
      nodes.push(<em key={key++}>{m[10]}</em>);
    } else if (m[11]) {
      nodes.push(<em key={key++}>{m[12]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

const isSpecial = (l) => /^\s*([-*•]\s+|\d+\.\s+|#{1,3}\s+|```)/.test(l);

const Markdown = ({ text }) => {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Bloc de code ```
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // fence de fin
      blocks.push(
        <pre key={blocks.length} className="md-pre">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Titres
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const Tag = `h${h[1].length + 2}`; // h3..h5
      blocks.push(<Tag key={blocks.length}>{inlineParse(h[2])}</Tag>);
      i++;
      continue;
    }

    // Liste à puces
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={blocks.length}>
          {items.map((it, k) => (
            <li key={k}>{inlineParse(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Liste numérotée
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={blocks.length}>
          {items.map((it, k) => (
            <li key={k}>{inlineParse(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraphe (lignes consécutives non spéciales)
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" && !isSpecial(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    const para = [];
    buf.forEach((l, li) => {
      if (li) para.push(<br key={`br${li}`} />);
      para.push(
        <React.Fragment key={`l${li}`}>{inlineParse(l)}</React.Fragment>,
      );
    });
    blocks.push(<p key={blocks.length}>{para}</p>);
  }

  return <div className="md">{blocks}</div>;
};

export default Markdown;
