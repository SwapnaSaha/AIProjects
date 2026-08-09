import React, { createContext, useContext, useState, useCallback } from 'react';
import { api, setAuthToken, loadStoredToken } from '../api/client';

export interface AuthUser { userId: string; name: string; role: string; storeId: string | null; }

interface AuthContextShape {
  user: AuthUser | null;
  login: (role: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextShape | null>(null);

function loadStoredUser(): AuthUser | null {
  loadStoredToken();
  const raw = localStorage.getItem('rxf_user');
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Prototype-only session restore: the token itself is opaque (no server-side "who am I"
  // lookup exists in this demo), so the user object is cached in localStorage alongside
  // it purely so a page refresh doesn't kick the demo back to the login screen. Real spec
  // (engg.md FEATURE_0) verifies the session server-side on every request instead.
  const [user, setUser] = useState<AuthUser | null>(() => loadStoredUser());

  const login = useCallback(async (role: string) => {
    const { token, user } = await api.login(role);
    setAuthToken(token);
    localStorage.setItem('rxf_user', JSON.stringify(user));
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    localStorage.removeItem('rxf_user');
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
