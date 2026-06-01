import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User } from '@/types';
import { clearSession, fetchCurrentUser, loginUser, signupUser } from '@/services/api';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const currentUser = await fetchCurrentUser();
    if (currentUser) {
      localStorage.setItem('dataisland_user', JSON.stringify(currentUser));
      setUser(currentUser);
    } else {
      localStorage.removeItem('dataisland_user');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser()
      .then((currentUser) => {
        if (currentUser) {
          localStorage.setItem('dataisland_user', JSON.stringify(currentUser));
          setUser(currentUser);
        } else {
          localStorage.removeItem('dataisland_user');
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const currentUser = await loginUser(email, password);
    localStorage.setItem('dataisland_user', JSON.stringify(currentUser));
    setUser(currentUser);
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const currentUser = await signupUser(name, email, password);
    localStorage.setItem('dataisland_user', JSON.stringify(currentUser));
    setUser(currentUser);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
