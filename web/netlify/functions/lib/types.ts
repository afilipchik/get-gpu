export interface CandidateRecord {
  email: string;
  name: string;
  role: "candidate" | "admin";
  quotaDollars: number;
  spentCents: number;
  addedAt: string;
  addedBy: string;
  /** When set, only VMs launched at or after this ISO timestamp count toward spending. */
  spentResetAt?: string;
  /** When set, the account is deactivated. Resources are terminated and login is blocked. */
  deactivatedAt?: string;
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

export interface SshKeyRecord {
  keyName: string;
  candidateEmail: string;
  publicKey: string;
  registeredAt: string;
}

// Lambda Labs API response types
export interface LambdaInstanceType {
  instance_type: {
    name: string;
    price_cents_per_hour: number;
    description: string;
  };
  regions_with_capacity_available: Array<{ name: string; description: string }>;
}

export interface LambdaInstance {
  id: string;
  name: string | null;
  status: string;
  ip: string | null;
  jupyter_url: string | null;
  jupyter_token: string | null;
  instance_type: { name: string };
  region: { name: string };
}

export interface LambdaApiError {
  error: { message: string };
}

export interface LaunchRequest {
  id: string;
  candidateEmail: string;
  instanceTypes: string[];
  regions: string[];
  sshPublicKey: string;
  attachFilesystem: boolean;
  status: "queued" | "provisioning" | "fulfilled" | "cancelled" | "failed";
  createdAt: string;
  fulfilledAt: string | null;
  fulfilledInstanceId: string | null;
  failureReason: string | null;
  cancelledAt: string | null;
  attempts: number;
  lastAttemptAt: string | null;
}

export interface DefaultFilesystem {
  name: string;
  sourceType: "gcs" | "r2";
  sourceUrl: string;
  credentials: string;
  /** Custom download script. When set, replaces the default download command.
   *  Available env vars: $NFS_PATH (target directory), $CREDS_FILE (path to credentials file). */
  downloadScript?: string;
}

export interface FilesystemSeedStatus {
  filesystemName: string;
  region: string;
  status: "seeding" | "ready";
  seedingInstanceId?: string;
  claimedAt: string;
  completedAt?: string;
}

export interface AdminSettings {
  lambdaApiKey?: string;
  setupScript?: string;
  defaultFilesystems?: DefaultFilesystem[];
  seedCompleteSecret?: string;
}
