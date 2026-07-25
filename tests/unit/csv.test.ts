import { describe, it, expect } from "vitest";
import { toCsv, parseCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("writes a header and CRLF rows", () => {
    const out = toCsv([{ a: "1", b: "2" }]);
    expect(out).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes fields containing commas, quotes or newlines", () => {
    const out = toCsv([{ t: 'He said "hi", then left' }]);
    expect(out).toContain('"He said ""hi"", then left"');

    const multi = toCsv([{ t: "line one\nline two" }]);
    expect(multi).toContain('"line one\nline two"');
  });

  it("round-trips through parseCsv", () => {
    const rows = [
      { title: "Plain", note: "" },
      { title: 'Comma, quote " and\nnewline', note: "x" },
    ];
    const parsed = parseCsv(toCsv(rows));
    expect(parsed).toHaveLength(2);
    expect(parsed[1].title).toBe('Comma, quote " and\nnewline');
  });

  /** The written cell, with CSV's surrounding quotes removed if present. */
  function cellOf(value: string): string {
    const line = toCsv([{ title: value }]).split("\r\n")[1];
    return line.startsWith('"') ? line.slice(1) : line;
  }

  it("neutralises spreadsheet formula injection", () => {
    // An issue titled =HYPERLINK(...) must not execute when the export is
    // opened in Excel or Sheets.
    for (const value of ["=cmd|'/c calc'!A1", "+1+1", "-1+1", "@SUM(A1)"]) {
      expect(cellOf(value).startsWith("'"), value).toBe(true);
    }
  });

  // Regression: the escape was anchored at index 0, so a single leading space
  // slipped a formula through — and unlike title, descMd is not trimmed on the
  // write path, so the value survives verbatim into the export.
  it("neutralises formulas hidden behind leading whitespace", () => {
    const dangerous = [
      " =1+1",
      '  =HYPERLINK("http://evil")',
      "\t=cmd|'/c calc'!A1",
      "\n+1+1",
      " @SUM(A1)",
      " -1+1",
    ];
    for (const value of dangerous) {
      expect(cellOf(value).startsWith("'"), JSON.stringify(value)).toBe(true);
    }
  });

  it("leaves ordinary values alone", () => {
    for (const value of ["Checkout is broken", "2 + 2 in the title", "user@example.com"]) {
      expect(cellOf(value).startsWith("'"), value).toBe(false);
    }
  });

  it("handles empty input and null fields", () => {
    expect(toCsv([])).toBe("");
    expect(toCsv([], ["a", "b"])).toBe("a,b\r\n");
    expect(toCsv([{ a: null, b: undefined }])).toBe("a,b\r\n,\r\n");
  });

  it("honours an explicit column order", () => {
    const out = toCsv([{ b: "2", a: "1" }], ["a", "b"]);
    expect(out).toBe("a,b\r\n1,2\r\n");
  });
});

describe("parseCsv", () => {
  it("keys rows by header", () => {
    const rows = parseCsv("title,type\nHello,bug");
    expect(rows).toEqual([{ title: "Hello", type: "bug" }]);
  });

  it("handles quoted fields with embedded delimiters", () => {
    const rows = parseCsv('title,note\n"a, b","says ""hi"""');
    expect(rows[0].title).toBe("a, b");
    expect(rows[0].note).toBe('says "hi"');
  });

  it("handles embedded newlines inside quotes", () => {
    const rows = parseCsv('title,note\n"multi\nline",x');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("multi\nline");
  });

  it("accepts CRLF, LF and a trailing newline or none", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
    expect(parseCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("strips a UTF-8 BOM so the first header is usable", () => {
    const rows = parseCsv("﻿title,type\nHello,bug");
    expect(rows[0].title).toBe("Hello");
    expect(Object.keys(rows[0])).toContain("title");
  });

  it("skips blank lines and pads short rows", () => {
    const rows = parseCsv("a,b,c\n1,2,3\n\n4,5\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ a: "4", b: "5", c: "" });
  });

  it("returns nothing for empty or header-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   ")).toEqual([]);
    expect(parseCsv("a,b\n")).toEqual([]);
  });
});
