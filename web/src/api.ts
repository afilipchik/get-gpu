import type { User, GpuType, VMRecord, Candidate, AdminSettings, FilesystemRecord, LaunchRequest } from "./types";

let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(_authToken ? { Authorization: `Bearer ${_authToken}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// Auth
export const fetchProfile = () => request<User>("/api/auth/me");

// GPU Types
export const fetchGpuTypes = () => request<{ types: GpuType[]; allRegions: string[] }>("/api/gpu-types");

// VMs
export const fetchVMs = () => request<VMRecord[]>("/api/vms");

export const launchVM = (params: { instanceType: string; region: string; sshPublicKey: string; attachFilesystem?: boolean }) =>
  request<VMRecord>("/api/vms/launch", {
    method: "POST",
    body: JSON.stringify(params),
  });

export const terminateVM = (instanceId: string) =>
  request<VMRecord>("/api/vms/terminate", {
    method: "POST",
    body: JSON.stringify({ instanceId }),
  });

export const restartVM = (instanceId: string) =>
  request<VMRecord>("/api/vms/restart", {
    method: "POST",
    body: JSON.stringify({ instanceId }),
  });

// Filesystems
export const fetchFilesystems = () => request<FilesystemRecord[]>("/api/filesystems");

export const deleteFilesystem = (id: string) =>
  request<{ ok: boolean }>(`/api/admin/filesystems?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

// Admin
export const fetchCandidates = () => request<Candidate[]>("/api/admin/candidates");

export const addCandidate = (params: { email: string; name: string; role?: string; quotaDollars?: number }) =>
  request<Candidate>("/api/admin/candidates", {
    method: "POST",
    body: JSON.stringify(params),
  });

export const removeCandidate = (email: string) =>
  request<{ ok: boolean }>(`/api/admin/candidates?email=${encodeURIComponent(email)}`, {
    method: "DELETE",
  });

export const setQuota = (email: string, quotaDollars: number) =>
  request<Candidate>("/api/admin/quota", {
    method: "POST",
    body: JSON.stringify({ email, quotaDollars }),
  });

// Settings
export const fetchSettings = () => request<AdminSettings>("/api/admin/settings");

export const updateSettings = (settings: AdminSettings & { testConnection?: boolean }) =>
  request<AdminSettings>("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });

export const fetchSetupScript = () =>
  request<{ setupScript: string }>("/api/settings/setup-script");

// Launch Requests
export const fetchLaunchRequests = () => request<LaunchRequest[]>("/api/launch-requests");

export const createLaunchRequest = (params: {
  instanceTypes: string[];
  regions: string[];
  sshPublicKey: string;
  attachFilesystem?: boolean;
}) =>
  request<LaunchRequest>("/api/launch-requests", {
    method: "POST",
    body: JSON.stringify(params),
  });

export const cancelLaunchRequest = (id: string) =>
  request<LaunchRequest>("/api/launch-requests/cancel", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

