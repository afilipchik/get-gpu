import { Navigate } from "react-router-dom";
import type { User } from "../types";

interface ProtectedRouteProps {
  user: User | null;
  loading: boolean;
  unauthorized?: boolean;
  requiredRole?: "admin" | "candidate";
  children: React.ReactNode;
}

export default function ProtectedRoute({ user, loading, unauthorized, requiredRole, children }: ProtectedRouteProps) {
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to={unauthorized ? "/unauthorized" : "/login"} replace />;
  }

  if (requiredRole && user.role !== requiredRole && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
