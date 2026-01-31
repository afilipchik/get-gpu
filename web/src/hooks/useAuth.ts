import { useState, useEffect, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import type { User } from "../types";
import { setAuthToken, fetchProfile } from "../api";

export function useAuth() {
  const {
    isAuthenticated,
    isLoading: auth0Loading,
    getAccessTokenSilently,
    loginWithRedirect,
    logout: auth0Logout,
  } = useAuth0();

  const [user, setUser] = useState<User | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when Auth0 login succeeded but backend rejected (email not on allowlist)
  const [unauthorized, setUnauthorized] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!isAuthenticated) return;
    setProfileLoading(true);
    try {
      const token = await getAccessTokenSilently();
      setAuthToken(token);
      const profile = await fetchProfile();
      setUser(profile);
      setError(null);
      setUnauthorized(false);
    } catch (err: any) {
      setUser(null);
      setError(err.message);
      // Auth0 session is valid but backend says no — user isn't on the allowlist
      setUnauthorized(true);
    } finally {
      setProfileLoading(false);
    }
  }, [isAuthenticated, getAccessTokenSilently]);

  useEffect(() => {
    if (isAuthenticated) {
      loadProfile();
    } else if (!auth0Loading) {
      setUser(null);
      setAuthToken(null);
    }
  }, [isAuthenticated, auth0Loading, loadProfile]);

  const login = useCallback(() => {
    loginWithRedirect();
  }, [loginWithRedirect]);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    auth0Logout({ logoutParams: { returnTo: window.location.origin } });
  }, [auth0Logout]);

  const loading = auth0Loading || profileLoading;

  return { user, loading, error, unauthorized, login, logout, refresh: loadProfile };
}
