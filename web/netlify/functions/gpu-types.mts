import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { getInstanceTypes } from "./lib/lambda-api.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  try {
    const types = await getInstanceTypes();
    const result = Object.entries(types).map(([name, data]) => ({
      name,
      description: data.instance_type.description,
      priceCentsPerHour: data.instance_type.price_cents_per_hour,
      regions: data.regions_with_capacity_available.map((r) => r.name),
    }));
    return json(result);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
};

export const config = { path: "/api/gpu-types" };
