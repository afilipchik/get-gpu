import type { Context } from "@netlify/functions";
import { json } from "./lib/auth.js";
import { getSeedStatus, putSeedStatus, getSettings } from "./lib/blobs.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);

  const settings = await getSettings();
  if (!settings?.seedCompleteSecret || token !== settings.seedCompleteSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { filesystemName: string; region: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.filesystemName || !body.region) {
    return json({ error: "Missing filesystemName or region" }, 400);
  }

  const status = await getSeedStatus(body.filesystemName, body.region);
  if (!status) {
    return json({ error: "No seed status found" }, 404);
  }

  if (status.status === "ready") {
    return json({ ok: true, message: "Already marked as ready" });
  }

  status.status = "ready";
  status.completedAt = new Date().toISOString();
  await putSeedStatus(status);

  console.log(`Seed complete: ${body.filesystemName} in ${body.region}`);
  return json({ ok: true });
};

export const config = { path: "/api/seed-complete" };
