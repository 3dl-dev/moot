"use client";

import { useState } from "react";
import { TopBar } from "./components/TopBar";
import { LeftNav } from "./components/LeftNav";
import { Feed } from "./components/Feed";
import { HomeFeed } from "./components/HomeFeed";
import { FollowingFeed } from "./components/FollowingFeed";
import { Directory } from "./components/Directory";
import { CommunityFeed } from "./components/CommunityFeed";
import { CreateCommunity } from "./components/CreateCommunity";
import { DvmDirectory } from "./components/DvmDirectory";
import { DvmFeed } from "./components/DvmFeed";
import { ContentSettings } from "./components/ContentSettings";
import type { View } from "@/lib/nav";
import { isTopLevelNote, looksLikeContent, publishNote } from "@/lib/nostr";

export default function Home() {
  const [view, setView] = useState<View>({ kind: "home" });

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftNav current={view} onNavigate={setView} />
        <main className="pane-scroll min-w-0 flex-1 overflow-y-auto">
          {view.kind === "home" && <HomeFeed onNavigate={setView} />}

          {view.kind === "following" && <FollowingFeed onNavigate={setView} />}

          {view.kind === "feed" && (
            <Feed
              filters={{ kinds: [1], limit: 80 }}
              accept={(e) => isTopLevelNote(e) && looksLikeContent(e.content)}
              publish={(ndk, text) => publishNote(ndk, text)}
              toolbarLabel="all · unfiltered firehose"
              composerPlaceholder="Post to Nostr…"
            />
          )}

          {view.kind === "communities" && (
            <Directory
              onOpen={(community) => setView({ kind: "community", community })}
              onCreate={() => setView({ kind: "create-community" })}
            />
          )}

          {view.kind === "community" && (
            <CommunityFeed
              key={view.community.addr}
              community={view.community}
              onBack={() => setView({ kind: "communities" })}
            />
          )}

          {view.kind === "create-community" && (
            <CreateCommunity
              onCreated={(community) => setView({ kind: "community", community })}
              onCancel={() => setView({ kind: "communities" })}
            />
          )}

          {view.kind === "discover" && (
            <DvmDirectory onOpen={(provider) => setView({ kind: "dvm", provider })} />
          )}

          {view.kind === "dvm" && (
            <DvmFeed key={view.provider.pubkey} provider={view.provider} onNavigate={setView} />
          )}

          {view.kind === "settings" && <ContentSettings />}
        </main>
      </div>
    </div>
  );
}
