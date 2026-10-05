import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Gift, Maximize, Minimize, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { GiftCard, UnwrapOverlay } from "@/components/stories/Present";
import { LangSwitch } from "@/components/stories/LangSwitch";
import { UploadView } from "@/components/stories/UploadView";
import { t, uiError, type UiError } from "@/lib/stories/copy";
import { loadShelf, markUnwrapped, putStory, removeStory } from "@/lib/stories/db";
import { formatClock, formatLength } from "@/lib/stories/format";
import { useLang } from "@/lib/stories/lang";
import { useKidsMode, useMaxMinutes } from "@/lib/stories/kids";
import { CODE, codeOf, report } from "@/lib/stories/log";
import { discardStoryFiles, getPlayableUrl, releasePlayableUrl, rememberStory } from "@/lib/stories/source";
import { cloudStatus, listCloudStories, loadCovers, mergeCloud, openFamilyShelf, publishRecord, unpublishStory } from "@/lib/stories/sync";
import type { Story } from "@/lib/stories/types";

type Mode =
  | { type: "shelf" }
  | { type: "upload"; story: Story | null }
  | { type: "unwrap"; story: Story }
  | { type: "play"; story: Story };

type Playhead = { story: Story; index: number; url: string };

function CoverImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob.size) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!url) return <div className="aspect-3/4 bg-sky-deep" />;
  return <img src={url} alt={alt} className="aspect-3/4 w-full object-cover" />;
}

function storyLengthMs(story: Story) {
  const fromClips = story.clips.reduce((sum, clip) => sum + Math.max(0, clip.durationMs), 0);
  return fromClips || story.durationMs || 0;
}

function storySpan(story: Story) {
  return story.clips.reduce((sum, clip) => sum + Math.max(0, clip.durationMs), 0) || story.durationMs || 1;
}

function placeInStory(story: Story, ms: number) {
  const total = storySpan(story);
  let cursor = Math.min(Math.max(0, ms), Math.max(0, total - 80));
  let covered = 0;
  for (let index = 0; index < story.clips.length; index++) {
    const duration = Math.max(story.clips[index].durationMs, 1);
    if (cursor < covered + duration || index === story.clips.length - 1) {
      return { index, seconds: Math.max(0, (cursor - covered) / 1000) };
    }
    covered += duration;
  }
  return { index: 0, seconds: 0 };
}

function offsetInStory(story: Story, index: number, seconds: number) {
  let ms = 0;
  for (let clip = 0; clip < index; clip++) ms += Math.max(0, story.clips[clip].durationMs);
  return ms + Math.max(0, seconds) * 1000;
}

function fullscreenElement() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function portraitScreen() {
  return window.innerHeight > window.innerWidth;
}

