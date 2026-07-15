"use client";

import NDK, { NDKNip07Signer, NDKUser } from "@nostr-dev-kit/ndk";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getNdk } from "@/lib/ndk";

interface NdkContextValue {
  ndk: NDK;
  user: NDKUser | null;
  connecting: boolean;
  loginError: string | null;
  login: () => Promise<void>;
  logout: () => void;
}

const NdkContext = createContext<NdkContextValue | null>(null);

export function useNdk(): NdkContextValue {
  const ctx = useContext(NdkContext);
  if (!ctx) throw new Error("useNdk must be used within <NdkProvider>");
  return ctx;
}

export function NdkProvider({ children }: { children: ReactNode }) {
  const ndk = useMemo(() => getNdk(), []);
  const [user, setUser] = useState<NDKUser | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ndk.connect(2500).finally(() => {
      if (alive) setConnecting(false);
    });
    return () => {
      alive = false;
    };
  }, [ndk]);

  const login = async () => {
    setLoginError(null);
    if (typeof window === "undefined" || !("nostr" in window)) {
      setLoginError(
        "No NIP-07 signer found. Install a browser extension like Alby or nos2x."
      );
      return;
    }
    try {
      const signer = new NDKNip07Signer();
      await signer.blockUntilReady();
      ndk.signer = signer;
      const u = await signer.user();
      await u.fetchProfile();
      setUser(u);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed.");
    }
  };

  const logout = () => {
    ndk.signer = undefined;
    setUser(null);
  };

  return (
    <NdkContext.Provider
      value={{ ndk, user, connecting, loginError, login, logout }}
    >
      {children}
    </NdkContext.Provider>
  );
}
