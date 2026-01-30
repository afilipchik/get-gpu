import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { listVMs, listVMsByEmail, putVM } from "./lib/blobs.js";
import { getInstance } from "./lib/lambda-api.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { candidate } = user!;

  // Admins see all VMs, candidates see only their own
  const vms = candidate.role === "admin" ? await listVMs() : await listVMsByEmail(candidate.email);

  // Refresh status for active/launching VMs from Lambda API
  const activeVMs = vms.filter((vm) => !vm.terminatedAt);
  for (const vm of activeVMs) {
    try {
      const instance = await getInstance(vm.instanceId);
      const updated = { ...vm };
      let changed = false;

      if (instance.status !== vm.status) {
        updated.status = instance.status;
        changed = true;
      }
      if (instance.ip && instance.ip !== vm.ipAddress) {
        updated.ipAddress = instance.ip;
        changed = true;
      }
      const jupyterUrl = instance.jupyter_url ?? null;
      if (jupyterUrl && jupyterUrl !== vm.jupyterUrl) {
        updated.jupyterUrl = jupyterUrl;
        changed = true;
      }
      // If instance is terminated on Lambda side but not in our records
      if (instance.status === "terminated" && !vm.terminatedAt) {
        updated.terminatedAt = new Date().toISOString();
        updated.terminationReason = "terminated_externally";
        changed = true;
      }
      if (changed) {
        updated.lastCheckedAt = new Date().toISOString();
        await putVM(updated);
        Object.assign(vm, updated);
      }
    } catch {
      // Instance might not exist anymore
      if (!vm.terminatedAt) {
        vm.status = "unknown";
        vm.terminatedAt = new Date().toISOString();
        vm.terminationReason = "not_found";
        vm.lastCheckedAt = new Date().toISOString();
        await putVM(vm);
      }
    }
  }

  return json(vms);
};

export const config = { path: "/api/vms" };
