import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { getInstanceTypes } from "./lib/lambda-api.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  try {
    const types = await getInstanceTypes();
    const gpuTypes = Object.entries(types).map(([name, data]) => ({
      name,
      description: data.instance_type.description,
      priceCentsPerHour: data.instance_type.price_cents_per_hour,
      regions: data.regions_with_capacity_available.map((r) => r.name),
    }));

    // Collect all regions seen across any GPU type's capacity list
    const seenRegions = new Set<string>();
    for (const t of gpuTypes) {
      for (const r of t.regions) {
        seenRegions.add(r);
      }
    }

    // Lambda API only returns regions with current capacity, so we maintain
    // a known set of all regions to ensure they always appear in the UI.
    const knownRegions = [
      "asia-northeast-1",
      "asia-northeast-2",
      "asia-south-1",
      "australia-east-1",
      "europe-central-1",
      "me-west-1",
      "us-east-1",
      "us-east-3",
      "us-midwest-1",
      "us-south-2",
      "us-south-3",
      "us-west-1",
      "us-west-2",
      "us-west-3",
    ];

    // Merge known + any newly seen regions from the API
    const allRegions = Array.from(new Set([...knownRegions, ...seenRegions])).sort();

    return json({ types: gpuTypes, allRegions });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
};

export const config = { path: "/api/gpu-types" };
