import { useNavigate } from "react-router-dom";

export default function UnauthorizedPage() {
  const navigate = useNavigate();

  return (
    <div className="unauthorized-page">
      <h2>Access Denied</h2>
      <p>
        Your email is not on the approved candidate list. Please contact your interviewer to get
        access.
      </p>
      <button className="btn btn-secondary" onClick={() => navigate("/login")}>
        Back to sign in
      </button>
    </div>
  );
}
