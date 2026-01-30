import { getStore } from "@netlify/blobs";
import type { CandidateRecord, VMRecord, SshKeyRecord, AdminSettings } from "./types.js";

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
 *  Always calculates from timestamps to avoid stale stored values. */
export async function computeSpentCents(email: string): Promise<number> {
  const vms = await listVMsByEmail(email);
  let total = 0;
  for (const vm of vms) {
    const start = new Date(vm.launchedAt).getTime();
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
