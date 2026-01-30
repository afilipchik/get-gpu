import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { getCandidate, putCandidate } from "./lib/blobs.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  let body: { email: string; quotaDollars: number };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.email || body.quotaDollars == null) {
    return json({ error: "Missing email or quotaDollars" }, 400);
  }

  if (typeof body.quotaDollars !== "number" || body.quotaDollars < 0) {
    return json({ error: "quotaDollars must be a non-negative number" }, 400);
  }

  const candidate = await getCandidate(body.email.toLowerCase());
  if (!candidate) {
    return json({ error: "Candidate not found" }, 404);
  }

  candidate.quotaDollars = body.quotaDollars;
  await putCandidate(candidate);

  return json(candidate);
};

export const config = { path: "/api/admin/quota" };
