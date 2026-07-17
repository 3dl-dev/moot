"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useState } from "react";
import { useNdk } from "@/app/providers";
import {
  publishApproval,
  publishReport,
  fetchApprovalEvents,
  REPORT_TYPES,
  type ReportType,
} from "@/lib/nostr";
import { publishLabel, retractLabel, NS_MOD, NS_FLAIR } from "@/lib/modlabels";
import { useMod } from "./ModContext";

/**
 * Per-post moderation controls, shown inside a community view. Community
 * moderators get approve / remove / pin / lock / flair; any logged-in member can
 * file a NIP-56 report. Actions publish to Nostr and then refresh the feed's
 * moderation state. Outside a community (no ModContext) this renders nothing.
 */
export function PostModBar({ event }: { event: NDKEvent }) {
  const mod = useMod();
  const { ndk, canSign } = useNdk();
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [flairing, setFlairing] = useState(false);
  const [flairText, setFlairText] = useState("");
  const [done, setDone] = useState<string | null>(null);

  if (!mod || !event.id) return null;

  const { community, isMod, state, approved, refresh } = mod;
  const id = event.id;
  const isApproved = approved.has(id);
  const isRemoved = state.removed.has(id);
  const isPinned = state.pinned.has(id);
  const isLocked = state.locked.has(id);
  const isBanned = state.banned.has(event.pubkey);

  const run = async (fn: () => Promise<unknown>, label: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setDone(label);
      setTimeout(() => setDone(null), 1500);
      refresh();
    } catch {
      /* relay rejected / cancelled — leave state as-is */
    } finally {
      setBusy(false);
    }
  };

  const label = (value: string, extra?: Record<string, unknown>) =>
    publishLabel(ndk, { namespace: NS_MOD, value, community: community.addr, targetEvent: id, targetPubkey: event.pubkey, ...extra });

  const approve = () => run(() => publishApproval(ndk, community, event), "approved");
  const remove = () =>
    isRemoved
      ? run(
          () => retractLabel(ndk, community.addr, { author: mod.me!, namespace: NS_MOD, value: "remove", targetEvent: id }),
          "restored"
        )
      : run(async () => {
          await label("remove");
          // If this post was approved, retract the kind:4550 too so honoring
          // clients drop it from the canonical feed — best-effort.
          const approvals = await fetchApprovalEvents(ndk, community.addr).catch(() => [] as NDKEvent[]);
          const mine = approvals.filter((a) => a.pubkey === mod.me && a.tags.some((t) => t[0] === "e" && t[1] === id));
          await Promise.all(mine.map((a) => a.delete().catch(() => {})));
        }, "removed");
  const togglePin = () =>
    run(
      () =>
        isPinned
          ? retractLabel(ndk, community.addr, { author: mod.me!, namespace: NS_MOD, value: "pin", targetEvent: id })
          : label("pin"),
      isPinned ? "unpinned" : "pinned"
    );
  const toggleLock = () =>
    run(
      () =>
        isLocked
          ? retractLabel(ndk, community.addr, { author: mod.me!, namespace: NS_MOD, value: "lock", targetEvent: id })
          : label("lock"),
      isLocked ? "unlocked" : "locked"
    );
  const toggleBan = () =>
    run(
      () =>
        isBanned
          ? retractLabel(ndk, community.addr, { author: mod.me!, namespace: NS_MOD, value: "ban", targetPubkey: event.pubkey })
          : publishLabel(ndk, { namespace: NS_MOD, value: "ban", community: community.addr, targetPubkey: event.pubkey }),
      isBanned ? "unbanned" : "banned"
    );
  const addFlair = () =>
    run(async () => {
      const t = flairText.trim();
      if (!t) return;
      await publishLabel(ndk, { namespace: NS_FLAIR, value: t, community: community.addr, targetEvent: id });
      setFlairText("");
      setFlairing(false);
    }, "flaired");
  const report = (type: ReportType) =>
    run(async () => {
      await publishReport(ndk, { type, targetEvent: id, targetPubkey: event.pubkey, community: community.addr });
      setReporting(false);
    }, "reported");

  const btn =
    "rounded border border-border px-1.5 py-0.5 text-[11px] transition-colors hover:text-text disabled:opacity-50";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2 text-muted">
      <span className="eyebrow text-[10px]">{isMod ? "mod" : "member"}</span>

      {isMod && (
        <>
          <button type="button" className={btn} disabled={busy} onClick={approve} title="Approve into the moderated feed (NIP-72 kind:4550)">
            {isApproved ? "✓ approved" : "approve"}
          </button>
          <button type="button" className={btn} disabled={busy} onClick={remove} title="Remove from moot (advisory — other clients may not honor it)">
            {isRemoved ? "↩ restore" : "remove"}
          </button>
          <button type="button" className={btn} disabled={busy} onClick={togglePin} title="Pin to the top of the community feed">
            {isPinned ? "unpin" : "pin"}
          </button>
          <button type="button" className={btn} disabled={busy} onClick={toggleLock} title="Lock the thread (advisory): moot disables replies">
            {isLocked ? "unlock" : "lock"}
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => setFlairing((v) => !v)} title="Add a flair tag">
            flair
          </button>
          <button type="button" className={btn} disabled={busy} onClick={toggleBan} title="Temp-ban this author in the community (advisory — moot hides their posts here)">
            {isBanned ? "unban" : "ban author"}
          </button>
        </>
      )}

      {canSign && (
        <button type="button" className={btn} disabled={busy} onClick={() => setReporting((v) => !v)} title="Report to the community's moderators (NIP-56)">
          report
        </button>
      )}

      {done && <span className="text-accent">{done}</span>}

      {flairing && isMod && (
        <div className="flex w-full items-center gap-1.5 pt-1">
          <input
            value={flairText}
            onChange={(e) => setFlairText(e.target.value)}
            placeholder="flair, e.g. OC, Discussion"
            maxLength={24}
            className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1 text-xs text-text outline-none focus:border-brass"
            onKeyDown={(e) => e.key === "Enter" && addFlair()}
          />
          <button type="button" className={btn} disabled={busy} onClick={addFlair}>
            add
          </button>
        </div>
      )}

      {reporting && (
        <div className="flex w-full flex-wrap items-center gap-1.5 pt-1">
          <span className="meta">reason:</span>
          {REPORT_TYPES.map((t) => (
            <button key={t} type="button" className={btn} disabled={busy} onClick={() => report(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
