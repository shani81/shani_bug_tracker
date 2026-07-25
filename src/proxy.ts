import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "bt_session";

// Optimistic fast path only: bounce obviously-anonymous requests to /login
// before doing any page work. This is NOT the security boundary — the cookie
// is not validated here (proxy can't reach the database). Real verification
// happens server-side in the (app) layout, in every server action and in every
// query, all of which resolve the session against the DB.

/**
 * Paths that must stay reachable while signed out.
 *
 * The PWA entries matter: Chrome fetches the manifest, the service worker and
 * the icons WITHOUT credentials when deciding whether the app is installable.
 * Redirecting them to /login makes the install prompt never appear.
 */
const PUBLIC = ["/login", "/invite", "/reset", "/offline"];
const PUBLIC_FILES = ["/manifest.webmanifest", "/sw.js", "/robots.txt"];

const isPublic = (p: string) =>
  PUBLIC_FILES.includes(p) ||
  p.startsWith("/icons/") ||
  PUBLIC.some((r) => p === r || p.startsWith(r + "/"));

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (!hasCookie && !isPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, static assets, the public auth routes and the PWA
  // files. The exclusions here and in isPublic() must stay in agreement.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt|login|invite|reset|offline|api/).*)",
  ],
};
