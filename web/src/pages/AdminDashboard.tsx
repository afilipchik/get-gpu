import { useState, useEffect, useCallback } from "react";
import type { User, VMRecord, Candidate, AdminSettings, FilesystemRecord } from "../types";
import { fetchVMs, fetchCandidates, fetchSettings, updateSettings, fetchFilesystems } from "../api";
import VMCard from "../components/VMCard";
import AllowlistTable from "../components/AllowlistTable";
import AddCandidateForm from "../components/AddCandidateForm";
import LaunchForm from "../components/LaunchForm";

interface AdminDashboardProps {
  user: User;
}

const BASH_KEYWORDS = /\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|source|local|readonly|declare|set|unset|shift|trap|eval|exec|cd|echo|printf|read|test)\b/g;

function highlightBash(code: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const tokens: { start: number; end: number; html: string }[] = [];

  // Comments
  for (const m of code.matchAll(/#[^\n]*/g)) {
    tokens.push({ start: m.index!, end: m.index! + m[0].length, html: `<span style="color:#6a9955">${esc(m[0])}</span>` });
  }

  // Double-quoted strings
  for (const m of code.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    tokens.push({ start: m.index!, end: m.index! + m[0].length, html: `<span style="color:#ce9178">${esc(m[0])}</span>` });
  }

  // Single-quoted strings
  for (const m of code.matchAll(/'[^']*'/g)) {
    tokens.push({ start: m.index!, end: m.index! + m[0].length, html: `<span style="color:#ce9178">${esc(m[0])}</span>` });
  }

  // Variables $VAR, ${VAR}
  for (const m of code.matchAll(/\$\{?[A-Za-z_]\w*\}?/g)) {
    tokens.push({ start: m.index!, end: m.index! + m[0].length, html: `<span style="color:#9cdcfe">${esc(m[0])}</span>` });
  }

  // Sort and remove overlapping tokens
  tokens.sort((a, b) => a.start - b.start);
  const merged: typeof tokens = [];
  for (const t of tokens) {
    if (merged.length > 0 && t.start < merged[merged.length - 1].end) continue;
    merged.push(t);
  }

  // Build result
  let result = "";
  let pos = 0;
  for (const t of merged) {
    if (t.start > pos) {
      result += applyKeywords(esc(code.slice(pos, t.start)));
    }
    result += t.html;
    pos = t.end;
  }
  if (pos < code.length) {
    result += applyKeywords(esc(code.slice(pos)));
  }
  return result;
}

function applyKeywords(escaped: string): string {
  return escaped.replace(BASH_KEYWORDS, '<span style="color:#c586c0">$1</span>');
}

function SettingsTab() {
  const [apiKey, setApiKey] = useState("");
  const [setupScript, setSetupScript] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setApiKey(s.lambdaApiKey ?? "");
        setSetupScript(s.setupScript ?? "");
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
      const result = await updateSettings({ lambdaApiKey: apiKey, setupScript });
      setApiKey(result.lambdaApiKey ?? "");
      setSetupScript(result.setupScript ?? "");
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
      await updateSettings({ lambdaApiKey: apiKey, setupScript, testConnection: true });
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
            <code dangerouslySetInnerHTML={{ __html: highlightBash(setupScript) + "\n" }} />
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
  const [tab, setTab] = useState<"candidates" | "vms" | "launch" | "filesystems" | "settings">("candidates");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [vms, setVMs] = useState<VMRecord[]>([]);
  const [filesystems, setFilesystems] = useState<FilesystemRecord[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [loadingVMs, setLoadingVMs] = useState(true);
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
    loadFilesystems();
    const interval = setInterval(loadVMs, 15000);
    return () => clearInterval(interval);
  }, [loadCandidates, loadVMs, loadFilesystems]);

  const activeVMs = vms.filter((vm) => !vm.terminatedAt);
  const terminatedVMs = vms.filter((vm) => vm.terminatedAt);

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

      {tab === "launch" && (
        <div>
          <LaunchForm onLaunched={() => { loadVMs(); setTab("vms"); }} />
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
                  <th>Created</th>
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
                    <td>{new Date(fs.created).toLocaleDateString()}</td>
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
