import { getSeedStatus, claimSeedingLock } from "./blobs.js";
import { listFilesystems, createFilesystem } from "./lambda-api.js";
import { generateSeedingScript } from "./seeding-script.js";
import type { AdminSettings } from "./types.js";

export interface ResolvedFilesystems {
  /** All filesystem names to attach to the user's VM */
  fileSystemNames: string[];
  /** Loader VMs that need to be launched for seeding */
  loaderVMs: Array<{
    filesystemName: string;
    seedScript: string;
    region: string;
  }>;
  /** Bash snippet to append to user's user_data for readonly remount */
  readonlyRemountScript: string;
}

export async function resolveFilesystems(params: {
  region: string;
  candidateEmail: string;
  attachPersonalFilesystem: boolean;
  settings: AdminSettings | null;
  appUrl: string;
}): Promise<ResolvedFilesystems> {
  const { region, candidateEmail, attachPersonalFilesystem, settings, appUrl } = params;

  const fileSystemNames: string[] = [];
  const loaderVMs: ResolvedFilesystems["loaderVMs"] = [];
  const readonlyMounts: string[] = [];

  console.log(`[resolveFS] region=${region} email=${candidateEmail} attachPersonal=${attachPersonalFilesystem} defaultFS=${settings?.defaultFilesystems?.length ?? 0}`);

  const existingFilesystems = await listFilesystems();
  console.log(`[resolveFS] existing filesystems: ${existingFilesystems.map(f => `${f.name}@${f.region.name}`).join(", ") || "none"}`);

  // 1. User's personal filesystem (read-write)
  if (attachPersonalFilesystem) {
    const sanitized = candidateEmail.replace(/[^a-zA-Z0-9]/g, "-");
    const fsName = `fs-${sanitized}-${region}`.replace(/--+/g, "-").slice(0, 60);
    const match = existingFilesystems.find((f) => f.name === fsName && f.region.name === region);

    if (match) {
      console.log(`[resolveFS] personal FS ${fsName} already exists`);
      fileSystemNames.push(match.name);
    } else {
      try {
        console.log(`[resolveFS] creating personal FS ${fsName} in ${region}`);
        const created = await createFilesystem(fsName, region);
        console.log(`[resolveFS] created personal FS: ${created.name}`);
        fileSystemNames.push(created.name);
      } catch (err: any) {
        console.error(`[resolveFS] Failed to create personal filesystem ${fsName}:`, err.message);
      }
    }
  }

  // 2. Default shared filesystems (read-only)
  if (settings?.defaultFilesystems) {
    const callbackUrl = `${appUrl}/api/seed-complete`;
    const callbackSecret = settings.seedCompleteSecret ?? "";

    for (const dfs of settings.defaultFilesystems) {
      console.log(`[resolveFS] checking default FS "${dfs.name}" in region ${region}`);
      const match = existingFilesystems.find((f) => f.name === dfs.name && f.region.name === region);

      if (match) {
        // FS exists — attach and remount readonly
        console.log(`[resolveFS] default FS "${dfs.name}" exists in ${region}, attaching readonly`);
        if (!fileSystemNames.includes(match.name)) {
          fileSystemNames.push(match.name);
        }
        readonlyMounts.push(`sudo mount -o remount,ro /lambda/nfs/${dfs.name} 2>/dev/null || true`);
      } else {
        // FS doesn't exist — create, claim seed lock, queue loader VM
        try {
          console.log(`[resolveFS] creating default FS "${dfs.name}" in ${region}`);
          const created = await createFilesystem(dfs.name, region);
          console.log(`[resolveFS] created default FS: ${created.name}`);
          fileSystemNames.push(created.name);

          // Try to claim seeding rights
          const claimId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const claimed = await claimSeedingLock(dfs.name, region, claimId);

          if (claimed) {
            const seedScript = generateSeedingScript({
              sourceType: dfs.sourceType,
              sourceUrl: dfs.sourceUrl,
              credentials: dfs.credentials,
              filesystemName: dfs.name,
              callbackUrl,
              callbackSecret,
              region,
              downloadScript: dfs.downloadScript,
            });

            loaderVMs.push({
              filesystemName: dfs.name,
              seedScript,
              region,
            });
          }

          // User VM gets readonly mount regardless
          readonlyMounts.push(`sudo mount -o remount,ro /lambda/nfs/${dfs.name} 2>/dev/null || true`);
        } catch (err: any) {
          console.error(`[resolveFS] Failed to create/seed filesystem ${dfs.name} in ${region}:`, err.message);
        }
      }
    }
  }

  const readonlyRemountScript = readonlyMounts.length > 0
    ? readonlyMounts.join("\n")
    : "";

  console.log(`[resolveFS] result: attach=[${fileSystemNames.join(",")}] loaders=${loaderVMs.length} readonlyMounts=${readonlyMounts.length}`);
  return { fileSystemNames, loaderVMs, readonlyRemountScript };
}
