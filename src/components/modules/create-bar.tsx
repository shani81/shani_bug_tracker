"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, TriangleAlert } from "lucide-react";
import { Button, Card, Field, Input, Select, Spinner } from "@/components/ui/primitives";
import { createProjectRelease, createProjectSprint } from "@/lib/project-actions";
import { useCan } from "@/components/workspace";

type ProjectOption = { id: string; name: string };

/**
 * "New release" / "New sprint" affordance for the Releases and Sprints pages.
 * Hidden entirely when the viewer lacks the capability — the server re-checks
 * regardless, this just avoids showing a control that would always fail.
 */
export function CreateBar({
  kind,
  projects,
}: {
  kind: "release" | "sprint";
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const canManage = useCan(kind === "release" ? "release:manage" : "sprint:manage");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!canManage || projects.length === 0) return null;

  async function submit(fd: FormData) {
    setBusy(true);
    setError(null);
    try {
      const projectId = String(fd.get("projectId") ?? "");
      const res =
        kind === "release"
          ? await createProjectRelease({
              projectId,
              version: String(fd.get("version") ?? ""),
              name: String(fd.get("name") ?? ""),
              description: String(fd.get("description") ?? ""),
              releaseDate: String(fd.get("releaseDate") ?? "") || null,
            })
          : await createProjectSprint({
              projectId,
              name: String(fd.get("name") ?? ""),
              goal: String(fd.get("goal") ?? ""),
              startDate: String(fd.get("startDate") ?? "") || null,
              endDate: String(fd.get("endDate") ?? "") || null,
            });

      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={16} /> New {kind}
      </Button>
    );
  }

  return (
    <Card className="w-full p-4">
      <form action={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Project" required>
          <Select name="projectId" required defaultValue={projects[0]?.id}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        {kind === "release" ? (
          <>
            <Field label="Version" required>
              <Input name="version" required placeholder="2.4.0" maxLength={50} />
            </Field>
            <Field label="Name" hint="Optional">
              <Input name="name" placeholder="Autumn release" maxLength={200} />
            </Field>
            <Field label="Target date" hint="Optional">
              <Input name="releaseDate" type="date" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" hint="Optional">
                <Input name="description" placeholder="What ships in this release" maxLength={2000} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Name" required>
              <Input name="name" required placeholder="Sprint 12" maxLength={120} />
            </Field>
            <Field label="Starts" hint="Optional">
              <Input name="startDate" type="date" />
            </Field>
            <Field label="Ends" hint="Optional">
              <Input name="endDate" type="date" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Goal" hint="Optional">
                <Input name="goal" placeholder="What this sprint is for" maxLength={500} />
              </Field>
            </div>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger sm:col-span-2"
          >
            <TriangleAlert size={14} /> {error}
          </p>
        )}

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : null} Create {kind}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
