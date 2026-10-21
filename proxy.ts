import { podeAcessarRota } from "@/lib/auth/acessos";
import type { Role } from "@/lib/auth/types";
import { supabaseFetch } from "@/lib/supabase/fetch";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isPublicPath } from "@/lib/auth/public-paths";
import {
  verifyImpersonateCookieEdge,
  IMPERSONATE_COOKIE_NAME_EDGE,
} from "@/lib/impersonate/cookie-edge";

const COOKIE_NAME = "sb-deskcomm-auth";

export async function proxy(request: NextRequest) {
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });

  // Inject X-Request-Id for downstream correlation (audit log, error wrappers).
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  response.headers.set("x-request-id", requestId);

  const { pathname, search } = request.nextUrl;
  // Expose pathname to Server Components via header (used by onboarding layout).
  response.headers.set("x-pathname", pathname);
  request.headers.set("x-pathname", pathname);

  // EPIC-11: in dev we route by path (`/admin/*`); in prod the
  // `admin.deskcomm.com` sub-domain is mapped via Vercel rewrites to the same
  // `/admin/*` paths. The host-based branch below stays a NOOP today and only
  // exists as documentation of the intended deploy topology.
  const host = request.headers.get("host") ?? "";
  const isAdminSurface = host.startsWith("admin.") || pathname.startsWith("/admin");

  // As rotas duais com cookie precisam do mesmo gate de módulo; Bearer sem
  // cookie segue para a validação própria de integrações.
  const sessionCookie = request.cookies.getAll().some((c) => c.name.startsWith(COOKIE_NAME));
  const dualPath =
    /^\/api\/v1\/(contacts$|messages$|conversations\/open-with-contact$|conversations\/[^/]+\/media$)/.test(
      pathname,
    );
  if (isPublicPath(pathname) && !(sessionCookie && dualPath)) {
    return response;
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { fetch: supabaseFetch },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
      cookieOptions: {
        name: COOKIE_NAME,
        sameSite: "strict",
        httpOnly: true,
        secure: cookieSecure(),
        path: "/",
      },
    },
  );

  // Validate JWT server-side (NEVER use getSession on backend per CLAUDE.md).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // API routes must respond with JSON envelope (contract: {error:{code,message}})
    // — never redirect HTML to JSON consumers. UI routes redirect to /login as before.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({
          error: {
            code: "unauthenticated",
            message: "Authentication required",
          },
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
          },
        },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith("/app") || pathname.startsWith("/api/v1/")) {
    const { data: memberships, error: membershipError } = await supabase
      .from("user_organizations")
      .select("organization_id, role, module_access, accepted_at")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("accepted_at", { ascending: true, nullsFirst: true })
      .order("organization_id");
    if (membershipError)
      return NextResponse.json(
        {
          error: {
            code: "upstream_unavailable",
            message: "Não foi possível confirmar os acessos.",
          },
        },
        { status: 503 },
      );
    const selectedOrg = request.cookies.get("active_org")?.value;
    const membership =
      memberships?.find((m) => m.organization_id === selectedOrg) ?? memberships?.[0];
    if (
      membership &&
      !podeAcessarRota(membership.module_access, membership.role as Role, pathname)
    ) {
      if (pathname.startsWith("/api/") || request.headers.has("next-action")) {
        return NextResponse.json(
          {
            error: {
              code: "forbidden",
              message:
                "Você não tem acesso a esta área. Peça ao administrador para revisar suas permissões.",
            },
          },
          { status: 403 },
        );
      }
      return NextResponse.redirect(new URL("/403", request.url));
    }
  }

  // EPIC-11 S-11.07: validate impersonate cookie on /app/* paths. Middleware
  // runs in Edge — no DB access, only HMAC + expiry. On any failure we delete
  // the presentation cookie. The database support session remains authoritative:
  // expired/revoked support still blocks the app until explicit exit.
  if (pathname.startsWith("/app")) {
    const impCookie = request.cookies.get(IMPERSONATE_COOKIE_NAME_EDGE)?.value;
    if (impCookie) {
      const result = await verifyImpersonateCookieEdge(
        impCookie,
        env.IMPERSONATE_COOKIE_SECRET ?? "",
      );
      if (!result.valid) {
        console.warn(
          `[middleware] impersonate cookie invalid (${result.reason ?? "unknown"}) — clearing`,
        );
        response.cookies.delete(IMPERSONATE_COOKIE_NAME_EDGE);
      }
    }
  }

  // /admin/* additionally requires platform_admin (early gate — authoritative
  // check is server-side in `requirePlatformAdmin`). Skip the RPC for
  // `/admin/forbidden` (rendered to non-admins, would otherwise loop).
  if (isAdminSurface && pathname.startsWith("/admin") && pathname !== "/admin/forbidden") {
    const { data: isAdmin, error } = await supabase.rpc("fn_is_platform_admin");
    if (error || !isAdmin) {
      return NextResponse.redirect(new URL("/admin/forbidden", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all paths except static assets / Next internals.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
