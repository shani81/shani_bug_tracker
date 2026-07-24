import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "bt_session";

// Optimistic fast path only: bounce obviously-anonymous requests to /login
// before doing any page work. This is NOT the security boundary — the cookie
// is not validated here (proxy can't reach the database). Real verification
// happens server-side in the (app) layout, in every server action and in every
// query, all of which resolve the session against the DB.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (!hasCookie && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, static assets and the auth endpoints themselves.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/).*)"],
};
