import type { Config } from "@netlify/functions";
import { listVMs, putVM, getCandidate, putCandidate, listVMsByEmail, deleteSshKeyRecord } from "./lib/blobs.js";
import { terminateInstances, listInstances, listSshKeys, deleteSshKey, listFilesystems, deleteFilesystem } from "./lib/lambda-api.js";

const MAX_VM_HOURS = parseInt(process.env.MAX_VM_HOURS ?? "24", 10);

export default async () => {
  console.log("Cleanup: starting hourly run");

  const vms = await listVMs();
  const activeVMs = vms.filter((vm) => !vm.terminatedAt);

  if (activeVMs.length === 0) {
    console.log("Cleanup: no active VMs");
    return new Response("ok");
  }

  // Fetch current state from Lambda API
  let liveInstances: Map<string, { status: string; ip: string | null }>;
  try {
    const instances = await listInstances();
    liveInstances = new Map(instances.map((i) => [i.id, { status: i.status, ip: i.ip }]));
  } catch (err: any) {
    console.error("Cleanup: failed to fetch instances from Lambda", err.message);
    return new Response("error fetching instances", { status: 500 });
  }

  const toTerminate: string[] = [];
  const candidateUpdates = new Map<string, number>(); // email -> additional cents
  const terminatedKeys = new Map<string, string>(); // email -> sshKeyName

  for (const vm of activeVMs) {
    const live = liveInstances.get(vm.instanceId);

    // If instance no longer exists in Lambda, mark terminated
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

    // Update IP and status
    if (live.ip) vm.ipAddress = live.ip;
    vm.status = live.status;

    // Calculate accrued cost (per-minute billing)
    const minutesElapsed = Math.ceil((Date.now() - new Date(vm.launchedAt).getTime()) / (1000 * 60));
    const prevAccrued = vm.accruedCents;
    vm.accruedCents = Math.ceil(minutesElapsed * (vm.priceCentsPerHour / 60));
    vm.lastCheckedAt = new Date().toISOString();

    const delta = vm.accruedCents - prevAccrued;
    if (delta > 0) {
      candidateUpdates.set(vm.candidateEmail, (candidateUpdates.get(vm.candidateEmail) ?? 0) + delta);
    }

    // Check if VM exceeds max hours
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

  // Update candidate spentCents
  for (const [email, addedCents] of candidateUpdates) {
    const candidate = await getCandidate(email);
    if (candidate) {
      candidate.spentCents += addedCents;
      await putCandidate(candidate);

      // Check quota exceeded — terminate all active VMs for this candidate
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

          // Delete candidate's filesystems
          try {
            const allFilesystems = await listFilesystems();
            const sanitized = email.replace(/[^a-zA-Z0-9]/g, "-");
            const prefix = `fs-${sanitized}-`;
            const candidateFS = allFilesystems.filter(
              (fs) => fs.name.startsWith(prefix) && !fs.is_in_use
            );
            for (const fs of candidateFS) {
              try {
                await deleteFilesystem(fs.id);
                console.log(`Cleanup: deleted filesystem ${fs.name} for ${email}`);
              } catch (fsErr: any) {
                console.error(`Cleanup: failed to delete filesystem ${fs.name}: ${fsErr.message}`);
              }
            }
          } catch (fsListErr: any) {
            console.error(`Cleanup: failed to list filesystems for ${email}: ${fsListErr.message}`);
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

  console.log("Cleanup: done");
  return new Response("ok");
};

export const config: Config = {
  schedule: "* * * * *",
};
