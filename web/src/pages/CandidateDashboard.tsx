import { useState, useEffect, useCallback, useRef } from "react";
import type { User, VMRecord, FilesystemRecord, GpuType, LaunchRequest } from "../types";
import { fetchVMs, fetchFilesystems, fetchGpuTypes, fetchLaunchRequests } from "../api";
import LaunchForm from "../components/LaunchForm";
import LaunchRequestCard from "../components/LaunchRequestCard";
import VMCard from "../components/VMCard";

interface CandidateDashboardProps {
  user: User;
}

export default function CandidateDashboard({ user }: CandidateDashboardProps) {
  const [vms, setVMs] = useState<VMRecord[]>([]);
  const [launchRequests, setLaunchRequests] = useState<LaunchRequest[]>([]);
  const [filesystems, setFilesystems] = useState<FilesystemRecord[]>([]);
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track VM statuses from previous poll to detect transitions to "active"
  const prevVMStatuses = useRef<Map<string, string>>(new Map());

  const loadLaunchRequests = useCallback(async () => {
    try {
      const data = await fetchLaunchRequests();
      setLaunchRequests(data);
    } catch {
      // ignore
    }
  }, []);

  const loadVMs = useCallback(async () => {
    try {
      const data = await fetchVMs();
      // Notify when a VM transitions to "active" (booted and running)
      if (prevVMStatuses.current.size > 0 && Notification.permission === "granted") {
        for (const vm of data) {
          const prev = prevVMStatuses.current.get(vm.instanceId);
          if (vm.status === "active" && prev && prev !== "active") {
            new Notification("GPU Instance Ready", {
              body: "Your GPU instance is now running and ready to use.",
            });
          }
        }
      }
      prevVMStatuses.current = new Map(data.map((vm) => [vm.instanceId, vm.status]));
      setVMs(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFilesystems = useCallback(async () => {
    try {
      const data = await fetchFilesystems();
      setFilesystems(data);
    } catch {
      // ignore — filesystems are supplementary
    }
  }, []);

  const loadAll = useCallback(() => {
    loadVMs();
    loadLaunchRequests();
  }, [loadVMs, loadLaunchRequests]);

  useEffect(() => {
    loadAll();
    loadFilesystems();
    fetchGpuTypes().then((data) => setGpuTypes(data.types)).catch(() => {});
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
  }, [loadAll, loadFilesystems]);

  const quotaCents = user.quotaDollars * 100;
  const pct = quotaCents > 0 ? Math.min((user.spentCents / quotaCents) * 100, 100) : 0;
  const barClass = pct > 90 ? "danger" : pct > 70 ? "warning" : "ok";

  const activeVMs = vms.filter((vm) => !vm.terminatedAt);
  const terminatedVMs = vms.filter((vm) => vm.terminatedAt);
  const pendingRequests = launchRequests.filter(
    (lr) => lr.status === "queued" || lr.status === "provisioning",
  );

  const bootingVMs = activeVMs.filter((vm) => vm.status === "launching" || vm.status === "booting");

  // Request notification permission when user has a pending request or a booting VM
  useEffect(() => {
    if ((pendingRequests.length > 0 || bootingVMs.length > 0) && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [pendingRequests.length, bootingVMs.length]);

  const burnCentsPerHour = activeVMs.reduce((sum, vm) => sum + vm.priceCentsPerHour, 0);
  const remainingCents = quotaCents - user.spentCents;

  function formatTimeLeft(): string | null {
    if (burnCentsPerHour <= 0 || remainingCents <= 0) return null;
    const hoursLeft = remainingCents / burnCentsPerHour;
    const totalMinutes = Math.floor(hoursLeft * 60);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
    return parts.join(" ");
  }

  const timeLeft = formatTimeLeft();

  return (
    <div>
      {/* Quota bar */}
      <div className="quota-bar-container card">
        <h3 style={{ marginBottom: 8 }}>Your Quota</h3>
        <div className="quota-info">
          <span>Spent: ${(user.spentCents / 100).toFixed(2)}</span>
          <span>Budget: ${user.quotaDollars.toFixed(2)}</span>
          {timeLeft && <span>Time left: {timeLeft} at ${(burnCentsPerHour / 100).toFixed(2)}/hr</span>}
        </div>
        <div className="quota-bar">
          <div
            className={`quota-bar-fill ${barClass}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Launch form, pending request, or GPU pricing panel */}
      {pendingRequests.length > 0 ? (
        <div>
          <div className="section-header">
            <h2>Pending Launch Request</h2>
          </div>
          {pendingRequests.map((lr) => (
            <LaunchRequestCard key={lr.id} request={lr} gpuTypes={gpuTypes} onChanged={loadAll} />
          ))}
        </div>
      ) : activeVMs.length === 0 ? (
        <LaunchForm onLaunched={loadAll} />
      ) : (
        <div className="card">
          <h2>Available GPUs</h2>
          {gpuTypes.length === 0 ? (
            <p className="loading">Loading GPU types...</p>
          ) : (
            <table className="table" style={{ width: "100%", marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>GPU</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                  <th style={{ textAlign: "left" }}>Regions</th>
                </tr>
              </thead>
              <tbody>
                {gpuTypes
                  .filter((t) => t.regions.length > 0)
                  .sort((a, b) => a.priceCentsPerHour - b.priceCentsPerHour)
                  .map((t) => (
                    <tr key={t.name}>
                      <td>{t.description}</td>
                      <td style={{ textAlign: "right" }}>${(t.priceCentsPerHour / 100).toFixed(2)}/hr</td>
                      <td style={{ color: "var(--text-muted)" }}>{t.regions.join(", ")}</td>
                    </tr>
                  ))}
                {gpuTypes.filter((t) => t.regions.length > 0).length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--text-muted)" }}>No GPUs with capacity available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Active VMs */}
      <div className="mb-24" style={{ marginTop: 24 }}>
        <div className="section-header">
          <h2>Active Instances ({activeVMs.length})</h2>
        </div>
        {loading && <p className="loading">Loading instances...</p>}
        {!loading && activeVMs.length === 0 && (
          <p className="empty-state">No active instances.</p>
        )}
        {activeVMs.map((vm) => (
          <VMCard key={vm.instanceId} vm={vm} onTerminated={loadVMs} />
        ))}
      </div>

      {/* Persistent Filesystems */}
      <div style={{ marginTop: 24 }}>
        <div className="section-header">
          <h2>Persistent Filesystems ({filesystems.length})</h2>
        </div>
        {filesystems.length === 0 && (
          <p className="empty-state">No persistent filesystems.</p>
        )}
        {filesystems.map((fs) => (
          <div key={fs.id} className="card" style={{ marginBottom: 8, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>{fs.name}</strong>
                <span style={{ color: "var(--text-muted)", marginLeft: 12 }}>{fs.region}</span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-muted)" }}>
                <span>{(fs.bytes_used / (1024 * 1024 * 1024)).toFixed(2)} GB (~${(fs.bytes_used / (1024 * 1024 * 1024) * 0.20).toFixed(2)}/mo)</span>
                <span className={`badge ${fs.is_in_use ? "badge-active" : "badge-idle"}`}>
                  {fs.is_in_use ? "In Use" : "Idle"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Terminated VMs */}
      {terminatedVMs.length > 0 && (
        <div>
          <div className="section-header">
            <h2>Terminated Instances ({terminatedVMs.length})</h2>
          </div>
          {terminatedVMs.map((vm) => (
            <VMCard key={vm.instanceId} vm={vm} onTerminated={loadVMs} />
          ))}
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
