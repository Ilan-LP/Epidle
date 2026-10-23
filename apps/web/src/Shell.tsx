import { LANGUAGES, type Language, type LanguageId } from "@epidle/api-client";
import type { ReactNode } from "react";

export function Header({
  lang,
  setLang,
  pseudo,
  children,
}: {
  lang: Language;
  setLang: (id: LanguageId) => void;
  pseudo?: string;
  children?: ReactNode;
}) {
  return (
    <header className="header">
      <div className="titlebar">
        <span className="title">
          <span className="primary">{lang.file}</span>
          {pseudo && <span className="dim"> · {pseudo}</span>}
        </span>
        <label className="lang">
          <span className="dim">langage </span>
          <select value={lang.id} onChange={(e) => setLang(e.target.value as LanguageId)}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {children}
    </header>
  );
}
