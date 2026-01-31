import type { LaunchRequest, GpuType } from "../types";
import { cancelLaunchRequest } from "../api";
import { useState } from "react";

interface LaunchRequestCardProps {
  request: LaunchRequest;
  gpuTypes: GpuType[];
  onChanged: () => void;
  showEmail?: boolean;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function statusBadge(status: LaunchRequest["status"]) {
  const map: Record<string, { label: string; className: string }> = {
    queued: { label: "Waiting for Capacity", className: "badge-active" },
    provisioning: { label: "Provisioning...", className: "badge-active" },
    fulfilled: { label: "Fulfilled", className: "badge-idle" },
    cancelled: { label: "Cancelled", className: "" },
    failed: { label: "Failed", className: "badge-danger" },
  };
  const info = map[status] ?? { label: status, className: "" };
  return <span className={`badge ${info.className}`}>{info.label}</span>;
}

export default function LaunchRequestCard({ request: lr, gpuTypes, onChanged, showEmail }: LaunchRequestCardProps) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    if (!confirm("Cancel this launch request?")) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelLaunchRequest(lr.id);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  };

  // Resolve instance type names to descriptions
  const typeDescriptions = lr.instanceTypes.map((name) => {
    const found = gpuTypes.find((t) => t.name === name);
    return found ? found.description : name;
  });

  const isActive = lr.status === "queued" || lr.status === "provisioning";

  return (
    <div className="card" style={{ marginBottom: 8, padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {statusBadge(lr.status)}
            {showEmail && (
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{lr.candidateEmail}</span>
            )}
          </div>

          <div style={{ fontSize: 14, marginBottom: 4 }}>
            <strong>Types:</strong> {typeDescriptions.join(", ")}
          </div>
          <div style={{ fontSize: 14, marginBottom: 4 }}>
            <strong>Regions:</strong> {lr.regions.join(", ")}
          </div>

          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
            <span>Queued {timeAgo(lr.createdAt)}</span>
            {lr.attempts > 0 && <span>Checked {lr.attempts} time{lr.attempts !== 1 ? "s" : ""}</span>}
            {lr.fulfilledInstanceId && <span>Instance: {lr.fulfilledInstanceId}</span>}
            {lr.failureReason && <span>Reason: {lr.failureReason}</span>}
          </div>

          {error && <div className="error" style={{ marginTop: 8, fontSize: 13 }}>{error}</div>}
        </div>

        {isActive && (
          <button
            className="btn btn-danger"
            style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling..." : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
