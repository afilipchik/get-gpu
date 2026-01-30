import { useState } from "react";
import { addCandidate } from "../api";

interface AddCandidateFormProps {
  onAdded: () => void;
}

export default function AddCandidateForm({ onAdded }: AddCandidateFormProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [quotaDollars, setQuotaDollars] = useState("50");
  const [role, setRole] = useState<"candidate" | "admin">("candidate");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await addCandidate({
        email: email.trim(),
        name: name.trim(),
        role,
        quotaDollars: parseFloat(quotaDollars) || 50,
      });
      setEmail("");
      setName("");
      setQuotaDollars("50");
      setRole("candidate");
      onAdded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h3>Add Candidate</h3>
      {error && <div className="error">{error}</div>}
      <div className="inline-form" style={{ marginTop: 12 }}>
        <div className="form-group">
          <label htmlFor="candidate-email">Email</label>
          <input
            id="candidate-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="candidate@example.com"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="candidate-name">Name</label>
          <input
            id="candidate-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="candidate-quota">Quota ($)</label>
          <input
            id="candidate-quota"
            type="number"
            value={quotaDollars}
            onChange={(e) => setQuotaDollars(e.target.value)}
            min="0"
            step="1"
            style={{ width: 100 }}
          />
        </div>
        <div className="form-group">
          <label htmlFor="candidate-role">Role</label>
          <select
            id="candidate-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "candidate" | "admin")}
          >
            <option value="candidate">Candidate</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Adding..." : "Add"}
        </button>
      </div>
    </form>
  );
}
