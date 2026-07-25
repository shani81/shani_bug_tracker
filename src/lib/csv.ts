import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal RFC 4180 CSV. No dependency, and no surprises on the two things
// naive implementations get wrong: quoted fields containing commas/newlines,
// and spreadsheet formula injection on export.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape one field.
 *
 * Values starting with =, +, - or @ are prefixed with a single quote: Excel and
 * Sheets execute those as formulas, so an issue titled `=HYPERLINK(...)` would
 * run when a colleague opens the export.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);

  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return columns?.length ? columns.join(",") + "\r\n" : "";
  const cols = columns ?? Object.keys(rows[0]);
  const head = cols.map(escapeField).join(",");
  const body = rows.map((r) => cols.map((c) => escapeField(r[c])).join(",")).join("\r\n");
  return head + "\r\n" + body + "\r\n";
}

/**
 * Parse CSV into objects keyed by the header row.
 * Handles quoted fields, embedded commas/newlines, escaped quotes and CRLF.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^﻿/, ""); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // swallow the \n of a \r\n pair
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // trailing field / row (file may not end with a newline)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ""));
  if (nonEmpty.length === 0) return [];

  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}
