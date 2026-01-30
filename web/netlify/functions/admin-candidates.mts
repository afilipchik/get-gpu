import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { listCandidates, getCandidate, putCandidate, deleteCandidate, computeSpentCents } from "./lib/blobs.js";
import type { CandidateRecord } from "./lib/types.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  const { candidate: admin } = user!;

  if (request.method === "GET") {
    const candidates = await listCandidates();
    const withSpent = await Promise.all(
      candidates.map(async (c) => ({
        ...c,
        spentCents: await computeSpentCents(c.email),
      }))
    );
    return json(withSpent);
  }

  if (request.method === "POST") {
    let body: { email: string; name: string; role?: string; quotaDollars?: number };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.email || !body.name) {
      return json({ error: "Missing email or name" }, 400);
    }

    const email = body.email.toLowerCase().trim();
    const existing = await getCandidate(email);

    const record: CandidateRecord = {
      email,
      name: body.name,
      role: (body.role as "candidate" | "admin") ?? "candidate",
      quotaDollars: body.quotaDollars ?? 50,
      spentCents: existing?.spentCents ?? 0,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      addedBy: existing?.addedBy ?? admin.email,
    };

    await putCandidate(record);
    return json(record, existing ? 200 : 201);
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");
    if (!email) {
      return json({ error: "Missing email query parameter" }, 400);
    }

    const existing = await getCandidate(email.toLowerCase());
    if (!existing) {
      return json({ error: "Candidate not found" }, 404);
    }

    // Prevent deleting yourself
    if (existing.email === admin.email) {
      return json({ error: "Cannot delete your own account" }, 400);
    }

    await deleteCandidate(email.toLowerCase());
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/admin/candidates" };
