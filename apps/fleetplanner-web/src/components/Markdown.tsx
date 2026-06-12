import type { ReactNode } from "react";

// Minimal, safe Markdown → React renderer (no dangerouslySetInnerHTML, no deps).
// Covers the briefing subset operators write: # / ## / ### headings, - / * lists,
// **bold**, *italic*, `code`, [text](url), paragraphs and line breaks.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // token regex: links, bold, italic, code (order matters)
  const re = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1]) out.push(<a key={key} href={m[3]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>{m[2]}</a>);
    else if (m[4]) out.push(<strong key={key} style={{ color: "var(--text-hi)", fontWeight: 700 }}>{m[5]}</strong>);
    else if (m[6]) out.push(<code key={key} style={{ fontFamily: "var(--mono)", fontSize: "0.92em", background: "var(--bg3)", padding: "1px 5px", borderRadius: 4 }}>{m[7]}</code>);
    else if (m[8]) out.push(<em key={key}>{m[9]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, style }: { text: string; style?: React.CSSProperties }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={`p-${k++}`} style={{ margin: "0 0 0.7rem", lineHeight: 1.6 }}>{inline(para.join(" "), `p${k}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const items = list;
      blocks.push(<ul key={`u-${k++}`} style={{ margin: "0 0 0.7rem", paddingLeft: "1.2rem", lineHeight: 1.55 }}>{items.map((li, j) => <li key={j} style={{ marginBottom: "0.2rem" }}>{inline(li, `li${k}-${j}`)}</li>)}</ul>);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const lvl = h[1].length;
      const size = lvl === 1 ? "1.3rem" : lvl === 2 ? "1.08rem" : "0.95rem";
      blocks.push(<div key={`h-${k++}`} style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: size, color: "var(--text-hi)", margin: "0.9rem 0 0.5rem" }}>{inline(h[2], `h${k}`)}</div>);
    } else if (li) {
      flushPara();
      list.push(li[1]);
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();

  return <div style={{ color: "#c2d2de", fontSize: "1.02rem", ...style }}>{blocks}</div>;
}
