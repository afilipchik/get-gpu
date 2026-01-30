import type { User } from "../types";

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
}

export default function Header({ user, onLogout }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <h1>GPU Self-Service</h1>
      </div>
      {user && (
        <div className="header-right">
          <span className="header-user">
            {user.name} ({user.role})
          </span>
          <button className="btn btn-secondary" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
