import { getStore } from "@netlify/blobs";
import type { CandidateRecord, VMRecord, SshKeyRecord, AdminSettings, LaunchRequest, FilesystemSeedStatus } from "./types.js";

function store(name: string) {
  return getStore({ name, consistency: "strong" });
}

// --- Candidates ---

export async function getCandidate(email: string): Promise<CandidateRecord | null> {
  const s = store("candidates");
  const data = await s.get(email, { type: "json" });
  return data as CandidateRecord | null;
}

export async function putCandidate(record: CandidateRecord): Promise<void> {
  const s = store("candidates");
  await s.setJSON(record.email, record);
}

export async function deleteCandidate(email: string): Promise<void> {
  const s = store("candidates");
  await s.delete(email);
}

export async function listCandidates(): Promise<CandidateRecord[]> {
  const s = store("candidates");
  const { blobs } = await s.list();
  const results: CandidateRecord[] = [];
  for (const blob of blobs) {
    const data = await s.get(blob.key, { type: "json" });
    if (data) results.push(data as CandidateRecord);
  }
  return results;
}

// --- VMs ---

export async function getVM(instanceId: string): Promise<VMRecord | null> {
  const s = store("vms");
  const data = await s.get(instanceId, { type: "json" });
  return data as VMRecord | null;
}

export async function putVM(record: VMRecord): Promise<void> {
  const s = store("vms");
  await s.setJSON(record.instanceId, record);
}

export async function listVMs(): Promise<VMRecord[]> {
  const s = store("vms");
  const { blobs } = await s.list();
  const results: VMRecord[] = [];
  for (const blob of blobs) {
    const data = await s.get(blob.key, { type: "json" });
    if (data) results.push(data as VMRecord);
  }
  return results;
}

export async function listVMsByEmail(email: string): Promise<VMRecord[]> {
  const all = await listVMs();
  return all.filter((vm) => vm.candidateEmail === email);
}

/** Compute real-time total spent cents for a candidate across all their VMs.
 *  Always calculates from timestamps to avoid stale stored values.
 *  If resetAfter is provided, only VMs launched at or after that time are counted
 *  (used to zero out spending when a candidate is re-added). */
export async function computeSpentCents(email: string, resetAfter?: string): Promise<number> {
  const vms = await listVMsByEmail(email);
  const cutoff = resetAfter ? new Date(resetAfter).getTime() : 0;
  let total = 0;
  for (const vm of vms) {
    const launchTime = new Date(vm.launchedAt).getTime();
    if (launchTime < cutoff) continue;
    const start = launchTime;
    const end = vm.terminatedAt ? new Date(vm.terminatedAt).getTime() : Date.now();
    const minutesElapsed = Math.ceil((end - start) / (1000 * 60));
    total += Math.ceil(minutesElapsed * (vm.priceCentsPerHour / 60));
  }
  return total;
}

// --- SSH Keys ---

export async function getSshKey(email: string, keyName: string): Promise<SshKeyRecord | null> {
  const s = store("ssh-keys");
  const data = await s.get(`${email}:${keyName}`, { type: "json" });
  return data as SshKeyRecord | null;
}

export async function putSshKey(record: SshKeyRecord): Promise<void> {
  const s = store("ssh-keys");
  await s.setJSON(`${record.candidateEmail}:${record.keyName}`, record);
}

export async function deleteSshKeyRecord(email: string, keyName: string): Promise<void> {
  const s = store("ssh-keys");
  await s.delete(`${email}:${keyName}`);
}

// --- Launch Requests ---

export async function getLaunchRequest(id: string): Promise<LaunchRequest | null> {
  const s = store("launch-requests");
  const data = await s.get(id, { type: "json" });
  return data as LaunchRequest | null;
}

export async function putLaunchRequest(record: LaunchRequest): Promise<void> {
  const s = store("launch-requests");
  await s.setJSON(record.id, record);
}

export async function deleteLaunchRequest(id: string): Promise<void> {
  const s = store("launch-requests");
  await s.delete(id);
}

export async function listLaunchRequests(): Promise<LaunchRequest[]> {
  const s = store("launch-requests");
  const { blobs } = await s.list();
  const results: LaunchRequest[] = [];
  for (const blob of blobs) {
    const data = await s.get(blob.key, { type: "json" });
    if (data) results.push(data as LaunchRequest);
  }
  return results;
}

export async function listLaunchRequestsByEmail(email: string): Promise<LaunchRequest[]> {
  const all = await listLaunchRequests();
  return all.filter((lr) => lr.candidateEmail === email);
}

export async function listQueuedLaunchRequests(): Promise<LaunchRequest[]> {
  const all = await listLaunchRequests();
  return all.filter((lr) => lr.status === "queued");
}

// --- Settings ---

export async function getSettings(): Promise<AdminSettings | null> {
  const s = store("settings");
  const data = await s.get("admin", { type: "json" });
  return data as AdminSettings | null;
}

export async function putSettings(settings: AdminSettings): Promise<void> {
  const s = store("settings");
  await s.setJSON("admin", settings);
}

// --- Filesystem Seed Status ---

function seedStatusKey(filesystemName: string, region: string): string {
  return `${filesystemName}:${region}`;
}

export async function getSeedStatus(
  filesystemName: string,
  region: string,
): Promise<FilesystemSeedStatus | null> {
  const s = store("seed-status");
  const data = await s.get(seedStatusKey(filesystemName, region), { type: "json" });
  return data as FilesystemSeedStatus | null;
}

export async function putSeedStatus(status: FilesystemSeedStatus): Promise<void> {
  const s = store("seed-status");
  await s.setJSON(seedStatusKey(status.filesystemName, status.region), status);
}

export async function deleteSeedStatus(
  filesystemName: string,
  region: string,
): Promise<void> {
  const s = store("seed-status");
  await s.delete(seedStatusKey(filesystemName, region));
}

export async function listSeedStatuses(): Promise<FilesystemSeedStatus[]> {
  const s = store("seed-status");
  const { blobs } = await s.list();
  const results: FilesystemSeedStatus[] = [];
  for (const blob of blobs) {
    const data = await s.get(blob.key, { type: "json" });
    if (data) results.push(data as FilesystemSeedStatus);
  }
  return results;
}

/**
 * Attempt to claim seeding rights for a filesystem+region.
 * Returns true if this caller won the claim, false if already claimed or ready.
 * Stale claims (older than staleMinutes) are automatically overridden.
 */
export async function claimSeedingLock(
  filesystemName: string,
  region: string,
  instanceId: string,
  staleMinutes = 60,
): Promise<boolean> {
  const existing = await getSeedStatus(filesystemName, region);

  if (existing) {
    if (existing.status === "ready") return false;
    const age = Date.now() - new Date(existing.claimedAt).getTime();
    if (age < staleMinutes * 60 * 1000) return false;
  }

  await putSeedStatus({
    filesystemName,
    region,
    status: "seeding",
    seedingInstanceId: instanceId,
    claimedAt: new Date().toISOString(),
  });
  return true;
}
