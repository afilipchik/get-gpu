import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { getSettings } from "./lib/blobs.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  const settings = await getSettings();
  return json({ setupScript: settings?.setupScript ?? "" });
};

export const config = { path: "/api/settings/setup-script" };
