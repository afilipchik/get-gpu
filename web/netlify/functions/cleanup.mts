import type { Config } from "@netlify/functions";
import {
  listVMs, putVM, getCandidate, putCandidate, listVMsByEmail, deleteSshKeyRecord,
  listQueuedLaunchRequests, putLaunchRequest, getSshKey, putSshKey, getSettings, computeSpentCents,
} from "./lib/blobs.js";
import {
  terminateInstances, listInstances, listSshKeys, deleteSshKey,
  getInstanceTypes, launchInstance, addSshKey, listFilesystems, createFilesystem,
} from "./lib/lambda-api.js";
import type { VMRecord } from "./lib/types.js";

const MAX_VM_HOURS = parseInt(process.env.MAX_VM_HOURS ?? "24", 10);

export default async () => {
  console.log("Cleanup: starting run");

  // ===== SECTION 1: VM Sync & Cost Accrual =====

  const vms = await listVMs();
  const activeVMs = vms.filter((vm) => !vm.terminatedAt);

  const toTerminate: string[] = [];
  const candidateUpdates = new Map<string, number>();
  const terminatedKeys = new Map<string, string>();

  if (activeVMs.length > 0) {
    let liveInstances: Map<string, { status: string; ip: string | null }>;
    try {
      const instances = await listInstances();
      liveInstances = new Map(instances.map((i) => [i.id, { status: i.status, ip: i.ip }]));
    } catch (err: any) {
      console.error("Cleanup: failed to fetch instances from Lambda", err.message);
      return new Response("error fetching instances", { status: 500 });
    }

    for (const vm of activeVMs) {
      const live = liveInstances.get(vm.instanceId);

      if (!live || live.status === "terminated") {
        const minutesElapsed = Math.ceil((Date.now() - new Date(vm.launchedAt).getTime()) / (1000 * 60));
        vm.accruedCents = Math.ceil(minutesElapsed * (vm.priceCentsPerHour / 60));
        vm.status = "terminated";
        vm.terminatedAt = new Date().toISOString();
        vm.terminationReason = "terminated_externally";
        vm.lastCheckedAt = new Date().toISOString();
        await putVM(vm);

        terminatedKeys.set(vm.candidateEmail, vm.sshKeyName);
        const prevAccrued = vms.find((v) => v.instanceId === vm.instanceId)?.accruedCents ?? 0;
        const delta = vm.accruedCents - prevAccrued;
        if (delta > 0) {
          candidateUpdates.set(vm.candidateEmail, (candidateUpdates.get(vm.candidateEmail) ?? 0) + delta);
        }
        continue;
      }

      if (live.ip) vm.ipAddress = live.ip;
      vm.status = live.status;

      const minutesElapsed = Math.ceil((Date.now() - new Date(vm.launchedAt).getTime()) / (1000 * 60));
      const prevAccrued = vm.accruedCents;
      vm.accruedCents = Math.ceil(minutesElapsed * (vm.priceCentsPerHour / 60));
      vm.lastCheckedAt = new Date().toISOString();

      const delta = vm.accruedCents - prevAccrued;
      if (delta > 0) {
        candidateUpdates.set(vm.candidateEmail, (candidateUpdates.get(vm.candidateEmail) ?? 0) + delta);
      }

      const hoursElapsed = minutesElapsed / 60;
      if (hoursElapsed >= MAX_VM_HOURS) {
        console.log(`Cleanup: VM ${vm.instanceId} exceeded ${MAX_VM_HOURS}h, terminating`);
        toTerminate.push(vm.instanceId);
        vm.terminatedAt = new Date().toISOString();
        vm.terminationReason = "max_hours_exceeded";
        vm.status = "terminated";
        terminatedKeys.set(vm.candidateEmail, vm.sshKeyName);
      }

      await putVM(vm);
    }

    // Update candidate spentCents and enforce quotas
    const emailsWithActiveVMs = new Set(activeVMs.map((vm) => vm.candidateEmail));

    for (const email of emailsWithActiveVMs) {
      const candidate = await getCandidate(email);

      if (!candidate || candidate.deactivatedAt) {
        console.log(`Cleanup: candidate ${email} is ${!candidate ? "missing" : "deactivated"}, terminating VMs`);
        const orphanedVMs = activeVMs.filter(
          (vm) => vm.candidateEmail === email && !vm.terminatedAt
        );
        for (const vm of orphanedVMs) {
          if (!toTerminate.includes(vm.instanceId)) {
            toTerminate.push(vm.instanceId);
            vm.terminatedAt = new Date().toISOString();
            vm.terminationReason = "account_removed";
            vm.status = "terminated";
            terminatedKeys.set(vm.candidateEmail, vm.sshKeyName);
            await putVM(vm);
          }
        }
        continue;
      }

      const addedCents = candidateUpdates.get(email);
      if (addedCents && addedCents > 0) {
        candidate.spentCents += addedCents;
        await putCandidate(candidate);
      }

      if (candidate.role === "candidate") {
        const quotaCents = candidate.quotaDollars * 100;
        if (candidate.spentCents >= quotaCents) {
          console.log(`Cleanup: candidate ${email} exceeded quota, terminating all VMs`);
          const candidateVMs = activeVMs.filter(
            (vm) => vm.candidateEmail === email && !vm.terminatedAt
          );
          for (const vm of candidateVMs) {
            if (!toTerminate.includes(vm.instanceId)) {
              toTerminate.push(vm.instanceId);
              vm.terminatedAt = new Date().toISOString();
              vm.terminationReason = "quota_exceeded";
              vm.status = "terminated";
              terminatedKeys.set(vm.candidateEmail, vm.sshKeyName);
              await putVM(vm);
            }
          }
        }
      }
    }

    // Terminate VMs in Lambda
    if (toTerminate.length > 0) {
      try {
        await terminateInstances(toTerminate);
        console.log(`Cleanup: terminated ${toTerminate.length} instances`);
      } catch (err: any) {
        console.error("Cleanup: failed to terminate instances", err.message);
      }
    }

    // Delete SSH keys for candidates with no remaining active VMs
    if (terminatedKeys.size > 0) {
      let lambdaKeys: Array<{ id: string; name: string }> | null = null;
      for (const [email, keyName] of terminatedKeys) {
        const candidateVMs = await listVMsByEmail(email);
        const hasActiveVMs = candidateVMs.some((v) => !v.terminatedAt);
        if (!hasActiveVMs) {
          try {
            if (!lambdaKeys) lambdaKeys = await listSshKeys();
            const key = lambdaKeys.find((k) => k.name === keyName);
            if (key) await deleteSshKey(key.id);
            await deleteSshKeyRecord(email, keyName);
            console.log(`Cleanup: deleted SSH key for ${email}`);
          } catch (err: any) {
            console.error(`Cleanup: failed to delete SSH key for ${email}: ${err.message}`);
          }
        }
      }
    }
  } else {
    console.log("Cleanup: no active VMs");
  }

  // ===== SECTION 2: Process Queued Launch Requests =====

  console.log("Cleanup: checking queued launch requests");

  const queuedRequests = await listQueuedLaunchRequests();
  if (queuedRequests.length === 0) {
    console.log("Cleanup: no queued requests");
    console.log("Cleanup: done");
    return new Response("ok");
  }

  console.log(`Cleanup: ${queuedRequests.length} queued request(s) to process`);

  let instanceTypes: Record<string, { instance_type: { name: string; price_cents_per_hour: number; description: string }; regions_with_capacity_available: Array<{ name: string; description: string }> }>;
  try {
    instanceTypes = await getInstanceTypes();
  } catch (err: any) {
    console.error("Cleanup: failed to fetch instance types for queue processing", err.message);
    console.log("Cleanup: done");
    return new Response("ok");
  }

  // FIFO: process oldest requests first
  queuedRequests.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const lr of queuedRequests) {
    // Pre-flight: candidate still valid?
    const candidate = await getCandidate(lr.candidateEmail);
    if (!candidate || candidate.deactivatedAt) {
      lr.status = "cancelled";
      lr.cancelledAt = new Date().toISOString();
      lr.failureReason = "candidate_deactivated";
      await putLaunchRequest(lr);
      console.log(`Cleanup: cancelled request ${lr.id} — candidate deactivated`);
      continue;
    }

    // Pre-flight: candidate must not already have an active VM
    if (candidate.role === "candidate") {
      const candidateVMs = await listVMsByEmail(candidate.email);
      const activeVM = candidateVMs.find((vm) => !vm.terminatedAt);
      if (activeVM) {
        // Skip this cycle — VM might terminate later
        continue;
      }
    }

    // Find a matching type+region with capacity
    let matchedType: string | null = null;
    let matchedRegion: string | null = null;
    let matchedPrice = 0;

    for (const typeName of lr.instanceTypes) {
      const typeData = instanceTypes[typeName];
      if (!typeData) continue;
      const availableRegions = typeData.regions_with_capacity_available.map((r) => r.name);
      for (const regionName of lr.regions) {
        if (availableRegions.includes(regionName)) {
          matchedType = typeName;
          matchedRegion = regionName;
          matchedPrice = typeData.instance_type.price_cents_per_hour;
          break;
        }
      }
      if (matchedType) break;
    }

    if (!matchedType || !matchedRegion) {
      lr.attempts += 1;
      lr.lastAttemptAt = new Date().toISOString();
      await putLaunchRequest(lr);
      console.log(`Cleanup: no capacity for request ${lr.id} (attempt ${lr.attempts})`);
      continue;
    }

    // Quota check at provision time (candidates only)
    if (candidate.role === "candidate") {
      const quotaCents = candidate.quotaDollars * 100;
      const realTimeSpent = await computeSpentCents(candidate.email, candidate.spentResetAt);
      if (quotaCents - realTimeSpent < matchedPrice) {
        lr.status = "failed";
        lr.failureReason = "insufficient_quota";
        await putLaunchRequest(lr);
        console.log(`Cleanup: request ${lr.id} failed — insufficient quota`);
        continue;
      }
    }

    // Set to provisioning to prevent duplicate attempts
    lr.status = "provisioning";
    lr.lastAttemptAt = new Date().toISOString();
    lr.attempts += 1;
    await putLaunchRequest(lr);

    // Register SSH key
    const keyName = `web-${candidate.email.replace(/[^a-z0-9]/gi, "-")}`;
    try {
      const existingKeys = await listSshKeys();
      const exists = existingKeys.some((k) => k.name === keyName);
      if (!exists) {
        await addSshKey(keyName, lr.sshPublicKey);
      }
      const existingRecord = await getSshKey(candidate.email, keyName);
      if (!existingRecord || existingRecord.publicKey !== lr.sshPublicKey) {
        await putSshKey({
          keyName,
          candidateEmail: candidate.email,
          publicKey: lr.sshPublicKey,
          registeredAt: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      if (!err.message?.includes("already in use")) {
        lr.status = "queued";
        await putLaunchRequest(lr);
        console.error(`Cleanup: SSH key error for request ${lr.id}: ${err.message}`);
        continue;
      }
    }

    // Handle filesystem
    let fileSystemNames: string[] | undefined;
    if (lr.attachFilesystem) {
      try {
        const sanitized = candidate.email.replace(/[^a-zA-Z0-9]/g, "-");
        const fsName = `fs-${sanitized}-${matchedRegion}`.replace(/--+/g, "-").slice(0, 60);
        const existing = await listFilesystems();
        const match = existing.find((f) => f.name === fsName && f.region.name === matchedRegion);
        if (match) {
          fileSystemNames = [match.name];
        } else {
          const created = await createFilesystem(fsName, matchedRegion);
          fileSystemNames = [created.name];
        }
      } catch (err: any) {
        lr.status = "queued";
        await putLaunchRequest(lr);
        console.error(`Cleanup: filesystem error for request ${lr.id}: ${err.message}`);
        continue;
      }
    }

    // Fetch setup script
    const settings = await getSettings();
    let userDataScript: string | undefined;
    if (settings?.setupScript) {
      const script = settings.setupScript;
      userDataScript = script.startsWith("#!") ? script : `#!/bin/bash\n${script}`;
    }

    // Attempt launch
    try {
      const result = await launchInstance({
        instance_type_name: matchedType,
        region_name: matchedRegion,
        ssh_key_names: [keyName],
        file_system_names: fileSystemNames,
        user_data: userDataScript,
      });

      const instanceId = result.instance_ids[0];

      const vmRecord: VMRecord = {
        instanceId,
        candidateEmail: candidate.email,
        instanceType: matchedType,
        region: matchedRegion,
        priceCentsPerHour: matchedPrice,
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

      lr.status = "fulfilled";
      lr.fulfilledAt = new Date().toISOString();
      lr.fulfilledInstanceId = instanceId;
      await putLaunchRequest(lr);

      console.log(`Cleanup: fulfilled request ${lr.id} → ${instanceId} (${matchedType} in ${matchedRegion})`);
    } catch (err: any) {
      lr.status = "queued";
      await putLaunchRequest(lr);
      console.error(`Cleanup: launch failed for request ${lr.id}: ${err.message}`);
    }
  }

  console.log("Cleanup: done");
  return new Response("ok");
};

export const config: Config = {
  schedule: "* * * * *",
};
