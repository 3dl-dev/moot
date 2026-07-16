"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useProfile, displayName, handle } from "@/lib/hooks";
import { timeAgo } from "@/lib/nostr";
import { decodeNostrToken } from "@/lib/mentions";
import { mutePubkey } from "@/lib/mute";
import { AttachButton } from "./AttachButton";

/* --------------------------------------------------------------- avatar */

function avatarFallback(pubkey: string): string {
  const hue = parseInt(pubkey.slice(0, 6), 16) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' rx='20' fill='hsl(${hue} 40% 42%)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function Avatar({ pubkey, img, size = 36 }: { pubkey: string; img?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={img || avatarFallback(pubkey)}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full bg-panel-2 object-cover"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = avatarFallback(pubkey);
      }}
    />
  );
}

/* ------------------------------------------------------------- headers */

/** Rich header for a post card: avatar, name, mono handle·time, follow/hide. */
export function PostCardHeader({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey);
  const img = profile?.image || profile?.picture;
  return (
    <div className="flex items-start gap-2.5">
      <Avatar pubkey={event.pubkey} img={img} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] font-semibold text-text">
          {displayName(event.pubkey, profile)}
        </div>
        <div className="meta truncate">
          {handle(event.pubkey, profile)} · {timeAgo(event.created_at)}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <StubButton>follow</StubButton>
        <button
          type="button"
          onClick={() => mutePubkey(event.pubkey)}
          title="Hide this account (local, no login)"
          className="meta rounded border border-border px-1.5 py-0.5 transition-colors hover:border-red-400/50 hover:text-red-300"
        >
          hide
        </button>
      </div>
    </div>
  );
}

/** Compact inline header for a comment. */
export function CommentHeader({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey);
  const img = profile?.image || profile?.picture;
  return (
    <div className="flex items-center gap-2">
      <Avatar pubkey={event.pubkey} img={img} size={20} />
      <span className="truncate text-[0.8125rem] font-semibold text-text">
        {displayName(event.pubkey, profile)}
      </span>
      <span className="meta shrink-0">{timeAgo(event.created_at)}</span>
    </div>
  );
}

function StubButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="meta rounded border border-border px-1.5 py-0.5 transition-colors hover:border-brass/50 hover:text-text"
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------- topic chips */

