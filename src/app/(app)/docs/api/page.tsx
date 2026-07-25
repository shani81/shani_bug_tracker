import { PageHeader, PageContainer } from "@/components/page-header";
import { Badge, Card } from "@/components/ui/primitives";

export const metadata = { title: "API reference — Bug Tracker" };

type Endpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  scope: "read" | "write";
  summary: string;
  detail?: string;
};

const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/v1/me", scope: "read", summary: "Identity, org role, scopes and effective capabilities for the presented token." },
  { method: "GET", path: "/api/v1/projects", scope: "read", summary: "Projects with their statuses, labels and components.", detail: "Use this to discover the statusId, labelId and componentId values needed when creating issues." },
  { method: "GET", path: "/api/v1/issues", scope: "read", summary: "List issues.", detail: "Query: group, projectId, statusId, priority, severity, assigneeId, labelId, q, limit (max 100), offset." },
  { method: "POST", path: "/api/v1/issues", scope: "write", summary: "Create an issue.", detail: "Body: projectId (required), title (required), type, descMd, expected, actual, steps, priority, severity, impact, environment, statusId, assigneeIds[], labelIds[]." },
  { method: "GET", path: "/api/v1/issues/{id}", scope: "read", summary: "Fetch one issue with comments, attachments, activity and time logs." },
  { method: "PATCH", path: "/api/v1/issues/{id}", scope: "write", summary: "Update an issue.", detail: "Editable fields plus statusId, assigneeIds[] and labelIds[]. A statusId change is routed through the transition logic, so resolution timestamps and activity are recorded." },
  { method: "DELETE", path: "/api/v1/issues/{id}", scope: "write", summary: "Soft-delete an issue. Requires issue:delete." },
  { method: "GET", path: "/api/v1/issues/{id}/comments", scope: "read", summary: "List comments.", detail: "Internal (private) comments are omitted for guest accounts." },
  { method: "GET", path: "/api/v1/export", scope: "read", summary: "Export issues as CSV or JSON.", detail: "Query: format=csv|json plus the same filters as /api/v1/issues." },
  { method: "POST", path: "/api/v1/issues/{id}/comments", scope: "write", summary: "Add a comment.", detail: "Body: body (required), parentId, isPrivate." },
];

const METHOD_COLOR: Record<Endpoint["method"], string> = {
  GET: "#0891b2",
  POST: "#16a34a",
  PATCH: "#d97706",
  DELETE: "#dc2626",
};

const ERRORS: [string, string][] = [
  ["401 UNAUTHENTICATED", "Missing, malformed, revoked or expired token."],
  ["403 FORBIDDEN", "Valid token, but the role lacks the capability — or the token is read-only."],
  ["404 NOT_FOUND", "No such record in your organization. Records in other organizations return 404, never 403."],
  ["422 INVALID_REQUEST", "Body failed validation; the message names the offending field."],
  ["400 BAD_REQUEST", "Well-formed but rejected (e.g. empty title)."],
];

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">
      {children}
    </pre>
  );
}

