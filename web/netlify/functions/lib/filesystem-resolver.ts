import { listFilesystems, createFilesystem } from "./lambda-api.js";
import { generateSeedingScript } from "./seeding-script.js";
import type { AdminSettings } from "./types.js";

export interface ResolvedFilesystems {
  /** All filesystem names to attach to the user's VM */
  fileSystemNames: string[];
  /** Bash snippet to prepend to user_data for seeding + readonly remount */
  seedingScript: string;
}

export async function resolveFilesystems(params: {
  region: string;
  candidateEmail: string;
  attachPersonalFilesystem: boolean;
  settings: AdminSettings | null;
}): Promise<ResolvedFilesystems> {
  const { region, candidateEmail, attachPersonalFilesystem, settings } = params;

  const fileSystemNames: string[] = [];
  const seedingSnippets: string[] = [];

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

  // 2. Default shared filesystems (seeded on-VM, then read-only)
  if (settings?.defaultFilesystems) {
    for (const dfs of settings.defaultFilesystems) {
      console.log(`[resolveFS] checking default FS "${dfs.name}" in region ${region}`);
      const match = existingFilesystems.find((f) => f.name === dfs.name && f.region.name === region);

      if (match) {
        console.log(`[resolveFS] default FS "${dfs.name}" exists in ${region}`);
        if (!fileSystemNames.includes(match.name)) {
          fileSystemNames.push(match.name);
        }
      } else {
        try {
          console.log(`[resolveFS] creating default FS "${dfs.name}" in ${region}`);
          const created = await createFilesystem(dfs.name, region);
          console.log(`[resolveFS] created default FS: ${created.name}`);
          fileSystemNames.push(created.name);
        } catch (err: any) {
          console.error(`[resolveFS] Failed to create filesystem ${dfs.name} in ${region}:`, err.message);
          continue;
        }
      }

      // Generate seeding snippet — the script itself checks the lock file
      // and decides whether to seed, wait, or skip
      seedingSnippets.push(generateSeedingScript({
        sourceType: dfs.sourceType,
        sourceUrl: dfs.sourceUrl,
        credentials: dfs.credentials,
        filesystemName: dfs.name,
        downloadScript: dfs.downloadScript,
      }));
    }
  }

  const seedingScript = seedingSnippets.join("\n");

  console.log(`[resolveFS] result: attach=[${fileSystemNames.join(",")}] seedSnippets=${seedingSnippets.length}`);
  return { fileSystemNames, seedingScript };
}