export function TopicChips({ event }: { event: NDKEvent }) {
  const topics = event.tags
    .filter((t) => t[0] === "t" && t[1])
    .slice(0, 3)
    .map((t) => t[1]);
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((t) => (
        <span
          key={t}
          className="meta rounded border border-brass/30 px-1.5 py-0.5 text-brass"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- content */

const IMG_RE = /\.(jpe?g|png|gif|webp|avif|bmp)(\?|$)/i;
const VID_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const YT_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i;
const VIMEO_RE = /vimeo\.com\/(\d+)/i;

/** Render note content: linkify URLs, inline images, embed video. `imeta` holds
 *  extra image URLs from NIP-92 tags (photo-first posts) to append if not
 *  already present in the text. */
export function ContentBody({ text, imeta = [] }: { text: string; imeta?: string[] }) {
  const nodes: ReactNode[] = [];
  const embeds: ReactNode[] = [];
  // Collapse runs of blank lines so bot posts don't leave canyons of whitespace.
  const tokens = text.replace(/\n{3,}/g, "\n\n").trim().split(/(\s+)/);

  tokens.forEach((tok, i) => {
    // NIP-27 mentions & entity refs (nostr:npub…, nostr:nevent…, …)
    if (/^(nostr:)?(npub1|nprofile1|note1|nevent1|naddr1)/i.test(tok)) {
      const nt = decodeNostrToken(tok);
      if (nt.kind === "npub") {
        nodes.push(<Mention key={`m${i}`} pubkey={nt.pubkey} bech32={nt.bech32} />);
        if (nt.rest) nodes.push(nt.rest);
        return;
      }
      if (nt.kind === "ref") {
        nodes.push(
          <a
            key={`r${i}`}
            href={`https://njump.me/${nt.bech32}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            ↗ {nt.bech32.slice(0, 12)}…
          </a>
        );
        if (nt.rest) nodes.push(nt.rest);
        return;
      }
    }
    if (!/^https?:\/\//i.test(tok)) {
      nodes.push(tok);
      return;
    }
    const yt = tok.match(YT_RE);
    const vimeo = tok.match(VIMEO_RE);
    if (IMG_RE.test(tok)) {
      embeds.push(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`e${i}`}
          src={tok}
          alt=""
          className="max-h-80 w-full rounded-md border border-border object-cover"
          loading="lazy"
        />
      );
    } else if (VID_RE.test(tok)) {
      embeds.push(
        <video
          key={`e${i}`}
          src={tok}
          controls
          className="max-h-80 w-full rounded-md border border-border"
        />
      );
    } else if (yt) {
      embeds.push(<Embed key={`e${i}`} src={`https://www.youtube.com/embed/${yt[1]}`} />);
    } else if (vimeo) {
      embeds.push(<Embed key={`e${i}`} src={`https://player.vimeo.com/video/${vimeo[1]}`} />);
    } else {
      nodes.push(
        <a
          key={`l${i}`}
          href={tok}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-accent hover:underline"
        >
          {tok}
        </a>
      );
    }
  });

  // Append NIP-92 imeta images that weren't already inlined from the text.
  imeta.forEach((url, i) => {
    if (text.includes(url)) return;
    embeds.push(
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={`im${i}`}
        src={url}
        alt=""
        className="max-h-96 w-full rounded-md border border-border object-cover"
        loading="lazy"
      />
    );
  });

  return (
    <div className="space-y-2.5">
      <div className="post-body text-[0.875rem] leading-relaxed text-text/95">{nodes}</div>
      {embeds.length > 0 && <div className="space-y-2">{embeds}</div>}
    </div>
  );
}

function Mention({ pubkey, bech32 }: { pubkey: string; bech32: string }) {
  const profile = useProfile(pubkey);
  return (
    <a
      href={`https://njump.me/${bech32}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-accent hover:underline"
    >
      @{displayName(pubkey, profile)}
    </a>
  );
}

/** Clamp tall content with a faded bottom and a Read more / Show less toggle. */
export function Foldable({ children, max = 340 }: { children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollHeight > max + 48);
    check();
    // Re-check as images load and change the height.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);

  const collapsed = overflow && !open;
  return (
    <div>
      <div
        ref={ref}
        style={
          collapsed
            ? {
                maxHeight: max,
                overflow: "hidden",
                WebkitMaskImage: "linear-gradient(to bottom, #000 68%, transparent)",
                maskImage: "linear-gradient(to bottom, #000 68%, transparent)",
              }
            : undefined
        }
      >
        {children}
      </div>
      {overflow && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-xs font-medium text-accent hover:underline"
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function Embed({ src }: { src: string }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-md border border-border">
      <iframe
        src={src}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/* --------------------------------------------------------------- nsfw gate */

/** Blur flagged content until the reader chooses to reveal it (Show NSFW on). */
export function NsfwGate({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) return <>{children}</>;
  return (
    <div className="relative overflow-hidden rounded-md">
      <div className="pointer-events-none select-none blur-xl">{children}</div>
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="absolute inset-0 flex items-center justify-center bg-bg/50"
      >
        <span className="rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-medium text-text">
          NSFW · tap to reveal
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ composer */

export function ReplyBox({
  placeholder,
  submitLabel = "Reply",
  busy,
  onSubmit,
  autoFocus,
}: {
  placeholder: string;
  submitLabel?: string;
  busy?: boolean;
  onSubmit: (text: string) => void | Promise<void>;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    await onSubmit(t);
    setText("");
  };
  return (
    <div className="rounded-md border border-border bg-panel-2 p-2 focus-within:border-brass/40">
      <textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
        }}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y bg-transparent text-[0.875rem] text-text placeholder:text-muted focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AttachButton
            onUploaded={(url) => setText((t) => (t.trim() ? `${t.trim()}\n${url}` : url))}
          />
          <span className="meta hidden sm:inline">⌘/Ctrl + Enter</span>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-black transition-opacity disabled:opacity-40"
        >
          {busy ? "…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
