// src/components/Admin/SpamCheckField.jsx
//
// Champ texte (objet d'email, nom…) avec DÉTECTION SPAM : les mots / caractères à
// risque sont surlignés en ROUGE (calque superposé) et un bandeau d'avertissement
// prévient que l'email risque de finir dans les spams.
import React, { useMemo, useRef } from "react";
import { HiExclamation } from "react-icons/hi";
import { analyzeSpam } from "../../utils/spamCheck";
import "./SpamCheckField.css";

// Découpe le texte en segments (surlignés ou non) selon les plages.
const segments = (text, ranges) => {
  const segs = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) segs.push({ text: text.slice(pos, r.start), hl: false });
    segs.push({ text: text.slice(r.start, r.end), hl: true });
    pos = r.end;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), hl: false });
  return segs;
};

const SpamCheckField = ({ label, value, onChange, placeholder, multiline, rows = 3 }) => {
  const backRef = useRef(null);
  const analysis = useMemo(() => analyzeSpam(value), [value]);
  const segs = useMemo(() => segments(String(value || ""), analysis.ranges), [value, analysis.ranges]);

  const sync = (e) => {
    if (backRef.current) {
      backRef.current.scrollTop = e.target.scrollTop;
      backRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const inputProps = {
    className: "scf-input",
    value: value || "",
    placeholder,
    onChange: (e) => onChange(e.target.value),
    onScroll: sync,
    spellCheck: false,
  };

  return (
    <div className={`scf-field scf-${analysis.level}`}>
      {label && <span className="scf-lbl">{label}</span>}
      <div className={`scf-box ${multiline ? "scf-box--multi" : ""}`}>
        <div className="scf-backdrop" ref={backRef} aria-hidden="true">
          {segs.map((s, i) =>
            s.hl ? <mark key={i} className="scf-mark">{s.text}</mark> : <span key={i}>{s.text}</span>,
          )}
          {/* garde la hauteur en fin de ligne */}
          {"​"}
        </div>
        {multiline ? (
          <textarea {...inputProps} rows={rows} />
        ) : (
          <input {...inputProps} type="text" />
        )}
      </div>
      {analysis.reasons.length > 0 && (
        <div className="scf-banner">
          <HiExclamation />
          <span>
            Risque de spam — {analysis.reasons.slice(0, 5).join(" · ")}
            {analysis.reasons.length > 5 ? "…" : ""}
          </span>
        </div>
      )}
    </div>
  );
};

export default SpamCheckField;
