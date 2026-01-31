import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { getSettings, putSettings } from "./lib/blobs.js";
import { testApiKey } from "./lib/lambda-api.js";
import type { AdminSettings } from "./lib/types.js";

function maskApiKey(key: string): string {
  if (key.length <= 4) return "****";
  return "***" + key.slice(-4);
}

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  if (request.method === "GET") {
    const settings = (await getSettings()) ?? {};
    const masked: AdminSettings = {
      ...settings,
      lambdaApiKey: settings.lambdaApiKey ? maskApiKey(settings.lambdaApiKey) : undefined,
    };
    return json(masked);
  }

  if (request.method === "PUT") {
    let body: AdminSettings & { testConnection?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const existing = (await getSettings()) ?? {};
    const updated: AdminSettings = { ...existing };

    // Handle API key: if masked value sent back, keep existing
    if (body.lambdaApiKey !== undefined) {
      if (body.lambdaApiKey && !body.lambdaApiKey.startsWith("***")) {
        updated.lambdaApiKey = body.lambdaApiKey;
      }
      // If starts with ***, keep existing value (user didn't change it)
    }

    // Handle setup script
    if (body.setupScript !== undefined) {
      updated.setupScript = body.setupScript;
    }

    // Test connection if requested
    if (body.testConnection) {
      const keyToTest = updated.lambdaApiKey ?? process.env.LAMBDA_API_KEY;
      if (!keyToTest) {
        return json({ error: "No API key configured" }, 400);
      }
      try {
        await testApiKey(keyToTest);
      } catch (err: any) {
        console.error("API key test failed:", err.message);
        return json({ error: "API key test failed. Verify the key is correct." }, 400);
      }
    }

    await putSettings(updated);

    const masked: AdminSettings = {
      ...updated,
      lambdaApiKey: updated.lambdaApiKey ? maskApiKey(updated.lambdaApiKey) : undefined,
    };
    return json(masked);
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/admin/settings" };
