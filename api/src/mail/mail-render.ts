import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "templates");
const cache = new Map<string, { html: string; text: string }>();

function find(kind: "html" | "text", id: string): string {
  const name = readdirSync(join(DIR, kind)).find((f) => f.startsWith(`${id}-`));
  if (!name) throw new Error(`mail template ${id} (${kind}) is missing`);
  return readFileSync(join(DIR, kind, name), "utf8");
}

export function loadTemplate(id: string): { html: string; text: string } {
  let t = cache.get(id);
  if (!t) {
    t = { html: find("html", id), text: find("text", id) };
    cache.set(id, t);
  }
  return t;
}

export type MailVars = Record<string, string | number>;

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FIELD = /\{\{([a-z_0-9]+)\}\}/g;

/** Fills {{fields}}. Returns the names of any field the caller did not give, so a half-filled mail is never sent. */
export function fill(
  source: string,
  vars: MailVars,
  html: boolean,
): { out: string; missing: string[] } {
  const missing: string[] = [];
  const out = source.replace(FIELD, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      missing.push(name);
      return "";
    }
    return html ? esc(String(v)) : String(v);
  });
  return { out, missing };
}

export function renderMail(
  id: string,
  subject: string,
  vars: MailVars,
):
  | { ok: true; subject: string; html: string; text: string }
  | { ok: false; missing: string[] } {
  const t = loadTemplate(id);
  const h = fill(t.html, vars, true);
  const x = fill(t.text, vars, false);
  const s = fill(subject, vars, false);
  const missing = [...new Set([...h.missing, ...x.missing, ...s.missing])];
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    subject: s.out.replace(/[\r\n]+/g, " ").trim(),
    html: h.out,
    text: x.out,
  };
}
