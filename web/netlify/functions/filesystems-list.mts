import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { listFilesystems } from "./lib/lambda-api.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { candidate } = user!;

  let filesystems;
  try {
    filesystems = await listFilesystems();
  } catch (err: any) {
    return json({ error: `Failed to list filesystems: ${err.message}` }, 500);
  }

  // Candidates only see filesystems whose name starts with their sanitized email prefix
  if (candidate.role !== "admin") {
    const sanitized = candidate.email.replace(/[^a-zA-Z0-9]/g, "-");
    const prefix = `fs-${sanitized}-`;
    filesystems = filesystems.filter((fs) => fs.name.startsWith(prefix));
  }

  const result = filesystems.map((fs) => ({
    id: fs.id,
    name: fs.name,
    region: fs.region.name,
    is_in_use: fs.is_in_use,
    bytes_used: fs.bytes_used,
    created: fs.created,
  }));

  return json(result);
};

export const config = { path: "/api/filesystems" };
