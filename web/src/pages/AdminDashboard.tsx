import { useState, useEffect, useCallback } from "react";
import type { User, VMRecord, Candidate, AdminSettings, DefaultFilesystem, FilesystemRecord, LaunchRequest, GpuType } from "../types";
import { fetchVMs, fetchCandidates, fetchSettings, updateSettings, fetchFilesystems, deleteFilesystem, fetchLaunchRequests, fetchGpuTypes } from "../api";
import VMCard from "../components/VMCard";
import LaunchRequestCard from "../components/LaunchRequestCard";
import AllowlistTable from "../components/AllowlistTable";
import AddCandidateForm from "../components/AddCandidateForm";
import LaunchForm from "../components/LaunchForm";
import BashHighlight from "../components/BashHighlight";

interface AdminDashboardProps {
  user: User;
}

const emptyFilesystem = (): DefaultFilesystem => ({
  name: "",
  sourceType: "gcs",
  sourceUrl: "",
  credentials: "",
});

function SettingsTab() {
  const [apiKey, setApiKey] = useState("");
  const [setupScript, setSetupScript] = useState("");
  const [defaultFilesystems, setDefaultFilesystems] = useState<DefaultFilesystem[]>([]);
  const [seedCompleteSecret, setSeedCompleteSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setApiKey(s.lambdaApiKey ?? "");
        setSetupScript(s.setupScript ?? "");
        setDefaultFilesystems(s.defaultFilesystems ?? []);
        setSeedCompleteSecret(s.seedCompleteSecret ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateFs = (index: number, patch: Partial<DefaultFilesystem>) => {
    setDefaultFilesystems((prev) =>
      prev.map((fs, i) => (i === index ? { ...fs, ...patch } : fs)),
    );
  };

  const removeFs = (index: number) => {
    setDefaultFilesystems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateSettings({
        lambdaApiKey: apiKey,
        setupScript,
        defaultFilesystems: defaultFilesystems.length > 0 ? defaultFilesystems : undefined,
      });
      setApiKey(result.lambdaApiKey ?? "");
      setSetupScript(result.setupScript ?? "");
      setDefaultFilesystems(result.defaultFilesystems ?? []);
      setSeedCompleteSecret(result.seedCompleteSecret ?? "");
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
      await updateSettings({
        lambdaApiKey: apiKey,
        setupScript,
        defaultFilesystems: defaultFilesystems.length > 0 ? defaultFilesystems : undefined,
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
          Runs on every VM after launch. Leave empty to skip.
        </p>
      </div>

      {/* Default Filesystems */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
          Default Filesystems
        </label>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 8 }}>
          Shared filesystems auto-attached (read-only) to every VM. If a filesystem doesn't exist in the target region, it will be created and seeded automatically.
        </p>

        {defaultFilesystems.map((fs, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
              background: "var(--bg-secondary, #f9f9f9)",
            }}
          >
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Name</label>
                <input
                  type="text"
                  value={fs.name}
                  onChange={(e) => updateFs(i, { name: e.target.value })}
                  placeholder="e.g. shared-wayo-data"
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ width: 120 }}>
                <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Source Type</label>
                <select
                  value={fs.sourceType}
                  onChange={(e) => updateFs(i, { sourceType: e.target.value as "gcs" | "r2" })}
                  style={{ width: "100%", boxSizing: "border-box" }}
                >
                  <option value="gcs">GCS</option>
                  <option value="r2">Cloudflare R2</option>
                </select>
              </div>
              <div style={{ alignSelf: "flex-end" }}>
                <button
                  onClick={() => removeFs(i)}
                  className="btn btn-danger"
                  style={{ padding: "6px 10px", fontSize: 12 }}
                >
                  Remove
                </button>
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Source URL</label>
              <input
                type="text"
                value={fs.sourceUrl}
                onChange={(e) => updateFs(i, { sourceUrl: e.target.value })}
                placeholder={fs.sourceType === "gcs" ? "gs://bucket/path" : "s3://bucket/path"}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Credentials {fs.credentials === "***" ? "(saved)" : ""}
              </label>
              <textarea
                value={fs.credentials === "***" ? "" : fs.credentials}
                onChange={(e) => updateFs(i, { credentials: e.target.value })}
                placeholder={
                  fs.credentials === "***"
                    ? "Credentials saved. Paste new value to replace."
                    : fs.sourceType === "gcs"
                      ? '{"type": "service_account", ...}'
                      : '{"accountId": "...", "accessKeyId": "...", "secretAccessKey": "..."}'
                }
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Download Script (optional)
              </label>
              <textarea
                value={fs.downloadScript ?? ""}
                onChange={(e) => updateFs(i, { downloadScript: e.target.value || undefined })}
                placeholder={`Custom download commands. If empty, uses default gsutil/aws cp.\nAvailable env vars: $NFS_PATH (target dir), $CREDS_FILE (credentials path)\n\nExample:\ngcloud auth activate-service-account --key-file="$CREDS_FILE"\ngsutil ls -lh 'gs://bucket' > /tmp/files.txt\ngsutil -m cp $(grep 'train.*tfrecord' /tmp/files.txt | awk '{print $4}') "$NFS_PATH"/`}
                rows={5}
                spellCheck={false}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
            </div>
          </div>
        ))}

        <button
          onClick={() => setDefaultFilesystems((prev) => [...prev, emptyFilesystem()])}
          className="secondary"
          style={{ fontSize: 13 }}
        >
          + Add Filesystem
        </button>
      </div>

      {seedCompleteSecret && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Seed Complete Secret
          </label>
          <input
            type="text"
            value={seedCompleteSecret}
            readOnly
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "monospace",
              fontSize: 12,
              background: "var(--bg-secondary, #f5f5f5)",
            }}
          />
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            Auto-generated. Used by loader VMs to report seeding completion.
          </p>
        </div>
      )}

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
  const [tab, setTab] = useState<"candidates" | "vms" | "queue" | "launch" | "filesystems" | "settings">("candidates");
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

      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
