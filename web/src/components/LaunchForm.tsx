import { useState, useEffect } from "react";
import type { GpuType } from "../types";
import { fetchGpuTypes, launchVM } from "../api";

interface LaunchFormProps {
  onLaunched: () => void;
}

export default function LaunchForm({ onLaunched }: LaunchFormProps) {
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [sshPublicKey, setSshPublicKey] = useState(() => localStorage.getItem("sshPublicKey") ?? "");
  const [attachFilesystem, setAttachFilesystem] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGpuTypes()
      .then((types) => {
        setGpuTypes(types);
        setLoadingTypes(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoadingTypes(false);
      });
  }, []);

  const available = gpuTypes.filter((t) => t.regions.length > 0);
  const selected = available.find((t) => t.name === selectedType);
  const regions = selected?.regions ?? [];

  useEffect(() => {
    if (regions.length > 0 && !regions.includes(selectedRegion)) {
      setSelectedRegion(regions[0]);
    }
  }, [selectedType, regions, selectedRegion]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !selectedRegion || !sshPublicKey.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await launchVM({
        instanceType: selectedType,
        region: selectedRegion,
        sshPublicKey: sshPublicKey.trim(),
        attachFilesystem: attachFilesystem || undefined,
      });
      localStorage.setItem("sshPublicKey", sshPublicKey.trim());
      onLaunched();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loadingTypes) {
    return <div className="card"><p className="loading">Loading GPU types...</p></div>;
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Launch a GPU Instance</h2>
      {error && <div className="error">{error}</div>}

      <div className="form-row" style={{ marginTop: 16 }}>
        <div className="form-group">
          <label htmlFor="gpu-type">GPU Type</label>
          <select
            id="gpu-type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            required
          >
            <option value="">Select a GPU...</option>
            {available.map((t) => (
              <option key={t.name} value={t.name}>
                {t.description} — ${(t.priceCentsPerHour / 100).toFixed(2)}/hr
              </option>
            ))}
          </select>
          {available.length === 0 && (
            <small style={{ color: "var(--text-muted)" }}>No GPUs with capacity available.</small>
          )}
        </div>
        <div className="form-group">
          <label htmlFor="region">Region</label>
          <select
            id="region"
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            disabled={regions.length === 0}
            required
          >
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="ssh-key">SSH Public Key</label>
        <textarea
          id="ssh-key"
          value={sshPublicKey}
          onChange={(e) => setSshPublicKey(e.target.value)}
          placeholder="ssh-ed25519 AAAA... or ssh-rsa AAAA..."
          required
        />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 16 }}>
        <input
          type="checkbox"
          checked={attachFilesystem}
          onChange={(e) => setAttachFilesystem(e.target.checked)}
          style={{ width: "auto" }}
        />
        Attach persistent filesystem (preserved between VMs in the same region)
      </label>

      <button
        type="submit"
        className="btn btn-primary"
        disabled={loading || !selectedType || !selectedRegion || !sshPublicKey.trim()}
      >
        {loading ? "Launching..." : "Launch Instance"}
      </button>
    </form>
  );
}
