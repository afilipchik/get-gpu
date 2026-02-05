import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { getSettings, putSeedingJob } from "./lib/blobs.js";
import { listFilesystems, createFilesystem, launchInstance, addSshKey, listSshKeys } from "./lib/lambda-api.js";
import { generateSeedingScript } from "./lib/seeding-script.js";
import type { SeedingJob } from "./lib/types.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  const { candidate } = user!;

  let body: {
    sourceUrl: string;
    targetRegions: string[];
    filesystemName: string;
    instanceType: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.sourceUrl || !body.targetRegions || !body.filesystemName || !body.instanceType) {
    return json({ error: "Missing required fields: sourceUrl, targetRegions, filesystemName, instanceType" }, 400);
  }

  if (!body.sourceUrl.startsWith("gs://")) {
    return json({ error: "Only GCS sources (gs://) are supported currently" }, 400);
  }

  if (body.targetRegions.length === 0) {
    return json({ error: "At least one target region must be selected" }, 400);
  }

  // Get GCS credentials from admin settings
  const settings = await getSettings();
  if (!settings?.gcsServiceAccountJson) {
    return json({ error: "GCS service account JSON not configured in admin settings" }, 400);
  }

  const jobId = `seed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Initialize seeding job
  const job: SeedingJob = {
    id: jobId,
    createdAt: new Date().toISOString(),
    createdBy: candidate.email,
    status: "queued",
    sourceType: "gcs",
    sourceUrl: body.sourceUrl,
    targetRegions: body.targetRegions,
    filesystemName: body.filesystemName,
    instanceType: body.instanceType,
    regionProgress: {},
  };

  // Initialize progress for each region
  for (const region of body.targetRegions) {
    job.regionProgress[region] = {
      status: "queued",
    };
  }

  // Save initial job state
  await putSeedingJob(job);

  // Create a temporary SSH key for loader instances
  const loaderKeyName = `loader-seed-${jobId}`;
  const loaderPublicKey = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC... loader-key"; // Placeholder

  try {
    const existingKeys = await listSshKeys();
    if (!existingKeys.some((k) => k.name === loaderKeyName)) {
      await addSshKey(loaderKeyName, loaderPublicKey);
    }
  } catch (err: any) {
    if (!err.message?.includes("already in use")) {
      console.error("Failed to register loader SSH key:", err);
    }
  }

  // Launch loader VMs for each region
  const existingFilesystems = await listFilesystems();

  for (const region of body.targetRegions) {
    try {
      // Create filesystem if it doesn't exist
      const match = existingFilesystems.find(
        (f) => f.name === body.filesystemName && f.region.name === region
      );

      if (!match) {
        await createFilesystem(body.filesystemName, region);
      }

      // Generate seeding script
      const script = generateSeedingScript({
        sourceUrl: body.sourceUrl,
        gcsServiceAccountJson: settings.gcsServiceAccountJson,
        filesystemName: body.filesystemName,
      });

      // Launch loader VM
      const result = await launchInstance({
        instance_type_name: body.instanceType,
        region_name: region,
        ssh_key_names: [loaderKeyName],
        file_system_names: [body.filesystemName],
        user_data: script,
        name: `seed-${body.filesystemName}-${region}`,
      });

      const loaderInstanceId = result.instance_ids[0];

      // Update region progress
      job.regionProgress[region] = {
        status: "provisioning",
        loaderInstanceId,
        startedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      job.regionProgress[region] = {
        status: "failed",
        error: err.message,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  // Update job status
  job.status = "provisioning";
  job.startedAt = new Date().toISOString();
  await putSeedingJob(job);

  return json(job);
};

export const config = { path: "/api/admin/seed-filesystem" };
