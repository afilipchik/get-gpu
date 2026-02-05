import { useState, useEffect, useCallback } from "react";
import type { User, VMRecord, Candidate, AdminSettings, FilesystemRecord, LaunchRequest, GpuType } from "../types";
import { fetchVMs, fetchCandidates, fetchSettings, updateSettings, fetchFilesystems, deleteFilesystem, fetchLaunchRequests, fetchGpuTypes } from "../api";
import VMCard from "../components/VMCard";
import LaunchRequestCard from "../components/LaunchRequestCard";
import AllowlistTable from "../components/AllowlistTable";
import AddCandidateForm from "../components/AddCandidateForm";
import LaunchForm from "../components/LaunchForm";
import BashHighlight from "../components/BashHighlight";
import AdminSeedFilesystem from "./AdminSeedFilesystem";

interface AdminDashboardProps {
  user: User;
}

function SettingsTab() {
  const [apiKey, setApiKey] = useState("");
  const [setupScript, setSetupScript] = useState("");
  const [gcsServiceAccountJson, setGcsServiceAccountJson] = useState("");
  const [defaultFilesystemNames, setDefaultFilesystemNames] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setApiKey(s.lambdaApiKey ?? "");
        setSetupScript(s.setupScript ?? "");
        setGcsServiceAccountJson(s.gcsServiceAccountJson ?? "");
        setDefaultFilesystemNames((s.defaultFilesystemNames ?? []).join(", "));
      })
      .catch(() => {
        // No settings yet
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const filesystemNamesArray = defaultFilesystemNames
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const result = await updateSettings({
        lambdaApiKey: apiKey,
        setupScript,
        gcsServiceAccountJson: gcsServiceAccountJson || undefined,
        defaultFilesystemNames: filesystemNamesArray.length > 0 ? filesystemNamesArray : undefined,
      });
      setApiKey(result.lambdaApiKey ?? "");
      setSetupScript(result.setupScript ?? "");
      setGcsServiceAccountJson(result.gcsServiceAccountJson ?? "");
      setDefaultFilesystemNames((result.defaultFilesystemNames ?? []).join(", "));
      setMessage({ type: "success", text: "Settings saved." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const filesystemNamesArray = defaultFilesystemNames
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      await updateSettings({
        lambdaApiKey: apiKey,
        setupScript,
        gcsServiceAccountJson: gcsServiceAccountJson || undefined,
        defaultFilesystemNames: filesystemNamesArray.length > 0 ? filesystemNamesArray : undefined,
        testConnection: true,
      });
      setMessage({ type: "success", text: "Connection successful! Settings saved." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <p className="loading">Loading settings...</p>;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 16 }}>Settings</h3>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
          Lambda API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter Lambda Labs API key"
          style={{ width: "100%", boxSizing: "border-box" }}
        />
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
          Falls back to LAMBDA_API_KEY environment variable if not set.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
          Setup Script
        </label>
        <div style={{ position: "relative" }}>
          <pre
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              margin: 0,
              padding: "8px 12px",
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: "1.5",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              overflow: "auto",
              border: "1px solid transparent",
              pointerEvents: "none",
              background: "transparent",
            }}
          >
            <BashHighlight code={setupScript} />
          </pre>
          <textarea
            value={setupScript}
            onChange={(e) => setSetupScript(e.target.value)}
            placeholder='e.g. pip install "ray[default]" && ray start --head'
            rows={12}
            spellCheck={false}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: "1.5",
              padding: "8px 12px",
              background: "transparent",
              color: "transparent",
              caretColor: "var(--text)",
              resize: "vertical",
              position: "relative",
            }}
          />
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
          Shown to candidates after they launch an instance. Leave empty to hide the setup command section.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
          Default Filesystems
        </label>
        <input
          type="text"
          value={defaultFilesystemNames}
          onChange={(e) => setDefaultFilesystemNames(e.target.value)}
          placeholder="e.g. shared-wayo-data, shared-imagenet"
          style={{ width: "100%", boxSizing: "border-box" }}
        />
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
          Comma-separated list of filesystem names to auto-attach to all user VM launches (if available in the region).
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
          GCS Service Account JSON
        </label>
        <textarea
          value={gcsServiceAccountJson}
          onChange={(e) => setGcsServiceAccountJson(e.target.value)}
          placeholder='{"type": "service_account", "project_id": "...", ...}'
          rows={8}
          style={{
            width: "100%",
            boxSizing: "border-box",
            fontFamily: "monospace",
            fontSize: 13,
          }}
        />
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
          Google Cloud Service Account JSON credentials for seeding filesystems from GCS. Required for filesystem seeding operations.
        </p>
      </div>

      {message && (
        <div
          className={message.type === "success" ? "success" : "error"}
          style={{ marginBottom: 16 }}
        >
          {message.text}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} disabled={saving || testing}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleTestConnection}
          disabled={saving || testing}
          className="secondary"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
      </div>
    </div>
  );
}

