import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { listCandidates, getCandidate, putCandidate, computeSpentCents, listVMsByEmail, putVM, deleteSshKeyRecord, listLaunchRequestsByEmail, putLaunchRequest } from "./lib/blobs.js";
import { terminateInstances, listSshKeys, deleteSshKey } from "./lib/lambda-api.js";
import type { CandidateRecord } from "./lib/types.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  const { candidate: admin } = user!;

  if (request.method === "GET") {
    const candidates = await listCandidates();
    const withSpent = await Promise.all(
      candidates.map(async (c) => ({
        ...c,
        spentCents: await computeSpentCents(c.email, c.spentResetAt),
      }))
    );
    return json(withSpent);
  }

  if (request.method === "POST") {
    let body: { email: string; name: string; role?: string; quotaDollars?: number };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.email || !body.name) {
      return json({ error: "Missing email or name" }, 400);
    }

    const email = body.email.toLowerCase().trim();
    const existing = await getCandidate(email);

    // Reactivation: if the candidate was deactivated, reset spending so
    // old VMs don't count toward the fresh quota.
    const isNew = !existing;
    const isReactivation = existing?.deactivatedAt != null;
    const resetSpending = isNew || isReactivation;
    const record: CandidateRecord = {
      email,
      name: body.name,
      role: (body.role as "candidate" | "admin") ?? "candidate",
      quotaDollars: body.quotaDollars ?? 50,
      spentCents: resetSpending ? 0 : existing.spentCents,
      addedAt: resetSpending ? new Date().toISOString() : existing.addedAt,
      addedBy: resetSpending ? admin.email : existing.addedBy,
      spentResetAt: resetSpending ? new Date().toISOString() : existing.spentResetAt,
      // Clear deactivatedAt on create or reactivation
      deactivatedAt: resetSpending ? undefined : existing.deactivatedAt,
    };

    await putCandidate(record);
    return json(record, isNew ? 201 : 200);
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");
    if (!email) {
      return json({ error: "Missing email query parameter" }, 400);
    }

    const existing = await getCandidate(email.toLowerCase());
    if (!existing) {
      return json({ error: "Candidate not found" }, 404);
    }
    if (existing.deactivatedAt) {
      return json({ error: "Candidate is already deactivated" }, 400);
    }

    // Prevent deleting yourself
    if (existing.email === admin.email) {
      return json({ error: "Cannot delete your own account" }, 400);
    }

    // Terminate all active VMs for this candidate
    const candidateVMs = await listVMsByEmail(email.toLowerCase());
    const activeVMs = candidateVMs.filter((vm) => !vm.terminatedAt);
    if (activeVMs.length > 0) {
      const instanceIds = activeVMs.map((vm) => vm.instanceId);
      try {
        await terminateInstances(instanceIds);
      } catch (err: any) {
        console.error(`Failed to terminate instances for ${email}: ${err.message}`);
      }
      for (const vm of activeVMs) {
        vm.status = "terminated";
        vm.terminatedAt = new Date().toISOString();
        vm.terminationReason = "account_removed";
        const launchedAt = new Date(vm.launchedAt).getTime();
        const minutesElapsed = Math.ceil((Date.now() - launchedAt) / (1000 * 60));
        vm.accruedCents = Math.ceil(minutesElapsed * (vm.priceCentsPerHour / 60));
        await putVM(vm);
      }
    }

    // Clean up SSH keys
    try {
      const lambdaKeys = await listSshKeys();
      const sanitized = email.toLowerCase().replace(/[^a-z0-9]/gi, "-");
      const keyName = `web-${sanitized}`;
      const key = lambdaKeys.find((k) => k.name === keyName);
      if (key) await deleteSshKey(key.id);
      await deleteSshKeyRecord(email.toLowerCase(), keyName);
    } catch (err: any) {
      console.error(`Failed to delete SSH key for ${email}: ${err.message}`);
    }

    // Cancel any queued launch requests
    const launchRequests = await listLaunchRequestsByEmail(email.toLowerCase());
    for (const lr of launchRequests) {
      if (lr.status === "queued" || lr.status === "provisioning") {
        lr.status = "cancelled";
        lr.cancelledAt = new Date().toISOString();
        lr.failureReason = "candidate_deactivated";
        await putLaunchRequest(lr);
      }
    }

    // Soft-delete: mark as deactivated instead of removing the record
    // Note: filesystems are intentionally preserved — they may contain important data.
    // Admins can delete them explicitly via the UI.
    existing.deactivatedAt = new Date().toISOString();
    existing.quotaDollars = 0;
    await putCandidate(existing);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/admin/candidates" };
