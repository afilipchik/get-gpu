import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import {
  getCandidate,
  putVM,
  getSshKey,
  putSshKey,
  getSettings,
  computeSpentCents,
  listVMsByEmail,
  listLaunchRequestsByEmail,
  putLaunchRequest,
} from "./lib/blobs.js";
import {
  getInstanceTypes,
  launchInstance,
  addSshKey,
  listSshKeys,
} from "./lib/lambda-api.js";
import { resolveFilesystems } from "./lib/filesystem-resolver.js";
import type { VMRecord, LaunchRequest } from "./lib/types.js";

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { candidate } = user!;

  if (request.method === "GET") {
    const requests = await listLaunchRequestsByEmail(candidate.email);
    // Admins see all, candidates see their own (listLaunchRequestsByEmail already filters)
    if (candidate.role === "admin") {
      const { listLaunchRequests } = await import("./lib/blobs.js");
      const allRequests = await listLaunchRequests();
      return json(allRequests.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    return json(requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  if (request.method === "POST") {
    let body: {
      instanceTypes: string[];
      regions: string[];
      sshPublicKey: string;
      attachFilesystem?: boolean;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (
      !Array.isArray(body.instanceTypes) ||
      body.instanceTypes.length === 0 ||
      !Array.isArray(body.regions) ||
      body.regions.length === 0 ||
      !body.sshPublicKey
    ) {
      return json({ error: "Missing instanceTypes, regions, or sshPublicKey" }, 400);
    }

    // Validate instance types exist
    const types = await getInstanceTypes();
    for (const t of body.instanceTypes) {
      if (!types[t]) {
        return json({ error: `Unknown instance type: ${t}` }, 400);
      }
    }

    // Candidate guards
    if (candidate.role === "candidate") {
      const candidateVMs = await listVMsByEmail(candidate.email);
      const activeVM = candidateVMs.find((vm) => !vm.terminatedAt);
      if (activeVM) {
        return json(
          { error: "You already have an active instance. Terminate it before requesting a new one." },
          400,
        );
      }

      const existingRequests = await listLaunchRequestsByEmail(candidate.email);
      const pendingRequest = existingRequests.find(
        (lr) => lr.status === "queued" || lr.status === "provisioning",
      );
      if (pendingRequest) {
        return json(
          { error: "You already have a pending launch request. Cancel it first." },
          400,
        );
      }

      // Soft quota check: use cheapest selected type
      const cheapestPrice = Math.min(
        ...body.instanceTypes.map((t) => types[t].instance_type.price_cents_per_hour),
      );
      const quotaCents = candidate.quotaDollars * 100;
      const realTimeSpent = await computeSpentCents(candidate.email, candidate.spentResetAt);
      const remaining = quotaCents - realTimeSpent;
      if (remaining < cheapestPrice) {
        return json({ error: "Insufficient quota to launch any of the selected instance types" }, 403);
      }
    }

    // Register SSH key with Lambda
    const keyName = `web-${candidate.email.replace(/[^a-z0-9]/gi, "-")}`;
    const publicKey = body.sshPublicKey.trim();

    try {
      const existingKeys = await listSshKeys();
      const exists = existingKeys.some((k) => k.name === keyName);
      if (!exists) {
        await addSshKey(keyName, publicKey);
      }
      const existingRecord = await getSshKey(candidate.email, keyName);
      if (!existingRecord || existingRecord.publicKey !== publicKey) {
        await putSshKey({
          keyName,
          candidateEmail: candidate.email,
          publicKey,
          registeredAt: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      if (!err.message?.includes("already in use")) {
        return json({ error: `SSH key error: ${err.message}` }, 500);
      }
    }

    // Try immediate launch: find a type+region combo with current capacity
    let immediateType: string | null = null;
    let immediateRegion: string | null = null;
    let immediatePrice = 0;

    for (const typeName of body.instanceTypes) {
      const typeData = types[typeName];
      const availableRegions = typeData.regions_with_capacity_available.map((r) => r.name);
      for (const regionName of body.regions) {
        if (availableRegions.includes(regionName)) {
          immediateType = typeName;
          immediateRegion = regionName;
          immediatePrice = typeData.instance_type.price_cents_per_hour;
          break;
        }
      }
      if (immediateType) break;
    }

    const requestId = crypto.randomUUID();

    if (immediateType && immediateRegion) {
      // Hard quota check at provision time (candidates only)
      if (candidate.role === "candidate") {
        const freshCandidate = await getCandidate(candidate.email);
        if (freshCandidate) {
          const quotaCents = freshCandidate.quotaDollars * 100;
          const realTimeSpent = await computeSpentCents(candidate.email, freshCandidate.spentResetAt);
          if (quotaCents - realTimeSpent < immediatePrice) {
            return json({ error: "Insufficient quota to launch this instance" }, 403);
          }
        }
      }

      // Attempt immediate launch
      try {
        const settings = await getSettings();
        const appUrl = process.env.URL || "https://get-gpu.netlify.app";

        const { fileSystemNames, loaderVMs, readonlyRemountScript } = await resolveFilesystems({
          region: immediateRegion,
          candidateEmail: candidate.email,
          attachPersonalFilesystem: body.attachFilesystem ?? false,
          settings,
          appUrl,
        });

        // Launch loader VMs for filesystems that need seeding
        const instanceTypes = types;
        for (const loader of loaderVMs) {
          try {
            const loaderType = Object.entries(instanceTypes)
              .filter(([, t]) => t.regions_with_capacity_available.some((r) => r.name === loader.region))
              .sort(([, a], [, b]) => a.instance_type.price_cents_per_hour - b.instance_type.price_cents_per_hour)[0];
            if (loaderType) {
              await launchInstance({
                instance_type_name: loaderType[0],
                region_name: loader.region,
                ssh_key_names: [keyName],
                file_system_names: [loader.filesystemName],
                user_data: loader.seedScript,
                name: `seed-${loader.filesystemName}-${loader.region}`,
              });
            }
          } catch (err: any) {
            console.error(`Failed to launch loader VM for ${loader.filesystemName}:`, err.message);
          }
        }

        // Compose user_data
        let userDataScript = "#!/bin/bash\nset -euo pipefail\n";
        if (settings?.setupScript) {
          const script = settings.setupScript;
          userDataScript += (script.startsWith("#!") ? script.replace(/^#!.*\n?/, "") : script) + "\n";
        }
        if (readonlyRemountScript) {
          userDataScript += "\n# Remount shared filesystems as read-only\n" + readonlyRemountScript + "\n";
        }

        const result = await launchInstance({
          instance_type_name: immediateType,
          region_name: immediateRegion,
          ssh_key_names: [keyName],
          file_system_names: fileSystemNames,
          user_data: userDataScript,
        });

        const instanceId = result.instance_ids[0];

        const vmRecord: VMRecord = {
          instanceId,
          candidateEmail: candidate.email,
          instanceType: immediateType,
          region: immediateRegion,
          priceCentsPerHour: immediatePrice,
          launchedAt: new Date().toISOString(),
          status: "launching",
          ipAddress: null,
          jupyterUrl: null,
          sshKeyName: keyName,
          terminatedAt: null,
          terminationReason: null,
          lastCheckedAt: new Date().toISOString(),
          accruedCents: 0,
        };
        await putVM(vmRecord);

        const fulfilledRequest: LaunchRequest = {
          id: requestId,
          candidateEmail: candidate.email,
          instanceTypes: body.instanceTypes,
          regions: body.regions,
          sshPublicKey: publicKey,
          attachFilesystem: body.attachFilesystem ?? false,
          status: "fulfilled",
          createdAt: new Date().toISOString(),
          fulfilledAt: new Date().toISOString(),
          fulfilledInstanceId: instanceId,
          failureReason: null,
          cancelledAt: null,
          attempts: 1,
          lastAttemptAt: new Date().toISOString(),
        };
        await putLaunchRequest(fulfilledRequest);

        return json(fulfilledRequest, 201);
      } catch {
        // Immediate launch failed (capacity might have changed) — fall through to queue
      }
    }

    // No capacity or immediate launch failed — queue the request
    const queuedRequest: LaunchRequest = {
      id: requestId,
      candidateEmail: candidate.email,
      instanceTypes: body.instanceTypes,
      regions: body.regions,
      sshPublicKey: publicKey,
      attachFilesystem: body.attachFilesystem ?? false,
      status: "queued",
      createdAt: new Date().toISOString(),
      fulfilledAt: null,
      fulfilledInstanceId: null,
      failureReason: null,
      cancelledAt: null,
      attempts: 0,
      lastAttemptAt: null,
    };
    await putLaunchRequest(queuedRequest);

    return json(queuedRequest, 202);
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/launch-requests" };