export default function AdminDashboard({ user }: AdminDashboardProps) {
  const [tab, setTab] = useState<"candidates" | "vms" | "queue" | "launch" | "filesystems" | "seed" | "settings">("candidates");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [vms, setVMs] = useState<VMRecord[]>([]);
  const [launchRequests, setLaunchRequests] = useState<LaunchRequest[]>([]);
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);
  const [filesystems, setFilesystems] = useState<FilesystemRecord[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [loadingVMs, setLoadingVMs] = useState(true);
  const [loadingLaunchRequests, setLoadingLaunchRequests] = useState(true);
  const [loadingFilesystems, setLoadingFilesystems] = useState(true);

  const loadCandidates = useCallback(async () => {
    try {
      const data = await fetchCandidates();
      setCandidates(data);
    } catch {
      // ignore
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  const loadVMs = useCallback(async () => {
    try {
      const data = await fetchVMs();
      setVMs(data);
    } catch {
      // ignore
    } finally {
      setLoadingVMs(false);
    }
  }, []);

  const loadLaunchRequests = useCallback(async () => {
    try {
      const data = await fetchLaunchRequests();
      setLaunchRequests(data);
    } catch {
      // ignore
    } finally {
      setLoadingLaunchRequests(false);
    }
  }, []);

  const loadFilesystems = useCallback(async () => {
    try {
      const data = await fetchFilesystems();
      setFilesystems(data);
    } catch {
      // ignore
    } finally {
      setLoadingFilesystems(false);
    }
  }, []);

  useEffect(() => {
    loadCandidates();
    loadVMs();
    loadLaunchRequests();
    loadFilesystems();
    fetchGpuTypes().then((data) => setGpuTypes(data.types)).catch(() => {});
    const interval = setInterval(() => { loadVMs(); loadLaunchRequests(); }, 15000);
    return () => clearInterval(interval);
  }, [loadCandidates, loadVMs, loadLaunchRequests, loadFilesystems]);

  const activeVMs = vms.filter((vm) => !vm.terminatedAt);
  const terminatedVMs = vms.filter((vm) => vm.terminatedAt);
  const queuedRequests = launchRequests.filter(
    (lr) => lr.status === "queued" || lr.status === "provisioning",
  );

  const totalSpentCents = candidates.reduce((sum, c) => sum + c.spentCents, 0);
  const totalQuotaCents = candidates.reduce((sum, c) => sum + c.quotaDollars * 100, 0);
  const activeVMsCostPerHour = activeVMs.reduce((sum, vm) => sum + vm.priceCentsPerHour, 0);

  return (
    <div>
      {/* Cost insights */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Total Spent</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>${(totalSpentCents / 100).toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Total Quota Allocated</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>${(totalQuotaCents / 100).toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Active Burn Rate</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>${(activeVMsCostPerHour / 100).toFixed(2)}/hr</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Active / Total VMs</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{activeVMs.length} / {vms.length}</div>
          </div>
          {queuedRequests.length > 0 && (
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Queued Requests</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{queuedRequests.length}</div>
            </div>
          )}
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === "candidates" ? "active" : ""}`}
          onClick={() => setTab("candidates")}
        >
          Candidates ({candidates.length})
        </button>
        <button
          className={`tab ${tab === "vms" ? "active" : ""}`}
          onClick={() => setTab("vms")}
        >
          All VMs ({activeVMs.length} active)
        </button>
        <button
          className={`tab ${tab === "queue" ? "active" : ""}`}
          onClick={() => setTab("queue")}
        >
          Queue ({queuedRequests.length} waiting)
        </button>
        <button
          className={`tab ${tab === "launch" ? "active" : ""}`}
          onClick={() => setTab("launch")}
        >
          Launch VM
        </button>
        <button
          className={`tab ${tab === "filesystems" ? "active" : ""}`}
          onClick={() => setTab("filesystems")}
        >
          Filesystems ({filesystems.length})
        </button>
        <button
          className={`tab ${tab === "seed" ? "active" : ""}`}
          onClick={() => setTab("seed")}
        >
          Seed Filesystem
        </button>
        <button
          className={`tab ${tab === "settings" ? "active" : ""}`}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>

      {tab === "candidates" && (
        <div>
          <AddCandidateForm onAdded={loadCandidates} />
          <div style={{ marginTop: 16 }}>
            {loadingCandidates ? (
              <p className="loading">Loading candidates...</p>
            ) : (
              <AllowlistTable candidates={candidates} onChanged={loadCandidates} />
            )}
          </div>
        </div>
      )}

      {tab === "vms" && (
        <div>
          <div className="section-header">
            <h2>Active Instances ({activeVMs.length})</h2>
          </div>
          {loadingVMs && <p className="loading">Loading VMs...</p>}
          {!loadingVMs && activeVMs.length === 0 && (
            <p className="empty-state">No active instances.</p>
          )}
          {activeVMs.map((vm) => (
            <VMCard key={vm.instanceId} vm={vm} showEmail onTerminated={loadVMs} />
          ))}

          {terminatedVMs.length > 0 && (
            <>
              <div className="section-header" style={{ marginTop: 24 }}>
                <h2>Terminated Instances ({terminatedVMs.length})</h2>
              </div>
              {terminatedVMs.map((vm) => (
                <VMCard key={vm.instanceId} vm={vm} showEmail onTerminated={loadVMs} />
              ))}
            </>
          )}
        </div>
      )}

      {tab === "queue" && (
        <div>
          {loadingLaunchRequests ? (
            <p className="loading">Loading launch requests...</p>
          ) : launchRequests.length === 0 ? (
            <p className="empty-state">No launch requests.</p>
          ) : (
            <>
              {queuedRequests.length > 0 && (
                <>
                  <div className="section-header">
                    <h2>Waiting ({queuedRequests.length})</h2>
                  </div>
                  {queuedRequests.map((lr) => (
                    <LaunchRequestCard key={lr.id} request={lr} gpuTypes={gpuTypes} onChanged={loadLaunchRequests} showEmail />
                  ))}
                </>
              )}
              {launchRequests.filter((lr) => lr.status === "fulfilled").length > 0 && (
                <>
                  <div className="section-header" style={{ marginTop: queuedRequests.length > 0 ? 24 : 0 }}>
                    <h2>Fulfilled ({launchRequests.filter((lr) => lr.status === "fulfilled").length})</h2>
                  </div>
                  {launchRequests.filter((lr) => lr.status === "fulfilled").map((lr) => (
                    <LaunchRequestCard key={lr.id} request={lr} gpuTypes={gpuTypes} onChanged={loadLaunchRequests} showEmail />
                  ))}
                </>
              )}
              {launchRequests.filter((lr) => lr.status === "cancelled" || lr.status === "failed").length > 0 && (
                <>
                  <div className="section-header" style={{ marginTop: 24 }}>
                    <h2>Cancelled / Failed ({launchRequests.filter((lr) => lr.status === "cancelled" || lr.status === "failed").length})</h2>
                  </div>
                  {launchRequests.filter((lr) => lr.status === "cancelled" || lr.status === "failed").map((lr) => (
                    <LaunchRequestCard key={lr.id} request={lr} gpuTypes={gpuTypes} onChanged={loadLaunchRequests} showEmail />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === "launch" && (
        <div>
          <LaunchForm onLaunched={() => { loadVMs(); loadLaunchRequests(); setTab("vms"); }} />
        </div>
      )}

      {tab === "filesystems" && (
        <div>
          {loadingFilesystems ? (
            <p className="loading">Loading filesystems...</p>
          ) : filesystems.length === 0 ? (
            <p className="empty-state">No filesystems.</p>
          ) : (
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Region</th>
                  <th>In Use</th>
                  <th>Size</th>
                  <th>~Cost/mo</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filesystems.map((fs) => (
                  <tr key={fs.id}>
                    <td>{fs.name}</td>
                    <td>{fs.region}</td>
                    <td>
                      <span className={`badge ${fs.is_in_use ? "badge-active" : "badge-idle"}`}>
                        {fs.is_in_use ? "Yes" : "No"}
                      </span>
                    </td>
                    <td>{(fs.bytes_used / (1024 * 1024 * 1024)).toFixed(2)} GB</td>
                    <td>${(fs.bytes_used / (1024 * 1024 * 1024) * 0.20).toFixed(2)}</td>
                    <td>{new Date(fs.created).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        disabled={fs.is_in_use}
                        title={fs.is_in_use ? "Cannot delete while in use" : "Delete filesystem"}
                        onClick={async () => {
                          if (!confirm(`Delete filesystem "${fs.name}"? This cannot be undone.`)) return;
                          try {
                            await deleteFilesystem(fs.id);
                            loadFilesystems();
                          } catch (err: any) {
                            alert(`Failed to delete: ${err.message}`);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "seed" && <AdminSeedFilesystem />}

      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
