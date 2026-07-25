"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Check, TriangleAlert, FileText } from "lucide-react";
import { Button, Card, Field, Select, Spinner } from "@/components/ui/primitives";
import { previewIssueImport, runIssueImport, type ImportPreview } from "@/lib/import-actions";
import type { SettingsData } from "@/lib/module-queries";

const downloadLink =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2";

const TEMPLATE = `title,type,priority,severity,description,labels,assignees
"Checkout button does nothing on iOS",bug,high,major,"Tapping Pay is a no-op on Safari 17.",regression,maya@acme.dev
"Add CSV export to reports",feature,medium,minor,"Customers keep asking for this.",,
`;

export function DataTab({ projects }: { projects: SettingsData["projects"] }) {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
  const [csv, setCsv] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [imported, setImported] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const exportUrl = (format: string) =>
    `/api/v1/export?format=${format}${projectId ? `&projectId=${projectId}` : ""}`;

  async function onFile(file: File) {
    setPreview(null);
    setImported(false);
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
  }

  async function doPreview() {
    setBusy(true);
    setImported(false);
    try {
      setPreview(await previewIssueImport({ projectId, csv }));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    try {
      const res = await runIssueImport({ projectId, csv });
      setPreview(res);
      setImported(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Export ─────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <Download size={16} className="text-faint" />
          <p className="text-[13.5px] font-semibold">Export issues</p>
        </div>
        <p className="mb-3 text-[12.5px] text-muted">
          Downloads the issues you can see. CSV opens cleanly in Excel and Sheets; JSON keeps the full
          structure.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Project" className="min-w-48">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {/* anchors, not Buttons: a download needs a real href */}
          <a href={exportUrl("csv")} download className={downloadLink}>
            <Download size={14} /> CSV
          </a>
          <a href={exportUrl("json")} download className={downloadLink}>
            <Download size={14} /> JSON
          </a>
        </div>
      </Card>

      {/* ── Import ─────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <Upload size={16} className="text-faint" />
          <p className="text-[13.5px] font-semibold">Import issues from CSV</p>
        </div>
        <p className="mb-3 text-[12.5px] text-muted">
          Needs a <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">title</code> column.
          Optional: type, priority, severity, description, expected, actual, steps, url, labels, assignees.
          Labels match by name, assignees by email; unknown values are ignored rather than failing the row.
        </p>

        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Import into" className="min-w-48">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] hover:bg-surface-2">
            <FileText size={14} />
            {fileName || "Choose a .csv file"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>

          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="issues-template.csv"
            className="text-[12.5px] text-primary hover:underline"
          >
            Download a template
          </a>
        </div>

        {csv && !imported && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={doPreview} disabled={busy || !projectId}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : null} Check file
            </Button>
            {preview?.ok && preview.valid > 0 && (
              <Button variant="primary" size="sm" onClick={doImport} disabled={busy}>
                Import {preview.valid} issue{preview.valid === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        )}

        {preview && (
          <div className="mt-3">
            {preview.error ? (
              <p className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
                <TriangleAlert size={14} /> {preview.error}
              </p>
            ) : (
              <>
                <p
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ${
                    imported ? "bg-success/10 text-success" : "bg-surface-2 text-muted"
                  }`}
                >
                  {imported ? <Check size={14} /> : <FileText size={14} />}
                  {imported
                    ? `Imported ${preview.valid} of ${preview.totalRows} rows.`
                    : `${preview.valid} of ${preview.totalRows} rows look good.`}
                  {preview.invalid > 0 && ` ${preview.invalid} will be skipped.`}
                </p>

                {preview.unknownColumns.length > 0 && (
                  <p className="mt-2 text-[12px] text-faint">
                    Ignored unrecognised columns: {preview.unknownColumns.join(", ")}
                  </p>
                )}

                {preview.invalid > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
                    {preview.results
                      .filter((r) => !r.ok)
                      .map((r) => (
                        <div
                          key={r.row}
                          className="flex gap-3 border-b border-border px-3 py-1.5 text-[12px] last:border-b-0"
                        >
                          <span className="shrink-0 text-faint">row {r.row}</span>
                          <span className="min-w-0 flex-1 truncate">{r.title}</span>
                          <span className="shrink-0 text-danger">{r.message}</span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
