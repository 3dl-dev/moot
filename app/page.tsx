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
import { ExploreFeed } from "./components/ExploreFeed";
import { ContentSettings } from "./components/ContentSettings";
import { Notifications } from "./components/Notifications";
import { ModQueue } from "./components/ModQueue";
import { SavedView } from "./components/SavedView";
import { HistoryView } from "./components/HistoryView";
import { SearchView } from "./components/SearchView";
import { ListFeed, CreateList } from "./components/Lists";
import { TopicsDirectory, TopicFeed } from "./components/Topics";
import type { View } from "@/lib/nav";
import type { NDKKind } from "@nostr-dev-kit/ndk";
import { isTopLevelNote, looksLikeContent, publishNote } from "@/lib/nostr";
import { isPoll, KIND_POLL } from "@/lib/polls";

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
              filters={{ kinds: [1 as NDKKind, KIND_POLL as NDKKind], limit: 80 }}
              accept={(e) => isPoll(e) || (isTopLevelNote(e) && looksLikeContent(e.content))}
              publish={(ndk, text) => publishNote(ndk, text)}
              toolbarLabel="all · unfiltered firehose"
              composerPlaceholder="Post to Nostr…"
              draftKey="post:all"
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

          {view.kind === "discover" && <ExploreFeed onNavigate={setView} />}

          {view.kind === "dvm-directory" && (
            <DvmDirectory onOpen={(provider) => setView({ kind: "dvm", provider })} />
          )}

          {view.kind === "dvm" && (
            <DvmFeed key={view.provider.pubkey} provider={view.provider} onNavigate={setView} />
          )}

          {view.kind === "topics" && (
            <TopicsDirectory onOpen={(topic) => setView({ kind: "topic", topic })} />
          )}

          {view.kind === "topic" && (
            <TopicFeed key={view.topic.slug} topic={view.topic} onBack={() => setView({ kind: "topics" })} />
          )}

          {view.kind === "notifications" && <Notifications />}

          {view.kind === "mod-queue" && <ModQueue />}

          {view.kind === "saved" && <SavedView />}

          {view.kind === "history" && <HistoryView />}

          {view.kind === "search" && <SearchView />}

          {view.kind === "list" && (
            <ListFeed key={view.id} id={view.id} onManage={() => setView({ kind: "create-list" })} />
          )}

          {view.kind === "create-list" && <CreateList onNavigate={setView} />}

          {view.kind === "settings" && <ContentSettings />}
        </main>
      </div>
    </div>
  );
}
