import { useState } from "react";
import type { Candidate } from "../types";
import { removeCandidate, setQuota } from "../api";

interface AllowlistTableProps {
  candidates: Candidate[];
  onChanged: () => void;
}

export default function AllowlistTable({ candidates, onChanged }: AllowlistTableProps) {
  const [editingQuota, setEditingQuota] = useState<string | null>(null);
  const [quotaValue, setQuotaValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleDeactivate = async (email: string) => {
    if (!confirm(`Deactivate ${email}? Their VMs will be terminated.`)) return;
    setError(null);
    try {
      await removeCandidate(email);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleQuotaSave = async (email: string) => {
    const dollars = parseFloat(quotaValue);
    if (isNaN(dollars) || dollars < 0) return;
    setError(null);
    try {
      await setQuota(email, dollars);
      setEditingQuota(null);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (candidates.length === 0) {
    return <p className="empty-state">No candidates on the allowlist yet.</p>;
  }

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Quota</th>
              <th>Spent</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.email} style={c.deactivatedAt ? { opacity: 0.5 } : undefined}>
                <td>{c.email}</td>
                <td>{c.name}</td>
                <td>
                  {c.deactivatedAt ? (
                    <span style={{ color: "var(--text-muted)" }}>deactivated</span>
                  ) : (
                    c.role
                  )}
                </td>
                <td>
                  {c.deactivatedAt ? (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  ) : editingQuota === c.email ? (
                    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      $
                      <input
                        type="number"
                        value={quotaValue}
                        onChange={(e) => setQuotaValue(e.target.value)}
                        style={{ width: 80 }}
                        min="0"
                        step="1"
                      />
                      <button className="btn btn-primary" style={{ padding: "4px 8px" }} onClick={() => handleQuotaSave(c.email)}>
                        Save
                      </button>
                      <button className="btn btn-secondary" style={{ padding: "4px 8px" }} onClick={() => setEditingQuota(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span
                      style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                      onClick={() => {
                        setEditingQuota(c.email);
                        setQuotaValue(c.quotaDollars.toString());
                      }}
                    >
                      ${c.quotaDollars}
                    </span>
                  )}
                </td>
                <td>${(c.spentCents / 100).toFixed(2)}</td>
                <td>{new Date(c.addedAt).toLocaleDateString()}</td>
                <td>
                  {!c.deactivatedAt && (
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => handleDeactivate(c.email)}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
