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
    return null;
  }

  const token = authHeader.slice(7);

  const audience = process.env.AUTH0_AUDIENCE;
  if (!audience) {
    console.error("[auth] AUTH0_AUDIENCE env var not set");
    return null;
  }

  let issuer: string;
  try {
    issuer = getIssuer();
  } catch {
    console.error("[auth] AUTH0_ISSUER_BASE_URL not configured");
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, getJWKS(), {
      issuer,
      audience,
    });
    payload = result.payload as Record<string, unknown>;
  } catch {
    return null;
  }

  const email = (payload.email as string) ??
    (payload["https://get-gpu.netlify.app/email"] as string);
  const name = (payload.name as string) ??
    (payload["https://get-gpu.netlify.app/name"] as string) ??
    email;

  if (!email) {
    return null;
  }

  let candidate = await getCandidate(email);

  if (!candidate && isAdminEmail(email)) {
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
    return null;
  }

  if (candidate.deactivatedAt) {
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
  return admins.includes(email.toLowerCase());
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
