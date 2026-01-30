import { Navigate } from "react-router-dom";
import type { User } from "../types";

interface LoginPageProps {
  onLogin: () => void;
  user: User | null;
  loading: boolean;
}

export default function LoginPage({ onLogin, user, loading }: LoginPageProps) {
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="login-page">
      <h2>GPU Self-Service</h2>
      <p>Sign in to provision Lambda Labs GPU instances for your interview.</p>
      <button className="btn btn-google" onClick={onLogin}>
        Sign in
      </button>
    </div>
  );
}
