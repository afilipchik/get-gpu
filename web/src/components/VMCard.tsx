import { useState, useEffect } from "react";
import type { VMRecord } from "../types";
import { terminateVM, restartVM } from "../api";

interface VMCardProps {
  vm: VMRecord;
  showEmail?: boolean;
  onTerminated: () => void;
}

function statusClass(status: string): string {
  if (status === "active") return "status-active";
  if (status === "launching" || status === "booting" || status === "restarting") return "status-launching";
  if (status === "terminated") return "status-terminated";
  return "status-unknown";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function calcLiveCost(vm: VMRecord): number {
  const start = new Date(vm.launchedAt).getTime();
  const end = vm.terminatedAt ? new Date(vm.terminatedAt).getTime() : Date.now();
  const minutesElapsed = Math.ceil((end - start) / (1000 * 60));
  return Math.ceil(minutesElapsed * (vm.priceCentsPerHour / 60));
}

export default function VMCard({ vm, showEmail, onTerminated }: VMCardProps) {
  const [terminating, setTerminating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveCost, setLiveCost] = useState(() => calcLiveCost(vm));

  useEffect(() => {
    if (vm.terminatedAt) {
      setLiveCost(calcLiveCost(vm));
      return;
    }
    setLiveCost(calcLiveCost(vm));
    const interval = setInterval(() => setLiveCost(calcLiveCost(vm)), 10_000);
    return () => clearInterval(interval);
  }, [vm]);

  const handleTerminate = async () => {
    if (!confirm("Are you sure you want to terminate this instance?")) return;

    setTerminating(true);
    setError(null);
    try {
      await terminateVM(vm.instanceId);
      onTerminated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTerminating(false);
    }
  };

  const handleRestart = async () => {
    if (!confirm("Are you sure you want to restart this instance?")) return;

    setRestarting(true);
    setError(null);
    try {
      await restartVM(vm.instanceId);
      onTerminated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRestarting(false);
    }
  };

  const isActive = !vm.terminatedAt;

  return (
    <div className="card">
      {error && <div className="error">{error}</div>}
      <div className="card-header" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{vm.instanceType}</h3>
        <span className={`status ${statusClass(vm.status)}`}>{vm.status}</span>
        {isActive && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={handleRestart}
              disabled={restarting || terminating}
            >
              {restarting ? "Restarting..." : "Restart"}
            </button>
            <button
              className="btn btn-danger"
              onClick={handleTerminate}
              disabled={terminating || restarting}
            >
              {terminating ? "Stopping..." : "Terminate"}
            </button>
          </div>
        )}
      </div>
      <div className="vm-meta" style={{ marginTop: 8 }}>
        <span>Region: {vm.region}</span>
        <span>Rate: {formatCost(vm.priceCentsPerHour)}/hr</span>
        <span>Burned: {formatCost(liveCost)}</span>
        <span>Launched: {formatTime(vm.launchedAt)}</span>
        {showEmail && <span>User: {vm.candidateEmail}</span>}
      </div>
      {vm.ipAddress && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
          <span className="vm-ip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            ssh ubuntu@{vm.ipAddress}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ cursor: "pointer", opacity: 0.6, flexShrink: 0 }}
              onClick={() => navigator.clipboard.writeText(`ssh ubuntu@${vm.ipAddress}`)}
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </span>
          {vm.jupyterUrl && (
            <a href={vm.jupyterUrl} target="_blank" rel="noopener noreferrer" className="vm-ip">
              JupyterLab
            </a>
          )}
        </div>
      )}
      {vm.terminatedAt && (
        <div className="vm-meta" style={{ marginTop: 4 }}>
          <span>Terminated: {formatTime(vm.terminatedAt)}</span>
          {vm.terminationReason && <span>Reason: {vm.terminationReason}</span>}
        </div>
      )}
    </div>
  );
}
