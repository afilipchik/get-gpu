import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { listSeedingJobs } from "./lib/blobs.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  const jobs = await listSeedingJobs();

  // Sort by creation date (newest first)
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return json(jobs);
};

export const config = { path: "/api/admin/seed-filesystem/jobs" };
