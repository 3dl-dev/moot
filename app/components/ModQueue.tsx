"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nip19 } from "nostr-tools";
import { useNdk } from "@/app/providers";
import {
  fetchCommunities,
  fetchReports,
  parseReport,
  isModerator,
  timeAgo,
  type Community,
  type Report,
} from "@/lib/nostr";
import {
  fetchCommunityLabels,
  publishLabel,
  NS_MOD,
  type ModLabel,
} from "@/lib/modlabels";

function short(id?: string): string {
  if (!id) return "—";
  try {
    return nip19.noteEncode(id).slice(0, 12) + "…";
  } catch {
    return id.slice(0, 8) + "…";
  }
}

/**
 * A single moderation queue across every community the logged-in user moderates.
 * NIP-56 reports (kind:1984) that moot tagged to a community surface here; a mod
 * removes or dismisses each, which writes an auditable NIP-32 label — that stream
 * is the mod log shown below the queue.
 */
export function ModQueue() {
  const { ndk, user, canSign } = useNdk();
  const me = user?.pubkey ?? null;
  const [myComms, setMyComms] = useState<Community[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [labels, setLabels] = useState<ModLabel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!me) {
      setMyComms([]);
      return;
    }
    let alive = true;
    (async () => {
      const all = await fetchCommunities(ndk);
      const mine = all.filter((c) => isModerator(c, me));
      if (!alive) return;
      setMyComms(mine);
      if (mine.length === 0) return;
      const [reportEvents, labelLists] = await Promise.all([
        fetchReports(ndk, mine.map((c) => c.addr)),
        Promise.all(mine.map((c) => fetchCommunityLabels(ndk, c.addr))),
      ]);
      if (!alive) return;
      setReports(reportEvents.map(parseReport).filter((r): r is Report => r !== null));
      setLabels(labelLists.flat());
    })();
    return () => {
      alive = false;
    };
  }, [ndk, me, reloadKey]);

  // community addr → its moderator set (owner + listed mods).
  const modsByComm = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of myComms ?? []) m.set(c.addr, new Set([c.author, ...c.moderators]));
    return m;
  }, [myComms]);
  const nameByComm = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of myComms ?? []) m.set(c.addr, c.name);
    return m;
  }, [myComms]);

  // A report is resolved once a moderator of its community removed/dismissed it.
  const resolved = useMemo(() => {
    const set = new Set<string>();
    for (const l of labels) {
      if (l.namespace !== NS_MOD || !l.targetEvent) continue;
      if (l.value !== "remove" && l.value !== "dismiss") continue;
      if (modsByComm.get(l.community)?.has(l.author)) set.add(l.targetEvent);
    }
    return set;
  }, [labels, modsByComm]);

  // The mod log: append-only remove/dismiss actions by mods, newest first.
  const modLog = useMemo(
    () =>
      labels
        .filter(
          (l) =>
            l.namespace === NS_MOD &&
            (l.value === "remove" || l.value === "dismiss") &&
            modsByComm.get(l.community)?.has(l.author)
        )
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 50),
    [labels, modsByComm]
  );

  const openReports = useMemo(
    () =>
      reports
        .filter((r) => !(r.targetEvent && resolved.has(r.targetEvent)))
        .sort((a, b) => b.created_at - a.created_at),
    [reports, resolved]
  );

  const act = async (r: Report, value: "remove" | "dismiss") => {
    if (!r.community || busy) return;
    setBusy(r.id);
    try {
      await publishLabel(ndk, {
        namespace: NS_MOD,
        value,
        community: r.community,
        targetEvent: r.targetEvent,
        targetPubkey: r.targetPubkey,
        note: `${value} — report: ${r.type}`,
      });
      refresh();
    } catch {
      /* relay rejected */
    } finally {
      setBusy(null);
    }
  };

  if (!canSign) {
    return <div className="p-8 text-center text-sm text-muted">Log in as a moderator to see the moderation queue.</div>;
  }
  if (myComms === null) {
    return <div className="p-8 text-center text-sm text-muted">Loading your communities…</div>;
  }
  if (myComms.length === 0) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-muted">
        You don’t moderate any communities yet. Create one, or ask an owner to add you as a moderator.
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="border-b border-border px-4 py-2.5">
        <span className="eyebrow">moderation</span>
        <span className="meta"> · {myComms.length} communities · {openReports.length} open reports</span>
      </div>

      <section className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-text">Reports queue</h2>
        {openReports.length === 0 ? (
          <p className="text-sm text-muted">Nothing to review. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {openReports.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-panel p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-400">{r.type}</span>
                  <span className="meta">{nameByComm.get(r.community ?? "") ?? "community"}</span>
                  <span className="meta">· {timeAgo(r.created_at)}</span>
                  <span className="meta">· post {short(r.targetEvent)}</span>
                </div>
                {r.reason && <p className="mt-1.5 text-sm text-text">{r.reason}</p>}
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => act(r, "remove")}
                    className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-red-400 disabled:opacity-50"
                  >
                    remove post
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => act(r, "dismiss")}
                    className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-text disabled:opacity-50"
                  >
                    dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-border p-4">
        <h2 className="mb-2 text-sm font-semibold text-text">Mod log</h2>
        {modLog.length === 0 ? (
          <p className="text-sm text-muted">No moderation actions recorded yet.</p>
        ) : (
          <ul className="space-y-1">
            {modLog.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1.5 text-xs">
                <span className={l.value === "remove" ? "text-red-400" : "text-muted"}>{l.value}</span>
                <span className="meta">{nameByComm.get(l.community) ?? "community"}</span>
                <span className="meta">· {short(l.targetEvent)}</span>
                {l.note && <span className="text-muted">· {l.note}</span>}
                <span className="meta ml-auto">{timeAgo(l.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
