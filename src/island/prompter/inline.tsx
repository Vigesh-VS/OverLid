import type { ReactNode } from "react";

// Markdown inline styling as React elements: never HTML strings, so script
// text can't inject markup. Links show their text only (not clickable while
// presenting).
const TOKEN = /(\*\*|__)(.+?)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[2] !== undefined) out.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[4] !== undefined) out.push(<em key={key++}>{m[4]}</em>);
    else if (m[5] !== undefined) out.push(<span key={key++}>{m[5]}</span>);
    else if (m[6] !== undefined) out.push(<span key={key++}>{m[6]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
