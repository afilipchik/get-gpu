import { useEffect, useState } from "react";
import { seedFilesystem, getSeedingJobStatus, listSeedingJobs, fetchGpuTypes } from "../api";
import type { SeedingJob, GpuType } from "../types";

export default function AdminSeedFilesystem() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [filesystemName, setFilesystemName] = useState("");
  const [instanceType, setInstanceType] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeJobs, setActiveJobs] = useState<SeedingJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<SeedingJob[]>([]);
  const [allRegions, setAllRegions] = useState<string[]>([]);
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);

  useEffect(() => {
    fetchGpuTypes().then((data) => {
      setGpuTypes(data.types);
      setAllRegions(data.allRegions);
      if (data.types.length > 0) {
        setInstanceType(data.types[0].name);
      }
    });
    loadJobs();
  }, []);

  useEffect(() => {
    if (activeJobs.length === 0) return;

    const interval = setInterval(async () => {
      for (const job of activeJobs) {
        if (job.status === "completed" || job.status === "failed") continue;
        try {
          const updated = await getSeedingJobStatus(job.id);
          setActiveJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        } catch (err: any) {
          console.error(`Failed to update job ${job.id}:`, err);
        }
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [activeJobs]);

  async function loadJobs() {
    try {
      const jobs = await listSeedingJobs();
      const active = jobs.filter((j) => j.status !== "completed" && j.status !== "failed");
      const completed = jobs.filter((j) => j.status === "completed" || j.status === "failed");
      setActiveJobs(active);
      setCompletedJobs(completed);
    } catch (err: any) {
      console.error("Failed to load seeding jobs:", err);
    }
  }

  function toggleRegion(region: string) {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) {
        next.delete(region);
      } else {
        next.add(region);
      }
      return next;
    });
  }

  async function handleSeed() {
    setError("");

    if (!sourceUrl.trim()) {
      setError("Source URL is required");
      return;
    }

    if (!sourceUrl.startsWith("gs://")) {
      setError("Only GCS sources (gs://) are supported currently");
      return;
    }

    if (selectedRegions.size === 0) {
      setError("At least one region must be selected");
      return;
    }

    if (!filesystemName.trim()) {
      setError("Filesystem name is required");
      return;
    }

    if (!instanceType) {
      setError("Instance type is required");
      return;
    }

    setIsLoading(true);

    try {
      const job = await seedFilesystem({
        sourceUrl: sourceUrl.trim(),
        targetRegions: Array.from(selectedRegions),
        filesystemName: filesystemName.trim(),
        instanceType,
      });

      setActiveJobs((prev) => [job, ...prev]);
      setSourceUrl("");
      setSelectedRegions(new Set());
      setFilesystemName("");
    } catch (err: any) {
      setError(err.message || "Failed to start seeding");
    } finally {
      setIsLoading(false);
    }
  }

  function getRegionStatus(job: SeedingJob, region: string) {
    const progress = job.regionProgress[region];
    if (!progress) return "⚪ Unknown";
    if (progress.status === "completed") return "✓ Completed";
    if (progress.status === "failed") return "✗ Failed";
    if (progress.status === "downloading") return "⬇ Downloading";
    if (progress.status === "provisioning") return "⚙ Provisioning";
    return "⏸ Queued";
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Seed Filesystem</h1>

      <div className="bg-white p-6 rounded-lg shadow mb-8">
        <h2 className="text-xl font-semibold mb-4">Create New Seeding Job</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Source URL (GCS)</label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="gs://bucket/path/to/dataset"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Target Regions</label>
            <div className="grid grid-cols-3 gap-2">
              {allRegions.map((region) => (
                <label key={region} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={selectedRegions.has(region)}
                    onChange={() => toggleRegion(region)}
                  />
                  <span>{region}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Filesystem Name</label>
            <input
              type="text"
              value={filesystemName}
              onChange={(e) => setFilesystemName(e.target.value)}
              placeholder="shared-dataset-name"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Instance Type</label>
            <select
              value={instanceType}
              onChange={(e) => setInstanceType(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              {gpuTypes.map((type) => (
                <option key={type.name} value={type.name}>
                  {type.description}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <button
            onClick={handleSeed}
            disabled={isLoading}
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isLoading ? "Starting..." : "Start Seeding"}
          </button>
        </div>
      </div>

      {activeJobs.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-semibold mb-4">Active Seeding Jobs</h2>
          <div className="space-y-4">
            {activeJobs.map((job) => (
              <div key={job.id} className="border border-gray-200 rounded p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-semibold">{job.filesystemName}</div>
                    <div className="text-sm text-gray-600">{job.sourceUrl}</div>
                    <div className="text-sm text-gray-500">
                      Started {new Date(job.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`font-semibold ${
                        job.status === "completed"
                          ? "text-green-600"
                          : job.status === "failed"
                            ? "text-red-600"
                            : "text-blue-600"
                      }`}
                    >
                      {job.status.toUpperCase()}
                    </div>
                    <div className="text-sm text-gray-500">{job.instanceType}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {job.targetRegions.map((region) => (
                    <div key={region} className="text-sm">
                      <span className="font-medium">{region}:</span> {getRegionStatus(job, region)}
                      {job.regionProgress[region]?.error && (
                        <div className="text-red-600 text-xs mt-1">
                          {job.regionProgress[region].error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedJobs.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Completed Seeding Jobs</h2>
          <div className="space-y-4">
            {completedJobs.map((job) => (
              <div key={job.id} className="border border-gray-200 rounded p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold">{job.filesystemName}</div>
                    <div className="text-sm text-gray-600">{job.sourceUrl}</div>
                    <div className="text-sm text-gray-500">
                      {new Date(job.createdAt).toLocaleString()} -{" "}
                      {job.completedAt && new Date(job.completedAt).toLocaleString()}
                    </div>
                  </div>
                  <div
                    className={`font-semibold ${job.status === "completed" ? "text-green-600" : "text-red-600"}`}
                  >
                    {job.status.toUpperCase()}
                  </div>
                </div>
                {job.error && (
                  <div className="mt-2 text-sm text-red-600">Error: {job.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
