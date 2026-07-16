"use client";

import NDK, { NDKNip07Signer, NDKUser } from "@nostr-dev-kit/ndk";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getNdk } from "@/lib/ndk";
import { authTransition, canSign as identityCanSign, type NlAuthOptions } from "@/lib/auth";
import { installNostrconnectFetchTimeout } from "@/lib/nostr-login-timeout";
import { stopMuteSync, syncMutesOnLogin } from "@/lib/mutesync";
import { stopBookmarkSync, syncBookmarksOnLogin } from "@/lib/bookmarksync";

interface NdkContextValue {
  ndk: NDK;
  /** Attached identity (signing or read-only), or null when logged out. */
  user: NDKUser | null;
  /** Relays are still opening. */
  connecting: boolean;
  /** Signed in with a view-only npub — the UI should hide/disable signing. */
  readOnly: boolean;
  /**
   * True when the attached identity can actually sign events (logged in and not
   * read-only). Every compose/publish control gates on this, so a view-only npub
   * never sees signing UI it can't use. See docs/design.md#authentication.
   */
  canSign: boolean;
  /** Open the nostr-login modal. Optionally jump to a specific start screen. */
  login: (screen?: string) => void;
  /** Sign out of the current identity. */
  logout: () => void;
}

/**
 * Open the nostr-login modal on a given start screen. We drive it through the
 * documented `nlLaunch` DOM event rather than the exported `launch()` because
 * the installed build's `launch()` type signature is stale — it actually reads
 * an options object, and the event handler builds that object correctly.
 */
function openModal(screen: string) {
  document.dispatchEvent(new CustomEvent("nlLaunch", { detail: screen }));
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
  const [readOnly, setReadOnly] = useState(false);
  // nostr-login attaches its document event listeners during init(); until that
  // resolves, a login click would be dropped, so we gate on it and flush one
  // pending launch. (nostr-login is driven by DOM events, not the module ref —
  // its exported launch() signature is stale in the installed build.)
  const nlReady = useRef(false);
  const pendingScreen = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    ndk.connect(2500).finally(() => {
      if (alive) setConnecting(false);
    });
    return () => {
      alive = false;
    };
  }, [ndk]);

  useEffect(() => {
    let alive = true;
    // Must be installed before nostr-login loads: bounds its blocking Nsec.app
    // probe so the auth modal opens fast instead of hanging (moot-58d).
    installNostrconnectFetchTimeout();
    (async () => {
      const mod = await import("nostr-login");
      if (!alive) return;

      // One handler covers every method (local key, NIP-46, read-only, extension)
      // and fires on restore, so a returning user is logged back in automatically.
      const onAuth = async (_npub: string, options: NlAuthOptions) => {
        const t = authTransition(options);
        if (!t.loggedIn) {
          stopMuteSync();
          stopBookmarkSync();
          ndk.signer = undefined;
          setUser(null);
          setReadOnly(false);
          return;
        }
        try {
          // nostr-login injected a NIP-07 shim, so moot's existing signing path
          // is unchanged: read the pubkey through the standard extension signer.
          const signer = new NDKNip07Signer();
          await signer.blockUntilReady();
          ndk.signer = signer;
          const u = await signer.user();
          void u.fetchProfile().catch(() => {});
          setUser(u);
          setReadOnly(t.readOnly);
          // Hydrate mutes + bookmarks from the user's NIP-51 lists and keep them
          // in sync. Read-only npubs hydrate but never publish. Non-fatal on failure.
          void syncMutesOnLogin(ndk, u.pubkey, !t.readOnly).catch(() => {});
          void syncBookmarksOnLogin(ndk, u.pubkey, !t.readOnly).catch(() => {});
        } catch {
          // The modal surfaces its own errors; leave state logged-out on failure.
        }
      };

      await mod.init({
        noBanner: true, // moot renders its own Log in button in TopBar
        darkMode: true,
        onAuth,
      });
      if (!alive) return;
      nlReady.current = true;
      if (pendingScreen.current) {
        openModal(pendingScreen.current);
        pendingScreen.current = null;
      }
    })();
    return () => {
      alive = false;
    };
  }, [ndk]);

  const login = (screen?: string) => {
    // "welcome" leads with one-tap local-key signup, offering NIP-46/extension
    // alongside — the frictionless default from docs/design.md#authentication.
    const target = screen ?? "welcome";
    if (nlReady.current) openModal(target);
    else pendingScreen.current = target; // flushed once init() finishes
  };

  const logout = () => {
    // Fires onAuth({ type: "logout" }), which clears state above.
    document.dispatchEvent(new Event("nlLogout"));
  };

  // A view-only npub attaches a `user` but can't sign; compose UI gates on this.
  const canSign = identityCanSign({ loggedIn: user != null, readOnly });

  return (
    <NdkContext.Provider
      value={{ ndk, user, connecting, readOnly, canSign, login, logout }}
    >
      {children}
    </NdkContext.Provider>
  );
}
