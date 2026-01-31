import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { computeSpentCents } from "./lib/blobs.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { candidate } = user!;
  const spentCents = await computeSpentCents(candidate.email, candidate.spentResetAt);

  return json({
    email: candidate.email,
    name: candidate.name,
    role: candidate.role,
    quotaDollars: candidate.quotaDollars,
    spentCents,
  });
};

export const config = { path: "/api/auth/me" };
