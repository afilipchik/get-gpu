interface UnauthorizedPageProps {
  onLogout: () => void;
}

export default function UnauthorizedPage({ onLogout }: UnauthorizedPageProps) {
  return (
    <div className="unauthorized-page">
      <h2>Access Denied</h2>
      <p>
        Your email is not on the approved candidate list. Please contact your interviewer to get
        access.
      </p>
      <button className="btn btn-secondary" onClick={onLogout}>
        Sign in with a different account
      </button>
    </div>
  );
}
