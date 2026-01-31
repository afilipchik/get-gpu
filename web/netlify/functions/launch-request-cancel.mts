import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { getLaunchRequest, putLaunchRequest } from "./lib/blobs.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { candidate } = user!;

  let body: { id: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.id) {
    return json({ error: "Missing id" }, 400);
  }

  const lr = await getLaunchRequest(body.id);
  if (!lr) {
    return json({ error: "Launch request not found" }, 404);
  }

  // Candidates can only cancel their own requests
  if (candidate.role !== "admin" && lr.candidateEmail !== candidate.email) {
    return json({ error: "Forbidden" }, 403);
  }

  if (lr.status !== "queued") {
    return json({ error: `Cannot cancel a request with status "${lr.status}"` }, 400);
  }

  lr.status = "cancelled";
  lr.cancelledAt = new Date().toISOString();
  await putLaunchRequest(lr);

  return json(lr);
};

export const config = { path: "/api/launch-requests/cancel" };
