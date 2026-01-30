import { createRemoteJWKSet, jwtVerify } from "jose";
import { getCandidate, putCandidate } from "./blobs.js";
import type { CandidateRecord } from "./types.js";

export interface AuthenticatedUser {
  email: string;
  name: string;
  candidate: CandidateRecord;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getIssuer(): string {
  const base = process.env.AUTH0_ISSUER_BASE_URL;
  if (!base) throw new Error("AUTH0_ISSUER_BASE_URL not configured");
  return base.endsWith("/") ? base : `${base}/`;
}

function getJWKS() {
  if (!_jwks) {
    const issuer = getIssuer();
    _jwks = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
  }
  return _jwks;
}

export async function authenticate(request: Request): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    console.log("[auth] No Bearer token in Authorization header");
    return null;
  }

  const token = authHeader.slice(7);

  const audience = process.env.AUTH0_AUDIENCE;
  if (!audience) {
    console.log("[auth] AUTH0_AUDIENCE env var not set");
    return null;
  }

  let issuer: string;
  try {
    issuer = getIssuer();
  } catch (err: any) {
    console.log("[auth] Failed to get issuer:", err.message);
    return null;
  }

  console.log("[auth] Verifying JWT with issuer:", issuer, "audience:", audience);

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, getJWKS(), {
      issuer,
      audience,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err: any) {
    console.log("[auth] JWT verification failed:", err.message);
    return null;
  }

  console.log("[auth] JWT payload claims:", Object.keys(payload).join(", "));

  const email = (payload.email as string) ??
    (payload["https://get-gpu.netlify.app/email"] as string);
  const name = (payload.name as string) ??
    (payload["https://get-gpu.netlify.app/name"] as string) ??
    email;

  if (!email) {
    console.log("[auth] No email found in JWT payload");
    return null;
  }

  console.log("[auth] Authenticated email:", email);

  let candidate = await getCandidate(email);

  if (!candidate && isAdminEmail(email)) {
    console.log("[auth] Auto-bootstrapping admin for:", email);
    candidate = {
      email,
      name,
      role: "admin",
      quotaDollars: 9999,
      spentCents: 0,
      addedAt: new Date().toISOString(),
      addedBy: "system",
    };
    await putCandidate(candidate);
  }

  if (!candidate) {
    console.log("[auth] No candidate record found for:", email);
    return null;
  }

  return { email, name, candidate };
}

export function requireAuth(user: AuthenticatedUser | null): Response | null {
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export function requireAdmin(user: AuthenticatedUser): Response | null {
  if (user.candidate.role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export function isAdminEmail(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const admins = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  console.log("[auth] ADMIN_EMAILS raw:", JSON.stringify(raw), "parsed:", admins, "checking:", email.toLowerCase());
  return admins.includes(email.toLowerCase());
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
