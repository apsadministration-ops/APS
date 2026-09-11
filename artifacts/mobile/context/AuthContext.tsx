import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setAuthTokenGetter, User } from "@workspace/api-client-react";
import { getApiConfig, getApiUrl } from "@/lib/apiConfig";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (user: User, token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const apiConfig = getApiConfig();
    if (!apiConfig.valid) {
      // The root layout normally prevents this provider from mounting. Keep a
      // defensive gate here so auth never trusts cached state or initializes a
      // client against an unconfigured endpoint.
      setIsLoading(false);
      return;
    }

    setAuthTokenGetter(async () => {
      return await AsyncStorage.getItem("auth_token");
    });
    
    const loadAuth = async () => {
      try {
        const storedToken = await AsyncStorage.getItem("auth_token");
        const storedUser = await AsyncStorage.getItem("auth_user");

        if (storedToken && storedUser) {
          // Validate the cached token against the server before trusting it.
          // A stale/expired/invalidated token (e.g. issued under an old
          // SESSION_SECRET) would otherwise leave the user "logged in" locally
          // while every API call fails with "Invalid or expired token". By
          // verifying here we can clear a bad token and route to login instead.
          // Bound the validation so a slow/unreachable network can't leave the
          // app on a blank startup screen indefinitely.
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          try {
            const res = await fetch(getApiUrl("/auth/me"), {
              headers: { Authorization: `Bearer ${storedToken}` },
              signal: controller.signal,
            });
            if (res.ok) {
              const freshUser = (await res.json()) as User;
              setToken(storedToken);
              setUser(freshUser);
              await AsyncStorage.setItem("auth_user", JSON.stringify(freshUser));
            } else if (res.status === 401 || res.status === 403) {
              // Token rejected (invalid/expired/suspended) — drop the cached
              // session so the app falls back to the login screen.
              await AsyncStorage.multiRemove(["auth_token", "auth_user"]);
            } else {
              // Unexpected server error — keep the cached session for now.
              setToken(storedToken);
              setUser(JSON.parse(storedUser));
            }
          } catch {
            // Network error / timeout (offline or unreachable) — keep cached session.
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
          } finally {
            clearTimeout(timeout);
          }
        }
      } catch (e) {
        console.error("Failed to load auth state", e);
      } finally {
        setIsLoading(false);
      }
    };

    loadAuth();
  }, []);

  const login = async (newUser: User, newToken: string) => {
    await AsyncStorage.setItem("auth_token", newToken);
    await AsyncStorage.setItem("auth_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = async () => {
    await AsyncStorage.removeItem("auth_token");
    await AsyncStorage.removeItem("auth_user");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
