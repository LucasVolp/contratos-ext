import { NextRequest, NextResponse } from "next/server";
// Optimistic check only: the API validates every session. Without the cookie, skip rendering and go to login.
export function proxy(request: NextRequest) {
  if (request.cookies.has("contracts_session")) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const target = new URL("/login", request.url);
  if (pathname !== "/") target.searchParams.set("next", pathname + search);
  return NextResponse.redirect(target);
}
export const config = {
  matcher: ["/((?!api|login|_next|fonts|favicon.ico).*)"],
};
