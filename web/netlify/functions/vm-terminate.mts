import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { getVM, putVM, getCandidate, putCandidate, computeSpentCents, listVMsByEmail, deleteSshKeyRecord } from "./lib/blobs.js";
import { terminateInstances, listSshKeys, deleteSshKey } from "./lib/lambda-api.js";

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

  // Candidates can only terminate their own VMs
  if (candidate.role !== "admin" && vm.candidateEmail !== candidate.email) {
    return json({ error: "Forbidden" }, 403);
  }

  if (vm.terminatedAt) {
    return json({ error: "VM already terminated" }, 400);
  }

  try {
    await terminateInstances([vm.instanceId]);

    vm.status = "terminated";
    vm.terminatedAt = new Date().toISOString();
    vm.terminationReason = candidate.role === "admin" ? "admin_terminated" : "user_terminated";
    vm.lastCheckedAt = new Date().toISOString();

    // Calculate final accrued cost (per-minute billing)
    const launchedAt = new Date(vm.launchedAt).getTime();
    const now = Date.now();
    const minutesElapsed = Math.ceil((now - launchedAt) / (1000 * 60));
    vm.accruedCents = Math.ceil(minutesElapsed * (vm.priceCentsPerHour / 60));

    await putVM(vm);

    // Update candidate's spentCents
    const fresh = await getCandidate(vm.candidateEmail);
    if (fresh) {
      fresh.spentCents = await computeSpentCents(vm.candidateEmail, fresh.spentResetAt);
      await putCandidate(fresh);
    }

    // Delete SSH key if candidate has no remaining active VMs
    const candidateVMs = await listVMsByEmail(vm.candidateEmail);
    const hasActiveVMs = candidateVMs.some((v) => v.instanceId !== vm.instanceId && !v.terminatedAt);
    if (!hasActiveVMs) {
      try {
        const lambdaKeys = await listSshKeys();
        const key = lambdaKeys.find((k) => k.name === vm.sshKeyName);
        if (key) await deleteSshKey(key.id);
        await deleteSshKeyRecord(vm.candidateEmail, vm.sshKeyName);
      } catch (keyErr: any) {
        console.error(`Failed to delete SSH key: ${keyErr.message}`);
      }
    }

    return json(vm);
  } catch (err: any) {
    return json({ error: `Terminate failed: ${err.message}` }, 500);
  }
};

export const config = { path: "/api/vms/terminate" };
