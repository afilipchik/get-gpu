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

  const loadProfile = useCallback(async () => {
    if (!isAuthenticated) return;
    setProfileLoading(true);
    try {
      const token = await getAccessTokenSilently();
      setAuthToken(token);
      const profile = await fetchProfile();
      setUser(profile);
      setError(null);
    } catch (err: any) {
      setUser(null);
      setError(err.message);
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

  return { user, loading, error, login, logout, refresh: loadProfile };
}
