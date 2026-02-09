import type { Context } from "@netlify/functions";
import { authenticate, requireAuth, json } from "./lib/auth.js";
import { putVM, getSshKey, putSshKey, getSettings, computeSpentCents, listVMsByEmail, listLaunchRequestsByEmail } from "./lib/blobs.js";
import { launchInstance, getInstanceTypes, addSshKey, listSshKeys } from "./lib/lambda-api.js";
import { resolveFilesystems } from "./lib/filesystem-resolver.js";
import type { VMRecord } from "./lib/types.js";

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = await authenticate(request);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { candidate } = user!;

  let body: { instanceType: string; region: string; sshPublicKey: string; attachFilesystem?: boolean };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.instanceType || !body.region || !body.sshPublicKey) {
    return json({ error: "Missing instanceType, region, or sshPublicKey" }, 400);
  }

  const types = await getInstanceTypes();
  const typeData = types[body.instanceType];
  if (!typeData) {
    return json({ error: `Unknown instance type: ${body.instanceType}` }, 400);
  }

  const priceCentsPerHour = typeData.instance_type.price_cents_per_hour;

  if (candidate.role === "candidate") {
    const candidateVMs = await listVMsByEmail(candidate.email);
    const activeVM = candidateVMs.find((vm) => !vm.terminatedAt);
    if (activeVM) {
      return json({ error: "You already have an active instance. Terminate it before launching a new one." }, 400);
    }

    const pendingRequests = await listLaunchRequestsByEmail(candidate.email);
    const pendingRequest = pendingRequests.find(
      (lr) => lr.status === "queued" || lr.status === "provisioning",
    );
    if (pendingRequest) {
      return json({ error: "You have a pending launch request. Cancel it before launching directly." }, 400);
    }

    const quotaCents = candidate.quotaDollars * 100;
    const realTimeSpent = await computeSpentCents(candidate.email, candidate.spentResetAt);
    const remaining = quotaCents - realTimeSpent;
    if (remaining < priceCentsPerHour) {
      return json({ error: "Insufficient quota to launch this instance" }, 403);
    }
  }

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

  // Resolve filesystems (personal + default shared)
  const settings = await getSettings();
  const appUrl = process.env.URL || "https://get-gpu.netlify.app";

  const { fileSystemNames, loaderVMs, readonlyRemountScript } = await resolveFilesystems({
    region: body.region,
    candidateEmail: candidate.email,
    attachPersonalFilesystem: body.attachFilesystem ?? false,
    settings,
    appUrl,
  });

  // Launch loader VMs for filesystems that need seeding
  for (const loader of loaderVMs) {
    try {
      const loaderType = Object.entries(types)
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
        console.log(`Launched loader VM for ${loader.filesystemName} in ${loader.region}`);
      } else {
        console.error(`No capacity for loader VM in ${loader.region}`);
      }
    } catch (err: any) {
      console.error(`Failed to launch loader VM for ${loader.filesystemName}:`, err.message);
    }
  }

  // Compose user_data script
  let userDataScript = "#!/bin/bash\nset -euo pipefail\n";
  if (settings?.setupScript) {
    const script = settings.setupScript;
    userDataScript += (script.startsWith("#!") ? script.replace(/^#!.*\n?/, "") : script) + "\n";
  }
  if (readonlyRemountScript) {
    userDataScript += "\n# Remount shared filesystems as read-only\n" + readonlyRemountScript + "\n";
  }

  // Launch instance
  try {
    const result = await launchInstance({
      instance_type_name: body.instanceType,
      region_name: body.region,
      ssh_key_names: [keyName],
      file_system_names: fileSystemNames,
      user_data: userDataScript,
    });

    const instanceId = result.instance_ids[0];

    const vmRecord: VMRecord = {
      instanceId,
      candidateEmail: candidate.email,
      instanceType: body.instanceType,
      region: body.region,
      priceCentsPerHour,
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
    return json(vmRecord, 201);
  } catch (err: any) {
    console.error("Launch failed:", err.message);
    return json({ error: "Launch failed. Please try again." }, 500);
  }
};

export const config = { path: "/api/vms/launch" };
