"use client";

import { useNdk } from "@/app/providers";
import { useProfile, displayName } from "@/lib/hooks";

export function TopBar() {
  const { user, login, logout, loginError, connecting } = useNdk();
  const profile = useProfile(user?.pubkey);

  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex items-baseline">
          <span className="wordmark text-[1.15rem] font-semibold tracking-tight text-text">
            moot
          </span>
          <span className="meta ml-0.5 text-[0.7rem] text-brass">.pub</span>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-border px-2 py-0.5 sm:inline-flex">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connecting ? "bg-brass" : "bg-emerald-400"}`}
          />
          <span className="meta">{connecting ? "connecting" : "relays live"}</span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        {loginError && (
          <span className="hidden max-w-xs truncate text-xs text-red-400 sm:inline">
            {loginError}
          </span>
        )}
        <button
          type="button"
          className="hidden text-[0.8125rem] text-muted transition-colors hover:text-text sm:block"
        >
          Explore
        </button>
        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-[0.8125rem] text-text">
              {displayName(user.pubkey, profile)}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text"
            >
              Log out
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={login}
            className="rounded-md bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-black transition-opacity hover:opacity-90"
          >
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
