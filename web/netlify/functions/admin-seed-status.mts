import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, requireAdmin, json } from "./lib/auth.js";
import { getSeedingJob, putSeedingJob } from "./lib/blobs.js";
import { getInstance, terminateInstances } from "./lib/lambda-api.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;
  const adminError = requireAdmin(user!);
  if (adminError) return adminError;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("id");

  if (!jobId) {
    return json({ error: "Missing id query parameter" }, 400);
  }

  const job = await getSeedingJob(jobId);
  if (!job) {
    return json({ error: "Seeding job not found" }, 404);
  }

  // If already completed or failed, return cached status
  if (job.status === "completed" || job.status === "failed") {
    return json(job);
  }

  // Check status of each region's loader instance
  let allCompleted = true;
  let allFailed = true;
  const instancesToTerminate: string[] = [];

  for (const region of job.targetRegions) {
    const progress = job.regionProgress[region];

    if (!progress || progress.status === "completed" || progress.status === "failed") {
      if (progress?.status === "completed" || progress?.status === "failed") {
        if (progress.status === "completed") allFailed = false;
        if (progress.status !== "completed") allCompleted = false;
      }
      continue;
    }

    if (!progress.loaderInstanceId) {
      continue;
    }

    try {
      const instance = await getInstance(progress.loaderInstanceId);

      if (instance.status === "active" || instance.status === "booting") {
        // Instance is running, downloading data
        if (progress.status !== "downloading") {
          progress.status = "downloading";
        }
        allCompleted = false;
        allFailed = false;
      } else if (instance.status === "terminated") {
        // Instance terminated - assume success
        progress.status = "completed";
        progress.completedAt = new Date().toISOString();
        allFailed = false;
      } else if (instance.status === "unhealthy") {
        // Instance failed
        progress.status = "failed";
        progress.error = "Loader instance became unhealthy";
        progress.completedAt = new Date().toISOString();
        allCompleted = false;
        instancesToTerminate.push(progress.loaderInstanceId);
      }
    } catch (err: any) {
      // Instance not found or API error - mark as completed (likely already terminated)
      if (err.message?.includes("not found") || err.message?.includes("404")) {
        progress.status = "completed";
        progress.completedAt = new Date().toISOString();
        allFailed = false;
      } else {
        console.error(`Failed to get instance ${progress.loaderInstanceId}:`, err);
        allCompleted = false;
        allFailed = false;
      }
    }
  }

  // Update overall job status
  if (allCompleted) {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    // Terminate any remaining instances
    for (const region of job.targetRegions) {
      const progress = job.regionProgress[region];
      if (progress?.loaderInstanceId && progress.status !== "failed") {
        instancesToTerminate.push(progress.loaderInstanceId);
      }
    }
  } else if (allFailed) {
    job.status = "failed";
    job.error = "All regions failed to seed";
    job.completedAt = new Date().toISOString();
  } else {
    job.status = "seeding";
  }

  // Terminate completed instances
  if (instancesToTerminate.length > 0) {
    try {
      await terminateInstances(instancesToTerminate);
    } catch (err: any) {
      console.error("Failed to terminate loader instances:", err);
    }
  }

  await putSeedingJob(job);

  return json(job);
};

export const config = { path: "/api/admin/seed-filesystem/status" };