export function StoriesApp() {
  const [gate, setGate] = useState<"checking" | "locked" | "open">("checking");
  const [passphrase, setPassphrase] = useState("");
  const [gateError, setGateError] = useState<UiError | null>(null);
  const [opening, setOpening] = useState(false);
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [lang] = useLang();
  const text = t(lang);
  const [kids, setKids] = useKidsMode();
  const [savedMaxMinutes, setMaxMinutes] = useMaxMinutes();
  const [stories, setStories] = useState<Story[] | null>(null);
  const storiesRef = useRef<Story[] | null>(null);
  storiesRef.current = stories;
  const [shelfError, setShelfError] = useState<UiError | null>(null);
  const [mode, setMode] = useState<Mode>({ type: "shelf" });
  const [pendingDelete, setPendingDelete] = useState<Story | null>(null);
  const [paused, setPaused] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [chromeOn, setChromeOn] = useState(true);
  const [chromeTick, setChromeTick] = useState(0);
  const [fullOn, setFullOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<Playhead | null>(null);
  const closingRef = useRef(false);
  const flightRef = useRef(0);
  const draggingRef = useRef(false);
  const scrubMs = useRef(0);
  const scrubTimer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const primeRef = useRef<{ id: string; promise: Promise<string> } | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = text.app;
  }, [lang, text.app]);

  useEffect(() => {
    let cancel = false;
    cloudStatus()
      .then((status) => {
        if (cancel) return;
        setPhoneOnly(!status.enabled);
        setGate(status.enabled && !status.signedIn ? "locked" : "open");
      })
      .catch((error) => {
        report("could not read cloud status", error);
        if (!cancel) setGate("open");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (gate !== "open") return;
    let ticket = 0;
    let cancel = false;
    const load = () => {
      const mine = ++ticket;
      void (async () => {
        try {
          const remote = await listCloudStories();
          if (cancel || mine !== ticket) return;
          if (!remote) {
            const rows = await loadShelf();
            if (cancel || mine !== ticket) return;
            setShelfError(null);
            setStories(rows);
            return;
          }
          setShelfError(null);
          setStories((current) => mergeCloud(remote, current));
          const have = new Set((storiesRef.current ?? []).filter((story) => story.cover.size > 0).map((story) => story.id));
          void loadCovers(
            remote.filter((story) => !have.has(story.id)),
            (id, cover) => {
              if (cancel || mine !== ticket) return;
              setStories((list) => list?.map((item) => (item.id === id ? { ...item, cover } : item)) ?? list);
            },
          ).catch((error) => report("cover downloads stopped", error));
        } catch (error) {
          if (cancel || mine !== ticket) return;
          setShelfError(codeOf(error));
          setStories((current) => current ?? []);
        }
      })();
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", load);
    return () => {
      cancel = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", load);
    };
  }, [gate]);

  useEffect(() => {
    if (pendingDelete) keepRef.current?.focus();
  }, [pendingDelete]);

  const closePlayer = useCallback(() => {
    closingRef.current = true;
    flightRef.current += 1;
    draggingRef.current = false;
    if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    const url = playRef.current?.url;
    playRef.current = null;
    if (url) releasePlayableUrl(url);
    setPaused(false);
    setNeedsTap(false);
    setPositionMs(0);
    setFullOn(false);
    try {
      screen.orientation?.unlock();
    } catch {
      /* some browsers keep the orientation lock to themselves */
    }
    const doc = document as Document & { webkitExitFullscreen?: () => void };
    if (fullscreenElement()) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    }
    setMode({ type: "shelf" });
    window.setTimeout(() => {
      closingRef.current = false;
    }, 400);
  }, []);

  const goTo = useCallback(async (story: Story, index: number, startSec = 0, play = true) => {
    const ticket = ++flightRef.current;
    const clip = story.clips[index];
    if (!clip) {
      closePlayer();
      return;
    }
    let url = "";
    try {
      url = await getPlayableUrl(clip);
      if (ticket !== flightRef.current) {
        releasePlayableUrl(url);
        return;
      }
      const video = videoRef.current;
      if (!video) {
        releasePlayableUrl(url);
        return;
      }
      const previous = playRef.current?.url;
      playRef.current = { story, index, url };
      video.src = url;
      if (previous && previous !== url) releasePlayableUrl(previous);
      if (startSec > 0.05) {
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1) resolve();
          else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        });
        if (ticket !== flightRef.current) return;
        const cap = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : startSec;
        video.currentTime = Math.min(startSec, cap);
      }
      if (!play) {
        video.pause();
        setPaused(true);
        setNeedsTap(false);
        return;
      }
      await video.play();
      if (ticket !== flightRef.current) return;
      setPaused(false);
      setNeedsTap(false);
    } catch (error) {
      if (ticket !== flightRef.current) return;
      if (url && playRef.current?.url !== url) releasePlayableUrl(url);
      if (index + 1 < story.clips.length) {
        await goTo(story, index + 1);
        return;
      }
      report("playback failed while changing clip", error);
      setShelfError(CODE.play);
      closePlayer();
    }
  }, [closePlayer]);

  function prime(story: Story) {
    if (!story.clips[0] || primeRef.current?.id === story.id) return;
    if (primeRef.current) {
      const stale = primeRef.current;
      primeRef.current = null;
      void stale.promise.then(releasePlayableUrl).catch(() => {});
    }
    primeRef.current = { id: story.id, promise: getPlayableUrl(story.clips[0]) };
    window.setTimeout(() => {
      if (primeRef.current?.id !== story.id) return;
      const pending = primeRef.current;
      primeRef.current = null;
      void pending.promise.then(releasePlayableUrl).catch(() => {});
    }, 4000);
  }

  async function openStory(story: Story) {
    if (!story.clips.length) {
      setShelfError("noclips");
      return;
    }
    const ticket = ++flightRef.current;
    setShelfError(null);
    setPositionMs(0);
    const primed = primeRef.current?.id === story.id ? primeRef.current.promise : getPlayableUrl(story.clips[0]);
    primeRef.current = null;
    let url = "";
    try {
      url = await primed;
    } catch (error) {
      setShelfError(codeOf(error));
      return;
    }
    if (ticket !== flightRef.current) {
      releasePlayableUrl(url);
      return;
    }
    const video = videoRef.current;
    if (!video) {
      releasePlayableUrl(url);
      return;
    }
    const previous = playRef.current?.url;
    playRef.current = { story, index: 0, url };
    video.src = url;
    if (previous) releasePlayableUrl(previous);
    try {
      await video.play();
      if (ticket !== flightRef.current) return;
      setPaused(false);
      setNeedsTap(false);
    } catch {
      if (ticket !== flightRef.current) return;
      setPaused(true);
      setNeedsTap(true);
    }
    if (ticket !== flightRef.current) return;
    if (!story.unwrapped) {
      const opened = { ...story, unwrapped: true, updatedAt: Date.now() };
      playRef.current = { story: opened, index: 0, url };
      setStories((list) => list?.map((item) => (item.id === story.id ? opened : item)) ?? list);
      setMode({ type: "unwrap", story: opened });
      if (phoneOnly) {
        void markUnwrapped(story.id).catch((error) => report("could not mark story unwrapped", error));
        void rememberStory(opened).catch((error) => report("could not remember unwrapped story", error));
      } else {
        void publishRecord(opened).catch((error) => report("could not publish unwrapped story", error));
      }
      return;
    }
    setMode({ type: "play", story });
  }

  function onEnded() {
    if (closingRef.current) return;
    const current = playRef.current;
    if (!current) return;
    const next = current.index + 1;
    if (next >= current.story.clips.length) {
      closePlayer();
      return;
    }
    void goTo(current.story, next);
  }

  function onVideoError() {
    if (closingRef.current) return;
    const video = videoRef.current;
    if (!video?.currentSrc) return;
    const current = playRef.current;
    if (!current) return;
    if (current.index + 1 < current.story.clips.length) {
      void goTo(current.story, current.index + 1);
      return;
    }
    const media = video.error;
    report("playback stopped", {
      code: media?.code,
      message: media?.message,
      index: current.index,
      path: current.story.clips[current.index]?.path,
    });
    setShelfError(CODE.play);
    closePlayer();
  }

  function onTime() {
    if (draggingRef.current) return;
    const head = playRef.current;
    const video = videoRef.current;
    if (!head || !video) return;
    const next = offsetInStory(head.story, head.index, video.currentTime || 0);
    setPositionMs(Math.min(next, storySpan(head.story)));
  }

  function onScrub(nextMs: number) {
    const head = playRef.current;
    const video = videoRef.current;
    if (!head || !video) return;
    draggingRef.current = true;
    scrubMs.current = nextMs;
    setPositionMs(nextMs);
    const spot = placeInStory(head.story, nextMs);
    if (spot.index === head.index) {
      if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
      const cap = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : spot.seconds;
      video.currentTime = Math.min(spot.seconds, cap);
      return;
    }
    if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
    scrubTimer.current = window.setTimeout(() => {
      scrubTimer.current = null;
      void goTo(head.story, spot.index, spot.seconds, !video.paused);
    }, 180);
  }

  function endScrub() {
    const head = playRef.current;
    const video = videoRef.current;
    const pending = scrubTimer.current;
    draggingRef.current = false;
    wakeChrome();
    if (!pending || !head || !video) return;
    window.clearTimeout(pending);
    scrubTimer.current = null;
    const spot = placeInStory(head.story, scrubMs.current);
    if (spot.index !== head.index) void goTo(head.story, spot.index, spot.seconds, !video.paused);
  }

  function wakeChrome() {
    setChromeOn(true);
    setChromeTick((tick) => tick + 1);
  }

  async function toggleFullscreen() {
    const stage = stageRef.current;
    if (!stage) return;
    wakeChrome();
    if (fullscreenElement()) {
      try {
        screen.orientation?.unlock();
      } catch {
        /* ignore */
      }
      const doc = document as Document & { webkitExitFullscreen?: () => void };
      if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    const el = stage as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (stage.requestFullscreen) {
        await stage.requestFullscreen({ navigationUI: "hide" });
      } else el.webkitRequestFullscreen?.();
    } catch {
      /* the browser keeps the picture in the page */
    }
    try {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
      if (orientation?.lock && portraitScreen()) await orientation.lock("landscape");
    } catch {
      /* the phone stays however the viewer is holding it */
    }
  }

  function onPressEnd() {
    const short = pressTimer.current != null;
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (!short || !chromeOn) wakeChrome();
    else setChromeOn(false);
  }

  function togglePause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || needsTap) {
      void video.play().then(() => {
        setPaused(false);
        setNeedsTap(false);
      }).catch(() => setNeedsTap(true));
      return;
    }
    video.pause();
    setPaused(true);
  }

  function onPressStart(event: React.PointerEvent<HTMLDivElement>) {
    if (needsTap) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* the press still counts if capture is unavailable */
    }
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      togglePause();
    }, 560);
  }

  async function wrapStory(story: Story) {
    if (!story.unwrapped) return;
    const wrapped = { ...story, unwrapped: false, updatedAt: Date.now() };
    setStories((list) => list?.map((item) => (item.id === story.id ? wrapped : item)) ?? list);
    try {
      if (phoneOnly) {
        await putStory(wrapped);
        await rememberStory(wrapped);
      } else {
        await publishRecord(wrapped);
      }
    } catch (error) {
      setStories((list) => list?.map((item) => (item.id === story.id ? story : item)) ?? list);
      setShelfError(codeOf(error));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const story = pendingDelete;
    setPendingDelete(null);
    try {
      await discardStoryFiles(story.id);
      await removeStory(story.id);
      await unpublishStory(story);
      setStories((list) => (list ?? []).filter((item) => item.id !== story.id));
    } catch (error) {
      setShelfError(codeOf(error));
    }
  }

  const finishUnwrap = useCallback(() => {
    setMode((current) => (current.type === "unwrap" ? { type: "play", story: current.story } : current));
  }, []);

  const watching = mode.type === "play" || mode.type === "unwrap";
  const shelfStories = stories ?? [];
  const longestMinutes = Math.max(1, ...shelfStories.map((story) => Math.ceil(storyLengthMs(story) / 60000)));
  const maxMinutes = savedMaxMinutes ?? longestMinutes;
  const visible = kids ? shelfStories.filter((story) => storyLengthMs(story) <= maxMinutes * 60000) : shelfStories;

  useEffect(() => {
    const sync = () => {
      const active = fullscreenElement() === stageRef.current;
      setFullOn(active);
      if (!active) {
        try {
          screen.orientation?.unlock();
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  useEffect(() => {
    if (mode.type !== "play") return;
    if (paused || needsTap) {
      setChromeOn(true);
      return;
    }
    setChromeOn(true);
    const id = window.setTimeout(() => {
      if (!draggingRef.current) setChromeOn(false);
    }, 2600);
    return () => window.clearTimeout(id);
  }, [mode.type, paused, needsTap, chromeTick]);

  useEffect(() => {
    if (!watching) return;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const request = () => {
      const wakeLock = navigator.wakeLock;
      if (!wakeLock || gone) return;
      wakeLock
        .request("screen")
        .then((sentinel) => {
          if (gone) void sentinel.release();
          else lock = sentinel;
        })
        .catch(() => {});
    };
    request();
    const onVisible = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [watching]);

  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  async function submitPassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpening(true);
    setGateError(null);
    try {
      const ok = await openFamilyShelf(passphrase);
      if (!ok) {
        report("family passphrase rejected");
        setGateError(CODE.passphrase);
        setOpening(false);
        return;
      }
      setPassphrase("");
      setOpening(false);
      setGate("open");
    } catch (error) {
      setGateError(codeOf(error));
      setOpening(false);
    }
  }

  if (gate !== "open") {
    return (
      <main className="app-shell min-h-dvh bg-sky text-ink">
        <form className="mx-auto grid min-h-dvh w-full max-w-lg content-center gap-4 px-5" onSubmit={(event) => void submitPassphrase(event)}>
          <div className="flex justify-end">
            <LangSwitch />
          </div>
          <h1 className="font-display text-4xl font-semibold">{text.app}</h1>
          <p className="text-lg font-bold text-muted">{gate === "checking" ? text.openingShelf : text.privateShelf}</p>
          {gate === "locked" ? (
            <>
              <input
                type="password"
                name="passphrase"
                autoComplete="current-password"
                className="min-h-14 rounded-3xl bg-card px-4 text-lg font-bold shadow-lift"
                placeholder={text.passphrase}
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              {gateError ? (
                <p className="font-bold" role="alert">
                  {uiError(lang, gateError)}
                </p>
              ) : null}
              <button type="submit" className="btn-primary tap" disabled={opening || passphrase.length === 0}>
                {opening ? text.opening : text.open}
              </button>
            </>
          ) : null}
        </form>
      </main>
    );
  }

  return (
    <>
      <div ref={stageRef} className={watching ? "player-stage" : "player-idle"}>
        <div className="player-fit">
          <video
            ref={videoRef}
            className="player-video"
            playsInline
            preload="auto"
            controls={false}
            disablePictureInPicture
            controlsList="nodownload nofullscreen noremoteplayback"
            onEnded={onEnded}
            onError={onVideoError}
            onTimeUpdate={onTime}
            onContextMenu={(event) => event.preventDefault()}
          />
        </div>
        {mode.type === "play" ? (
          <>
            <div
              className="player-catch"
              onPointerDown={onPressStart}
              onPointerUp={onPressEnd}
              onPointerCancel={onPressEnd}
              onContextMenu={(event) => event.preventDefault()}
            >
              {needsTap ? (
                <button
                  type="button"
                  className="play-fallback tap"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => togglePause()}
                >
                  {text.play}
                </button>
              ) : null}
              <span className="sr-only">
                {paused ? text.paused : text.playing} {text.tapForButtons}
              </span>
            </div>
            <div className={chromeOn ? "player-chrome" : "player-chrome is-hidden"} inert={chromeOn ? undefined : true}>
              <div className="player-top">
                <button type="button" className="shelf-back tap" onClick={closePlayer}>
                  <ArrowLeft className="size-6" aria-hidden="true" />
                  {text.shelf}
                </button>
                <button
                  type="button"
                  className="full-btn tap"
                  aria-label={fullOn ? text.leaveFull : text.fullScreen}
                  onClick={() => void toggleFullscreen()}
                >
                  {fullOn ? (
                    <Minimize className="size-6" aria-hidden="true" />
                  ) : (
                    <Maximize className="size-6" aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="player-bar">
                <button
                  type="button"
                  className="play-toggle tap"
                  aria-label={paused || needsTap ? text.play : text.pause}
                  onClick={() => {
                    wakeChrome();
                    togglePause();
                  }}
                >
                  {paused || needsTap ? (
                    <Play className="size-7" fill="currentColor" aria-hidden="true" />
                  ) : (
                    <Pause className="size-7" fill="currentColor" aria-hidden="true" />
                  )}
                </button>
                <div className="grid min-w-0 gap-1">
                  <span className="player-times">
                    <span>{formatClock(positionMs)}</span>
                    <span>{formatClock(storySpan(mode.story))}</span>
                  </span>
                  <div
                    className="scrub"
                    role="slider"
                    tabIndex={0}
                    aria-label={text.scrub}
                    aria-valuemin={0}
                    aria-valuemax={storySpan(mode.story)}
                    aria-valuenow={Math.min(positionMs, storySpan(mode.story))}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      wakeChrome();
                      const span = storySpan(mode.story);
                      const rect = event.currentTarget.getBoundingClientRect();
                      const ratio = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
                      onScrub(ratio * span);
                    }}
                    onPointerMove={(event) => {
                      if (!draggingRef.current) return;
                      const span = storySpan(mode.story);
                      const rect = event.currentTarget.getBoundingClientRect();
                      const ratio = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
                      onScrub(ratio * span);
                    }}
                    onPointerUp={endScrub}
                    onPointerCancel={endScrub}
                    onKeyDown={(event) => {
                      const span = storySpan(mode.story);
                      const step = event.shiftKey ? 10000 : 2000;
                      if (event.key === "ArrowRight") {
                        event.preventDefault();
                        onScrub(Math.min(span, positionMs + step));
                      }
                      if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        onScrub(Math.max(0, positionMs - step));
                      }
                    }}
                    onKeyUp={endScrub}
                  >
                    <span
                      className="scrub-fill"
                      style={{ width: `${storySpan(mode.story) ? (Math.min(positionMs, storySpan(mode.story)) / storySpan(mode.story)) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
      <main className="app-shell min-h-dvh bg-sky text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        {mode.type === "upload" ? (
          <UploadView
            story={mode.story}
            onCancel={() => setMode({ type: "shelf" })}
            onSaved={(story) => {
              setStories((list) => {
                const items = list ?? [];
                if (!items.some((item) => item.id === story.id)) return [story, ...items];
                return items.map((item) => (item.id === story.id ? story : item));
              });
              setMode({ type: "shelf" });
            }}
          />
        ) : mode.type === "shelf" ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
              <div>
                <h1 className="font-display text-4xl font-semibold">{text.app}</h1>
                {phoneOnly ? <p className="font-bold text-muted">{text.phoneOnly}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LangSwitch />
                <button
                  type="button"
                  role="switch"
                  aria-checked={kids}
                  aria-label={text.kidsMode}
                  className="tap flex min-h-12 items-center gap-2 rounded-full bg-card px-3 py-2 shadow-lift"
                  onClick={() => setKids(!kids)}
                >
                  <span className="font-extrabold">{text.kids}</span>
                  <span className={kids ? "switch-track on" : "switch-track"}>
                    <span className="switch-knob" />
                  </span>
                </button>
              </div>
            </header>
            {!kids ? (
              <div className="grid gap-3 px-5 pb-4">
                <label className="limit-card">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-extrabold">{text.kidsShelf}</span>
                    <span className="font-extrabold text-cobalt">{text.upTo(maxMinutes)}</span>
                  </span>
                  <input
                    className="limit-slider"
                    type="range"
                    min={1}
                    max={Math.max(longestMinutes, maxMinutes)}
                    step={1}
                    value={maxMinutes}
                    aria-valuetext={text.minutes(maxMinutes)}
                    onChange={(event) => setMaxMinutes(Number(event.target.value))}
                  />
                  <span className="text-base font-bold text-muted">{text.kidsHint}</span>
                </label>
                <button type="button" className="btn-primary tap" onClick={() => setMode({ type: "upload", story: null })}>
                  <Plus className="size-6" aria-hidden="true" />
                  {text.newStory}
                </button>
              </div>
            ) : null}
            {shelfError ? (
              <p className="mx-5 mb-3 rounded-3xl bg-card px-4 py-3 font-bold" role="alert">
                {uiError(lang, shelfError)}
              </p>
            ) : null}
            {stories === null ? (
              <p className="flex items-center gap-2 px-5 font-bold text-muted">
                <span className="busy-dot" /> {text.openingShelf}
              </p>
            ) : stories.length === 0 ? (
              <section className="mx-5 rounded-card bg-card px-5 py-8 text-center shadow-lift">
                <h2 className="font-display text-3xl font-semibold">{text.shelfClear}</h2>
                <p className="mt-2 text-lg font-bold text-muted">
                  {kids ? text.nothingYet : text.addPresent}
                </p>
              </section>
            ) : visible.length === 0 ? (
              <section className="mx-5 rounded-card bg-card px-5 py-8 text-center shadow-lift">
                <h2 className="font-display text-3xl font-semibold">{text.nothingTitle}</h2>
                <p className="mt-2 text-lg font-bold text-muted">{text.shorterHere}</p>
              </section>
            ) : (
              <div className="shelf-row" role="list" aria-label={text.stories}>
                {visible.map((story) => (
                  <article key={story.id} className="story-card" role="listitem">
                    <button
                      type="button"
                      className="tap relative block w-full overflow-hidden rounded-card bg-card text-left shadow-lift"
                      aria-label={story.unwrapped ? story.title : text.present}
                      onPointerDown={() => prime(story)}
                      onClick={() => void openStory(story)}
                    >
                      {story.unwrapped ? (
                        <>
                          <CoverImage blob={story.cover} alt="" />
                          <div className="card-caption">
                            <h2>{story.title}</h2>
                            {!kids ? <p>{formatLength(story.durationMs, lang)}</p> : null}
                          </div>
                        </>
                      ) : (
                        <GiftCard />
                      )}
                    </button>
                    {!kids ? (
                      <>
                        <button
                          type="button"
                          className="tap absolute top-2 left-2 grid size-11 place-items-center rounded-full bg-card text-cobalt shadow-lift"
                          aria-label={story.unwrapped ? text.editNamed(story.title) : text.editPresent}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setMode({ type: "upload", story })}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="tap absolute top-2 right-2 grid size-11 place-items-center rounded-full bg-card text-cobalt shadow-lift"
                          aria-label={story.unwrapped ? text.deleteNamed(story.title) : text.deletePresent}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setPendingDelete(story)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                        {story.unwrapped ? (
                          <button
                            type="button"
                            className="tap mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-card font-extrabold text-cobalt shadow-lift"
                            aria-label={text.wrapNamed(story.title)}
                            onClick={() => void wrapStory(story)}
                          >
                            <Gift className="size-4" aria-hidden="true" />
                            {text.wrap}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
      {mode.type === "unwrap" ? <UnwrapOverlay onDone={finishUnwrap} /> : null}
      {pendingDelete ? (
        <div className="dialog-back" role="presentation" onClick={() => setPendingDelete(null)}>
          <div
            className="dialog-card grid gap-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-title" className="font-display text-3xl font-semibold">
              {text.deleteAsk}
            </h2>
            <p className="text-lg font-bold text-muted">{text.deleteHint}</p>
            <button ref={keepRef} type="button" className="btn-primary tap" onClick={() => setPendingDelete(null)}>
              {text.keep}
            </button>
            <button type="button" className="btn-quiet tap" onClick={() => void confirmDelete()}>
              {text.delete}
            </button>
          </div>
        </div>
      ) : null}
    </main>
    </>
  );
}
