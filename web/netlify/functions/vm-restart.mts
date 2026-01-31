import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { getVM, putVM } from "./lib/blobs.js";
import { restartInstances } from "./lib/lambda-api.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { candidate } = user!;

  let body: { instanceId: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.instanceId) {
    return json({ error: "Missing instanceId" }, 400);
  }

  const vm = await getVM(body.instanceId);
  if (!vm) {
    return json({ error: "VM not found" }, 404);
  }

  // Candidates can only restart their own VMs
  if (candidate.role !== "admin" && vm.candidateEmail !== candidate.email) {
    return json({ error: "Forbidden" }, 403);
  }

  if (vm.terminatedAt) {
    return json({ error: "Cannot restart a terminated VM" }, 400);
  }

  try {
    await restartInstances([vm.instanceId]);

    vm.status = "restarting";
    vm.lastCheckedAt = new Date().toISOString();

    await putVM(vm);

    return json(vm);
  } catch (err: any) {
    console.error("Restart failed:", err.message);
    return json({ error: "Restart failed. Please try again." }, 500);
  }
};

export const config = { path: "/api/vms/restart" };
