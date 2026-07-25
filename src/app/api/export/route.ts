import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/permissions";
import { buildExport, csvResponseBody, exportFilename } from "@/lib/export-issues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/export — the download links in Settings → Import / Export.
 *
 * Cookie-authenticated, because a browser <a download> cannot attach a bearer
 * token. /api/v1/export is the token-authenticated equivalent for API clients.
 */
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Bulk export includes every description plus reporter and assignee email
  // addresses; guests are external accounts and should not be able to dump it.
  if (ctx.orgRole === "guest") {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 500) || 500, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const { issues, rows } = await buildExport(url.searchParams, limit, offset);

  if (format === "json") {
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), issues }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename("json")}"`,
      },
    });
  }

  return new NextResponse(csvResponseBody(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename("csv")}"`,
    },
  });
}
