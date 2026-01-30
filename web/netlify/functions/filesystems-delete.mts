import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { deleteFilesystem } from "./lib/lambda-api.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return json({ error: "Missing id query parameter" }, 400);
  }

  try {
    await deleteFilesystem(id);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: `Failed to delete filesystem: ${err.message}` }, 500);
  }
};

export const config = { path: "/api/admin/filesystems" };
