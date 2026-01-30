import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import Header from "./components/Header";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import CandidateDashboard from "./pages/CandidateDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import UnauthorizedPage from "./pages/UnauthorizedPage";

export default function App() {
  const { user, loading, login, logout } = useAuth();

  return (
    <div className="app">
      <Header user={user} onLogout={logout} />
      <main className="main">
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={login} user={user} loading={loading} />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute user={user} loading={loading}>
                {user?.role === "admin" ? (
                  <Navigate to="/admin" replace />
                ) : (
                  <Navigate to="/dashboard" replace />
                )}
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute user={user} loading={loading}>
                <CandidateDashboard user={user!} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute user={user} loading={loading} requiredRole="admin">
                <AdminDashboard user={user!} />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
