import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { getSettings, putSettings } from "./lib/blobs.js";
import { testApiKey } from "./lib/lambda-api.js";
import type { AdminSettings, DefaultFilesystem } from "./lib/types.js";

function maskApiKey(key: string): string {
  if (key.length <= 4) return "****";
  return "***" + key.slice(-4);
}

/** Migrate old settings format (defaultFilesystemNames + gcsServiceAccountJson) to new (defaultFilesystems). */
function migrateSettings(settings: any): AdminSettings {
  if (settings.defaultFilesystemNames && !settings.defaultFilesystems) {
    settings.defaultFilesystems = (settings.defaultFilesystemNames as string[]).map((name: string) => ({
      name,
      sourceType: "gcs" as const,
      sourceUrl: "",
      credentials: settings.gcsServiceAccountJson ?? "",
    }));
    delete settings.defaultFilesystemNames;
    delete settings.gcsServiceAccountJson;
  }
  return settings as AdminSettings;
}

function maskSettings(settings: AdminSettings): AdminSettings {
  const masked: AdminSettings = {
    ...settings,
    lambdaApiKey: settings.lambdaApiKey ? maskApiKey(settings.lambdaApiKey) : undefined,
  };
  if (masked.defaultFilesystems) {
    masked.defaultFilesystems = masked.defaultFilesystems.map((fs) => ({
      ...fs,
      credentials: fs.credentials ? "***" : "",
    }));
  }
  return masked;
}

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  if (request.method === "GET") {
    const raw = (await getSettings()) ?? {};
    const settings = migrateSettings(raw);
    return json(maskSettings(settings));
  }

  if (request.method === "PUT") {
    let body: AdminSettings & { testConnection?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const raw = (await getSettings()) ?? {};
    const existing = migrateSettings(raw);
    const updated: AdminSettings = { ...existing };

    // Handle API key: if masked value sent back, keep existing
    if (body.lambdaApiKey !== undefined) {
      if (body.lambdaApiKey && !body.lambdaApiKey.startsWith("***")) {
        updated.lambdaApiKey = body.lambdaApiKey;
      }
    }

    if (body.setupScript !== undefined) {
      updated.setupScript = body.setupScript;
    }

    // Handle default filesystems
    if (body.defaultFilesystems !== undefined) {
      const incoming = body.defaultFilesystems ?? [];
      const existingFs = existing.defaultFilesystems ?? [];

      updated.defaultFilesystems = incoming.map((fs: DefaultFilesystem) => {
        // If credentials are masked, preserve existing credentials for this filesystem
        if (fs.credentials === "***") {
          const prev = existingFs.find((e) => e.name === fs.name);
          return { ...fs, credentials: prev?.credentials ?? "" };
        }
        return fs;
      });
    }

    // Handle seed complete secret (auto-generate if not set)
    if (body.seedCompleteSecret !== undefined) {
      updated.seedCompleteSecret = body.seedCompleteSecret;
    } else if (!updated.seedCompleteSecret) {
      updated.seedCompleteSecret = crypto.randomUUID();
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
    return json(maskSettings(updated));
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/admin/settings" };
