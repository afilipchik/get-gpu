import { useState, useEffect, useMemo } from "react";
import type { GpuType } from "../types";
import { fetchGpuTypes, createLaunchRequest } from "../api";

interface LaunchFormProps {
  onLaunched: () => void;
}

export default function LaunchForm({ onLaunched }: LaunchFormProps) {
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);
  const [allRegions, setAllRegions] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [sshPublicKey, setSshPublicKey] = useState(() => localStorage.getItem("sshPublicKey") ?? "");
  const [attachFilesystem, setAttachFilesystem] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGpuTypes()
      .then((data) => {
        setGpuTypes(data.types);
        setAllRegions(data.allRegions);
        setLoadingTypes(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoadingTypes(false);
      });
  }, []);

  // For each region, which of the selected GPU types have capacity there?
  const regionCapacity = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of allRegions) {
      const typesWithCapacity = gpuTypes
        .filter((t) => selectedTypes.has(t.name) && t.regions.includes(r))
        .map((t) => t.description);
      map.set(r, typesWithCapacity);
    }
    return map;
  }, [allRegions, gpuTypes, selectedTypes]);

  // Does any selected type+region combo have capacity right now?
  const hasImmediateCapacity = useMemo(() => {
    for (const t of gpuTypes) {
      if (!selectedTypes.has(t.name)) continue;
      for (const r of t.regions) {
        if (selectedRegions.has(r)) return true;
      }
    }
    return false;
  }, [gpuTypes, selectedTypes, selectedRegions]);

  const toggleType = (name: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleRegion = (name: string) => {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllRegions = () => {
    setSelectedRegions(new Set(allRegions));
  };

  const clearAllRegions = () => {
    setSelectedRegions(new Set());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTypes.size === 0 || selectedRegions.size === 0 || !sshPublicKey.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await createLaunchRequest({
        instanceTypes: Array.from(selectedTypes),
        regions: Array.from(selectedRegions),
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

  const sorted = [...gpuTypes].sort((a, b) => a.priceCentsPerHour - b.priceCentsPerHour);

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Launch a GPU Instance</h2>
      {error && <div className="error">{error}</div>}

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", fontWeight: 500, marginBottom: 8 }}>
          GPU Types <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(select one or more)</span>
        </label>
        {sorted.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No GPU types available from Lambda Labs.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {sorted.map((t) => {
              const available = t.regions.length > 0;
              return (
                <label
                  key={t.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "4px 0",
                    opacity: available ? 1 : 0.6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(t.name)}
                    onChange={() => toggleType(t.name)}
                    style={{ width: "auto" }}
                  />
                  <span>{t.description}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    — ${(t.priceCentsPerHour / 100).toFixed(2)}/hr
                  </span>
                  {available ? (
                    <span style={{ color: "var(--success)", fontSize: 12 }}>
                      ({t.regions.length} region{t.regions.length !== 1 ? "s" : ""})
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      (no capacity)
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {allRegions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <label style={{ fontWeight: 500 }}>
              Regions <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(select one or more)</span>
            </label>
            <button
              type="button"
              onClick={selectAllRegions}
              style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
              className="btn btn-secondary"
            >
              All
            </button>
            <button
              type="button"
              onClick={clearAllRegions}
              style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
              className="btn btn-secondary"
            >
              None
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {allRegions.map((r) => {
              const capacity = regionCapacity.get(r) ?? [];
              const hasCapacity = capacity.length > 0;
              return (
                <label
                  key={r}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "4px 0",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedRegions.has(r)}
                    onChange={() => toggleRegion(r)}
                    style={{ width: "auto" }}
                  />
                  <span>{r}</span>
                  {selectedTypes.size > 0 && (
                    hasCapacity ? (
                      <span style={{ color: "var(--success)", fontSize: 12 }}>
                        capacity: {capacity.join(", ")}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        no capacity for selected types
                      </span>
                    )
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="form-group" style={{ marginTop: 16 }}>
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
        disabled={loading || selectedTypes.size === 0 || selectedRegions.size === 0 || !sshPublicKey.trim()}
      >
        {loading
          ? "Submitting..."
          : hasImmediateCapacity
            ? "Launch Instance"
            : "Queue — Launch When Available"}
      </button>
      {!hasImmediateCapacity && selectedTypes.size > 0 && selectedRegions.size > 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>
          No capacity right now for the selected types and regions. Your request will be queued and automatically provisioned when capacity becomes available (checked every minute).
        </p>
      )}
    </form>
  );
}
