import { subscribe, type RealtimeEvent } from "@/lib/realtime";
import { getAuthContext } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events endpoint. Clients (EventSource) connect here and receive
// realtime events. Requires an authenticated session — the stream carries
// issue ids/keys and must not be readable by anonymous clients.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: RealtimeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          close();
        }
      };

      send({ type: "ping", at: Date.now() });

      // scoped to the caller's org — no cross-tenant event leakage
      const unsubscribe = subscribe(ctx.orgId, send);

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          close();
        }
      }, 25000);

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
