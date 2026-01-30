export interface User {
  email: string;
  name: string;
  role: "candidate" | "admin";
  quotaDollars: number;
  spentCents: number;
}

export interface GpuType {
  name: string;
  description: string;
  priceCentsPerHour: number;
  regions: string[];
}

export interface VMRecord {
  instanceId: string;
  candidateEmail: string;
  instanceType: string;
  region: string;
  priceCentsPerHour: number;
  launchedAt: string;
  status: string;
  ipAddress: string | null;
  jupyterUrl: string | null;
  sshKeyName: string;
  terminatedAt: string | null;
  terminationReason: string | null;
  lastCheckedAt: string;
  accruedCents: number;
}

export interface Candidate {
  email: string;
  name: string;
  role: "candidate" | "admin";
  quotaDollars: number;
  spentCents: number;
  addedAt: string;
  addedBy: string;
}

export interface FilesystemRecord {
  id: string;
  name: string;
  region: string;
  is_in_use: boolean;
  bytes_used: number;
  created: string;
}

export interface ApiError {
  error: string;
}

export interface AdminSettings {
  lambdaApiKey?: string;
  setupScript?: string;
}
