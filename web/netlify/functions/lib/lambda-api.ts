import type { LambdaInstanceType, LambdaInstance, LambdaApiError } from "./types.js";
import { getSettings } from "./blobs.js";

const API_BASE = "https://cloud.lambdalabs.com/api/v1";

async function getApiKey(): Promise<string> {
  const settings = await getSettings();
  if (settings?.lambdaApiKey) return settings.lambdaApiKey;
  const key = process.env.LAMBDA_API_KEY;
  if (!key) throw new Error("LAMBDA_API_KEY not configured");
  return key;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const key = await getApiKey();
  const authHeader = "Basic " + Buffer.from(key + ":").toString("base64");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  return res;
}

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as LambdaApiError)?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

export async function getInstanceTypes(): Promise<Record<string, LambdaInstanceType>> {
  const res = await request("/instance-types");
  await assertOk(res);
  const body = await res.json();
  return (body as { data: Record<string, LambdaInstanceType> }).data;
}

export async function listInstances(): Promise<LambdaInstance[]> {
  const res = await request("/instances");
  await assertOk(res);
  const body = await res.json();
  return (body as { data: LambdaInstance[] }).data;
}

export async function getInstance(id: string): Promise<LambdaInstance> {
  const res = await request(`/instances/${encodeURIComponent(id)}`);
  await assertOk(res);
  const body = await res.json();
  return (body as { data: LambdaInstance }).data;
}

export async function listFilesystems(): Promise<
  Array<{ id: string; name: string; region: { name: string }; is_in_use: boolean; bytes_used: number; created: string }>
> {
  const res = await request("/file-systems");
  await assertOk(res);
  const body = await res.json();
  return (body as { data: Array<{ id: string; name: string; region: { name: string }; is_in_use: boolean; bytes_used: number; created: string }> }).data;
}

export async function deleteFilesystem(id: string): Promise<void> {
  const res = await request(`/file-systems/${encodeURIComponent(id)}`, { method: "DELETE" });
  await assertOk(res);
}

export async function createFilesystem(
  name: string,
  region: string,
): Promise<{ id: string; name: string }> {
  const res = await request("/filesystems", {
    method: "POST",
    body: JSON.stringify({ name, region }),
  });
  await assertOk(res);
  const body = await res.json();
  return (body as { data: { id: string; name: string } }).data;
}

export async function launchInstance(params: {
  instance_type_name: string;
  region_name: string;
  ssh_key_names: string[];
  file_system_names?: string[];
  quantity?: number;
  name?: string;
  user_data?: string;
}): Promise<{ instance_ids: string[] }> {
  const res = await request("/instance-operations/launch", {
    method: "POST",
    body: JSON.stringify({ ...params, quantity: params.quantity ?? 1 }),
  });
  await assertOk(res);
  const body = await res.json();
  return (body as { data: { instance_ids: string[] } }).data;
}

export async function terminateInstances(instanceIds: string[]): Promise<void> {
  const res = await request("/instance-operations/terminate", {
    method: "POST",
    body: JSON.stringify({ instance_ids: instanceIds }),
  });
  await assertOk(res);
}

export async function restartInstances(instanceIds: string[]): Promise<void> {
  const res = await request("/instance-operations/restart", {
    method: "POST",
    body: JSON.stringify({ instance_ids: instanceIds }),
  });
  await assertOk(res);
}

export async function listSshKeys(): Promise<Array<{ id: string; name: string; public_key: string }>> {
  const res = await request("/ssh-keys");
  await assertOk(res);
  const body = await res.json();
  return (body as { data: Array<{ id: string; name: string; public_key: string }> }).data;
}

export async function addSshKey(name: string, publicKey: string): Promise<{ id: string; name: string }> {
  const res = await request("/ssh-keys", {
    method: "POST",
    body: JSON.stringify({ name, public_key: publicKey }),
  });
  await assertOk(res);
  const body = await res.json();
  return (body as { data: { id: string; name: string } }).data;
}

export async function deleteSshKey(id: string): Promise<void> {
  const res = await request(`/ssh-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  await assertOk(res);
}

export async function testApiKey(key: string): Promise<void> {
  const authHeader = "Basic " + Buffer.from(key + ":").toString("base64");
  const res = await fetch(`${API_BASE}/instance-types`, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  await assertOk(res);
}