export default function ApiDocsPage() {
  return (
    <PageContainer>
      <PageHeader icon={"🔌"} title="API reference" subtitle="REST v1 — authenticate with a personal access token" />

      <div className="flex flex-col gap-4 pb-8">
        <Card className="p-4">
          <p className="mb-2 text-[13.5px] font-semibold">Authentication</p>
          <p className="mb-3 text-[13px] text-muted">
            Create a token under <span className="font-medium text-text">Settings → Account</span>, then send it as a
            bearer token. A token acts as the user who created it and is further limited by its scopes — a{" "}
            <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">read</code> token can never write, even
            if its owner is an owner.
          </p>
          <Code>{`curl https://your-host/api/v1/issues?group=bug&limit=5 \\
  -H "Authorization: Bearer bt_your_token_here"`}</Code>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-[13.5px] font-semibold">Endpoints</p>
          <div className="flex flex-col divide-y divide-border">
            {ENDPOINTS.map((e) => (
              <div key={`${e.method} ${e.path}`} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={METHOD_COLOR[e.method]} className="font-mono">
                    {e.method}
                  </Badge>
                  <code className="font-mono text-[12.5px]">{e.path}</code>
                  <Badge color={e.scope === "write" ? "#d97706" : "#0891b2"} className="ml-auto">
                    {e.scope}
                  </Badge>
                </div>
                <p className="text-[12.5px] text-muted">{e.summary}</p>
                {e.detail && <p className="text-[12px] text-faint">{e.detail}</p>}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-[13.5px] font-semibold">Example — create a bug</p>
          <Code>{`curl -X POST https://your-host/api/v1/issues \\
  -H "Authorization: Bearer bt_your_token_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectId": "<from /api/v1/projects>",
    "type": "bug",
    "title": "Checkout fails on Safari",
    "descMd": "Tapping Pay does nothing.",
    "priority": "high",
    "severity": "major"
  }'`}</Code>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-[13.5px] font-semibold">Responses &amp; errors</p>
          <p className="mb-3 text-[12.5px] text-muted">
            Successful responses wrap the payload in <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">data</code>;
            list endpoints add <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">pagination</code>.
            Errors return <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">{`{ error: { code, message } }`}</code>.
          </p>
          <div className="flex flex-col divide-y divide-border">
            {ERRORS.map(([code, meaning]) => (
              <div key={code} className="flex flex-wrap gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                <code className="shrink-0 font-mono text-[12px] text-text">{code}</code>
                <span className="text-[12.5px] text-muted">{meaning}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-[13.5px] font-semibold">GraphQL</p>
          <p className="mb-3 text-[12.5px] text-muted">
            <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">POST /api/graphql</code> with the
            same bearer token. Resolvers call the same queries and actions as REST, so authorization, org
            scoping and side effects are identical — including the read/write scope clamp.{" "}
            <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">GET /api/graphql</code> returns
            the schema (SDL).
          </p>
          <Code>{`curl -X POST https://your-host/api/graphql \
  -H "Authorization: Bearer bt_your_token_here" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ issues(filter:{group:\\"bug\\",limit:5}) { nodes { key title priority } total } }"}'`}</Code>
          <p className="mt-3 text-[12px] text-faint">
            Queries: me, projects, issues(filter), issue(id). Mutations: createIssue, updateIssue,
            changeStatus, setAssignees, setLabels, addComment, deleteIssue.
          </p>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-[13.5px] font-semibold">Webhooks</p>
          <p className="mb-3 text-[12.5px] text-muted">
            Configure outbound webhooks under <span className="font-medium text-text">Settings → Automation</span>.
            Each delivery is a POST carrying{" "}
            <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">X-BugTracker-Signature</code>, an
            HMAC-SHA256 of <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">timestamp.body</code>{" "}
            keyed with the signing secret shown once at creation. Verify it before trusting the payload — and
            reject old timestamps to prevent replay.
          </p>
          <Code>{`// Express receiver
const crypto = require("crypto");

app.post("/hooks/bugs", express.raw({ type: "application/json" }), (req, res) => {
  const ts  = req.get("X-BugTracker-Timestamp");
  const sig = req.get("X-BugTracker-Signature");
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET)
    .update(ts + "." + req.body.toString())
    .digest("hex");

  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return res.sendStatus(401);
  if (Date.now() - Number(ts) > 5 * 60_000) return res.sendStatus(408); // stale

  const { event, data } = JSON.parse(req.body);
  console.log(event, data);
  res.sendStatus(200);
});`}</Code>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-[13.5px] font-semibold">Notes</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[12.5px] text-muted">
            <li>Every request is scoped to the token&apos;s organization; ids from other organizations return 404.</li>
            <li>Writes run through the same permission checks and side effects as the web app — activity entries, notifications and realtime events all fire.</li>
            <li>Tokens are shown once at creation. Revoking a token, deactivating the account, or removing the user from the org all invalidate it immediately.</li>
            <li>Webhook endpoints must be publicly reachable; private and link-local addresses are rejected.</li>
            <li>Queries are capped at 10,000 characters and 12 levels of nesting.</li>
          </ul>
        </Card>
      </div>
    </PageContainer>
  );
}
