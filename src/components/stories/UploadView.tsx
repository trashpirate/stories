import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Camera, Check, ChevronDown, ChevronUp, Image as ImageIcon, Trash2 } from "lucide-react";
import { LangSwitch } from "@/components/stories/LangSwitch";
import { t, uiError, type UiError } from "@/lib/stories/copy";
import { putStory } from "@/lib/stories/db";
import { coverKey as coverObjectKey } from "@/lib/stories/keys";
import { formatClock, formatLength } from "@/lib/stories/format";
import { useLang } from "@/lib/stories/lang";
import { CODE, codeOf, noted, report } from "@/lib/stories/log";
import { discardStoryFiles, pruneStoryFiles, readClipFile, rememberStory, requestPersistentStorage, storeClip } from "@/lib/stories/source";
import { publishStory, forgetClips, type SaveStep } from "@/lib/stories/sync";
import type { ClipSource, Story } from "@/lib/stories/types";

let saveLock = false;

type DraftClip = {
  key: string;
  file: File;
  durationMs: number;
  path?: string;
};

function isVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|webm|ogg|ogv|mkv)$/i.test(file.name);
}

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const finish = (ms: number | null) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      if (ms == null) {
        reject(noted(CODE.read, `clip metadata missing for ${file.name || "unnamed file"}`, { type: file.type, size: file.size }));
      } else resolve(ms);
    };
    video.onloadedmetadata = () => {
      const duration = video.duration;
      finish(Number.isFinite(duration) ? Math.round(duration * 1000) : 0);
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

function suggestedTime(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const end = Math.max(0, durationSec - 0.05);
  return Math.min(2, end);
}

function waitFor(video: HTMLVideoElement, event: "loadedmetadata"): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(noted(CODE.read, "cover metadata timed out"));
    }, 8000);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(noted(CODE.read, "cover video failed to load"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, onOk);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener(event, onOk);
    video.addEventListener("error", onErr);
  });
}

type ScrollLock = { node: HTMLElement; top: number } | null;

function scrollersFrom(node: HTMLElement | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  let current = node?.parentElement ?? null;
  while (current) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) found.push(current);
    current = current.parentElement;
  }
  const root = document.scrollingElement;
  if (root instanceof HTMLElement && !found.includes(root)) found.push(root);
  return found;
}

function pinScroll(anchor: HTMLElement | null, lock: { current: ScrollLock }) {
  const node = scrollersFrom(anchor)[0];
  if (!node) return;
  if (!lock.current) lock.current = { node, top: node.scrollTop };
  const top = lock.current.top;
  const restore = () => {
    node.scrollTop = top;
  };
  restore();
  requestAnimationFrame(restore);
  window.setTimeout(restore, 0);
  window.setTimeout(restore, 60);
  window.setTimeout(restore, 180);
  window.setTimeout(restore, 400);
}

function seekTo(video: HTMLVideoElement, time: number, hold?: () => void): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : time;
  const target = Math.min(Math.max(time, 0), Math.max(0, duration - 0.001));
  if (Math.abs(video.currentTime - target) < 0.03 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 1500);
    const onSeeked = () => {
      cleanup();
      hold?.();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(noted(CODE.read, "cover seek failed"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onErr);
    hold?.();
    video.currentTime = target;
    hold?.();
  });
}

function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth || 720;
  const height = video.videoHeight || 1280;
  const scale = Math.min(1, 960 / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(noted(CODE.read, "cover canvas unavailable"));
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else {
        reject(noted(CODE.read, "cover jpeg encode failed"));
      }
    }, "image/jpeg", 0.86);
  });
}

type CoverView = { zoom: number; x: number; y: number };

function coverBase(nw: number, nh: number, stageW: number, stageH: number) {
  const fit = Math.max(stageW / nw, stageH / nh);
  return { w: nw * fit, h: nh * fit };
}

function clampView(view: CoverView, nw: number, nh: number, stageW: number, stageH: number): CoverView {
  if (!nw || !nh || stageW < 1 || stageH < 1) return { zoom: 1, x: 0, y: 0 };
  const zoom = Math.min(4, Math.max(1, view.zoom));
  const base = coverBase(nw, nh, stageW, stageH);
  const maxX = Math.max(0, (base.w * zoom - stageW) / 2);
  const maxY = Math.max(0, (base.h * zoom - stageH) / 2);
  return {
    zoom,
    x: Math.min(maxX, Math.max(-maxX, view.x)),
    y: Math.min(maxY, Math.max(-maxY, view.y)),
  };
}

/** Bake the card's visible crop, including zoom and pan, into the shelf thumbnail. */
function cropView(blob: Blob, view: CoverView, stageW: number, stageH: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const nw = image.naturalWidth || 1;
      const nh = image.naturalHeight || 1;
      const clamped = clampView(view, nw, nh, stageW, stageH);
      const base = coverBase(nw, nh, stageW, stageH);
      const dispW = base.w * clamped.zoom;
      const dispH = base.h * clamped.zoom;
      const imageLeft = stageW / 2 - dispW / 2 + clamped.x;
      const imageTop = stageH / 2 - dispH / 2 + clamped.y;
      const sx = Math.max(0, ((0 - imageLeft) / dispW) * nw);
      const sy = Math.max(0, ((0 - imageTop) / dispH) * nh);
      const sw = Math.min(nw - sx, (stageW / dispW) * nw);
      const sh = Math.min(nh - sy, (stageH / dispH) * nh);
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 960;
      const ctx = canvas.getContext("2d");
      if (!ctx || sw < 1 || sh < 1) {
        reject(noted(CODE.read, "cover crop canvas unavailable"));
        return;
      }
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((next) => {
        if (next) resolve(next);
        else {
          reject(noted(CODE.read, "cover crop jpeg encode failed"));
        }
      }, "image/jpeg", 0.86);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(noted(CODE.read, "cover image failed to load"));
    };
    image.src = url;
  });
}

function CoverPicker({
  file,
  durationMs,
  clipName,
  selectedKey,
  choices,
  initialCover,
  title,
  lengthLabel,
  onChoose,
  onCover,
}: {
  file: File;
  durationMs: number;
  clipName: string;
  selectedKey: string;
  choices: { key: string; label: string }[];
  initialCover: Blob | null;
  title: string;
  lengthLabel: string;
  onChoose: (key: string) => void;
  onCover: (blob: Blob) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const clipRowRef = useRef<HTMLDivElement>(null);
  const scrollLock = useRef<ScrollLock>(null);
  const scrollTicket = useRef(0);
  const onCoverRef = useRef(onCover);
  onCoverRef.current = onCover;
  const previewRef = useRef<string | null>(null);
  const scrubToken = useRef(0);
  const cropToken = useRef(0);
  const sourceRef = useRef<Blob | null>(initialCover);
  const viewRef = useRef<CoverView>({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; x: number; y: number; ox: number; oy: number }
    | { kind: "pinch"; dist: number; zoom: number; ox: number; oy: number; mx: number; my: number }
    | null
  >(null);
  const wheelTimer = useRef(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [timeMs, setTimeMs] = useState(() => Math.min(2000, Math.max(0, durationMs)));
  const [view, setView] = useState<CoverView>({ zoom: 1, x: 0, y: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [usingExisting, setUsingExisting] = useState(initialCover != null);
  const [error, setError] = useState<UiError | null>(null);
  const [lang] = useLang();
  const text = t(lang);

  function placeView(next: CoverView) {
    const stage = stageRef.current?.getBoundingClientRect();
    const image = imgRef.current;
    const clamped =
      stage && image?.naturalWidth
        ? clampView(next, image.naturalWidth, image.naturalHeight, stage.width, stage.height)
        : next;
    viewRef.current = clamped;
    setView(clamped);
  }

  function publish(blob: Blob) {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || stage.width < 1) return;
    const token = ++cropToken.current;
    const spot = viewRef.current;
    void cropView(blob, spot, stage.width, stage.height)
      .then((cropped) => {
        if (token === cropToken.current) onCoverRef.current(cropped);
      })
      .catch((error) => {
        if (token === cropToken.current) setError(codeOf(error));
      });
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const box = stage.getBoundingClientRect();
      setStageSize({ w: box.width, h: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const current = viewRef.current;
      const stageBox = stage.getBoundingClientRect();
      const cx = event.clientX - stageBox.left - stageBox.width / 2;
      const cy = event.clientY - stageBox.top - stageBox.height / 2;
      const zoom = current.zoom * factor;
      placeView({
        zoom,
        x: cx - ((cx - current.x) * zoom) / current.zoom,
        y: cy - ((cy - current.y) * zoom) / current.zoom,
      });
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        if (sourceRef.current) publish(sourceRef.current);
      }, 180);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      stage.removeEventListener("wheel", onWheel);
      window.clearTimeout(wheelTimer.current);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancel = false;
    const owned: string[] = [];
    const objectUrl = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl;

    const showPreview = (url: string) => {
      const previous = previewRef.current;
      previewRef.current = url;
      setPreviewUrl(url);
      if (previous && previous !== url) URL.revokeObjectURL(previous);
    };

    const run = async () => {
      const existing = initialCover;
      if (existing) {
        const url = URL.createObjectURL(existing);
        owned.push(url);
        showPreview(url);
      }
      await waitFor(video, "loadedmetadata");
      if (cancel) return;
      const duration = Number.isFinite(video.duration) ? video.duration : durationMs / 1000;
      const suggest = suggestedTime(duration);
      await seekTo(video, suggest, () => pinScroll(stageRef.current, scrollLock));
      if (cancel) return;
      const cover = await captureFrame(video);
      if (cancel) return;
      if (!existing) {
        const coverUrl = URL.createObjectURL(cover);
        owned.push(coverUrl);
        sourceRef.current = cover;
        showPreview(coverUrl);
        setTimeMs(Math.round(suggest * 1000));
        publish(cover);
      } else {
        sourceRef.current = existing;
      }
      setReady(true);
    };

    run().catch((error) => {
      if (!cancel) setError(codeOf(error));
    });

    return () => {
      cancel = true;
      URL.revokeObjectURL(objectUrl);
      for (const url of owned) URL.revokeObjectURL(url);
      if (previewRef.current && !owned.includes(previewRef.current)) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [file, durationMs]);

  async function captureAt(seconds: number, token: number) {
    const video = videoRef.current;
    if (!video) return;
    try {
      await seekTo(video, seconds, () => pinScroll(stageRef.current, scrollLock));
      if (token !== scrubToken.current) return;
      const blob = await captureFrame(video);
      if (token !== scrubToken.current) return;
      const url = URL.createObjectURL(blob);
      sourceRef.current = blob;
      showLoose(url);
      publish(blob);
    } catch (error) {
      if (token === scrubToken.current) setError(codeOf(error));
    }
  }

  function showLoose(url: string) {
    const previous = previewRef.current;
    previewRef.current = url;
    setPreviewUrl(url);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
  }

  function holdPlace() {
    pinScroll(stageRef.current, scrollLock);
  }

  function beginHold() {
    scrollLock.current = null;
    scrollTicket.current += 1;
    holdPlace();
  }

  function releasePlace() {
    const ticket = scrollTicket.current;
    window.setTimeout(() => {
      if (scrollTicket.current === ticket) scrollLock.current = null;
    }, 1000);
  }

  function onScrub(next: number) {
    holdPlace();
    setUsingExisting(false);
    setTimeMs(next);
    const token = ++scrubToken.current;
    window.setTimeout(() => {
      if (scrubToken.current === token) void captureAt(next / 1000, token);
    }, 90);
  }

  const max = Math.max(durationMs, timeMs, 1);

  function chooseClip(key: string) {
    const row = clipRowRef.current;
    const left = row?.scrollLeft ?? 0;
    holdPlace();
    onChoose(key);
    const restore = () => {
      if (row) row.scrollLeft = left;
      holdPlace();
    };
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }

  function syncGesture() {
    const pts = [...pointers.current.values()];
    const current = viewRef.current;
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      gesture.current = {
        kind: "pinch",
        dist,
        zoom: current.zoom,
        ox: current.x,
        oy: current.y,
        mx: (pts[0].x + pts[1].x) / 2,
        my: (pts[0].y + pts[1].y) / 2,
      };
      return;
    }
    if (pts.length === 1) {
      gesture.current = { kind: "pan", x: pts[0].x, y: pts[0].y, ox: current.x, oy: current.y };
      return;
    }
    gesture.current = null;
  }

  function onPanStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!imgRef.current?.naturalWidth) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* the gesture still follows the pointers we track */
    }
    syncGesture();
  }

  function onPanMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...pointers.current.values()];
    const active = gesture.current;
    if (active?.kind === "pinch" && pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      placeView({
        zoom: active.zoom * (dist / active.dist),
        x: active.ox + (mx - active.mx),
        y: active.oy + (my - active.my),
      });
      return;
    }
    if (active?.kind === "pan" && pts.length === 1) {
      placeView({
        zoom: viewRef.current.zoom,
        x: active.ox + (pts[0].x - active.x),
        y: active.oy + (pts[0].y - active.y),
      });
    }
  }

  function onPanEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (sourceRef.current) publish(sourceRef.current);
      return;
    }
    syncGesture();
  }

  function onNudge(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 24 : 12;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      placeView({ ...viewRef.current, zoom: viewRef.current.zoom * 1.15 });
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      placeView({ ...viewRef.current, zoom: viewRef.current.zoom / 1.15 });
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      placeView({ ...viewRef.current, x: viewRef.current.x - step });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      placeView({ ...viewRef.current, x: viewRef.current.x + step });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      placeView({ ...viewRef.current, y: viewRef.current.y - step });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      placeView({ ...viewRef.current, y: viewRef.current.y + step });
    } else {
      return;
    }
    if (sourceRef.current) publish(sourceRef.current);
  }

  const fit = natural.w > 0 && stageSize.w > 0 ? Math.max(stageSize.w / natural.w, stageSize.h / natural.h) : 0;
  const baseW = fit ? natural.w * fit : undefined;
  const baseH = fit ? natural.h * fit : undefined;

  return (
    <section className="grid gap-2">
      {choices.length > 1 ? (
        <div ref={clipRowRef} className="clip-row flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={text.chooseClip}>
          {choices.map((choice) => {
            const selected = choice.key === selectedKey;
            return (
              <button
                key={choice.key}
                type="button"
                role="tab"
                aria-selected={selected}
                className={
                  selected
                    ? "tap min-h-12 shrink-0 rounded-full bg-cobalt px-4 font-extrabold text-card"
                    : "tap min-h-12 shrink-0 rounded-full bg-card px-4 font-extrabold text-ink shadow-lift"
                }
                onPointerDown={(event) => {
                  beginHold();
                  event.currentTarget.focus({ preventScroll: true });
                }}
                onPointerUp={releasePlace}
                onPointerCancel={releasePlace}
                onClick={() => chooseClip(choice.key)}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <label className="grid gap-1 font-bold text-ink">
        <span className="flex items-baseline justify-between gap-3">
          <span>{text.seek(clipName)}</span>
          <span className="tabular-nums text-muted">{usingExisting ? text.currentCover : formatClock(timeMs)}</span>
        </span>
        <input
          className="clip-seek"
          type="range"
          min={0}
          max={max}
          step={50}
          value={Math.min(timeMs, max)}
          disabled={!ready}
          aria-label={text.seek(clipName)}
          style={{ ["--seek" as string]: `${max ? (Math.min(timeMs, max) / max) * 100 : 0}%` }}
          onChange={(event) => onScrub(Number(event.target.value))}
          onPointerDown={beginHold}
          onPointerUp={releasePlace}
          onPointerCancel={releasePlace}
        />
      </label>
      <div
        ref={stageRef}
        className="cover-stage"
        role="img"
        tabIndex={0}
        aria-label={text.coverHelp}
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
        onKeyDown={onNudge}
      >
        {previewUrl ? (
          <img
            ref={imgRef}
            src={previewUrl}
            alt=""
            draggable={false}
            onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            style={
              baseW && baseH
                ? {
                    width: baseW,
                    height: baseH,
                    transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                  }
                : { width: "100%", height: "100%", objectFit: "cover", transform: "translate(-50%, -50%)" }
            }
          />
        ) : (
          <span className="busy-dot" />
        )}
        <div className="card-caption">
          <h2>{title}</h2>
          <p>{lengthLabel}</p>
        </div>
      </div>
      {error ? <p className="font-bold text-ink">{uiError(lang, error)}</p> : null}
      {typeof document === "undefined"
        ? null
        : createPortal(<video ref={videoRef} className="probe-video" muted playsInline preload="auto" />, document.body)}
    </section>
  );
}

function saveLabel(text: ReturnType<typeof t>, saving: boolean, step: SaveStep | null, editing: boolean): string {
  if (!saving) return editing ? text.saveChanges : text.saveStory;
  if (step?.kind === "cover") return text.savingCover;
  if (step?.kind === "clip") return text.savingClip(step.n, step.total);
  if (step?.kind === "shelf") return text.savingShelf;
  if (step?.kind === "prepare") return text.savingPrepare;
  return text.saving;
}

export function UploadView({
  story = null,
  onCancel,
  onSaved,
}: {
  story?: Story | null;
  onCancel: () => void;
  onSaved: (story: Story) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const seenKey = useRef("");
  const firstKey = useRef("");
  const storyIdRef = useRef(story?.id ?? crypto.randomUUID());
  const savingRef = useRef(false);
  const [title, setTitle] = useState(story?.title ?? "");
  const [drafts, setDrafts] = useState<DraftClip[]>([]);
  const [cover, setCover] = useState<Blob | null>(null);
  const [coverKey, setCoverKey] = useState("");
  const [coverClipKey, setCoverClipKey] = useState("");
  const [keepInitial, setKeepInitial] = useState(story != null);
  const [reading, setReading] = useState(story != null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<SaveStep | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [lang] = useLang();
  const text = t(lang);

  const coverClip = drafts.find((clip) => clip.key === coverClipKey) ?? drafts[0];
  const activeKey = coverClip?.key ?? "";
  const total = drafts.reduce((sum, clip) => sum + clip.durationMs, 0);
  const canSave = drafts.length > 0 && cover != null && coverKey === activeKey && !saving && !reading;

  useEffect(() => {
    if (!story) return;
    let cancel = false;
    const source = story;
    void (async () => {
      try {
        const added: DraftClip[] = [];
        for (const clip of source.clips) {
          const file = await readClipFile(clip);
          added.push({ key: crypto.randomUUID(), file, durationMs: clip.durationMs, path: clip.path });
        }
        if (cancel) return;
        if (!added.length) {
          setError("noclips");
          return;
        }
        firstKey.current = added[0].key;
        setDrafts(added);
        setCoverClipKey(added[0].key);
        setCover(source.cover);
        setCoverKey(added[0].key);
      } catch (error) {
        if (!cancel) setError(codeOf(error));
      } finally {
        if (!cancel) setReading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [story]);

  useEffect(() => {
    if (!activeKey) return;
    if (seenKey.current && seenKey.current !== activeKey) {
      setKeepInitial(false);
      setCover(null);
      setCoverKey("");
    }
    seenKey.current = activeKey;
  }, [activeKey]);

  const rememberCover = useCallback((blob: Blob) => {
    setCover(blob);
    setCoverKey(activeKey);
  }, [activeKey]);

  async function addFiles(list: FileList | null, input: HTMLInputElement) {
    const files = list ? Array.from(list) : [];
    input.value = "";
    if (!files.length) return;
    setReading(true);
    setError(null);
    try {
      const added: DraftClip[] = [];
      for (const file of files) {
        if (!isVideo(file)) continue;
        const durationMs = await probeDuration(file);
        added.push({ key: crypto.randomUUID(), file, durationMs });
      }
      if (!added.length) setError(CODE.video);
      else setDrafts((current) => [...current, ...added]);
    } catch (error) {
      setError(codeOf(error));
    } finally {
      setReading(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    setDrafts((current) => {
      const next = current.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const swap = next[index];
      next[index] = next[target];
      next[target] = swap;
      return next;
    });
  }

  async function save() {
    if (!canSave || !cover || savingRef.current || saveLock) return;
    saveLock = true;
    savingRef.current = true;
    setSaving(true);
    setStep({ kind: "prepare" });
    setError(null);
    const storyId = storyIdRef.current;
    let kept = false;
    try {
      const clips: ClipSource[] = [];
      const uploads: { path: string; body: Blob }[] = [];
      const coverChanged = !story || cover !== story.cover;
      if (coverChanged) uploads.push({ path: coverObjectKey(storyId), body: cover });
      for (let index = 0; index < drafts.length; index++) {
        const draft = drafts[index];
        if (draft.path) {
          clips.push({ path: draft.path, durationMs: draft.durationMs });
          continue;
        }
        const stored = await storeClip(storyId, index, draft.file, draft.durationMs);
        clips.push(stored);
        uploads.push({ path: stored.path, body: draft.file });
      }
      const removed = (story?.clips ?? []).map((clip) => clip.path).filter((path) => !clips.some((clip) => clip.path === path));
      const next: Story = {
        id: storyId,
        title: title.trim() || text.defaultTitle,
        cover,
        durationMs: clips.reduce((sum, clip) => sum + clip.durationMs, 0),
        unwrapped: story?.unwrapped ?? true,
        createdAt: story?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        clips,
      };
      await rememberStory(next);
      kept = true;
      await publishStory(next, setStep, uploads);
      await putStory(next);
      if (removed.length > 0) {
        try {
          await forgetClips(removed);
        } catch (error) {
          report("could not delete removed clips", error);
        }
      }
      try {
        await pruneStoryFiles(storyId, clips.map((clip) => clip.path));
      } catch (error) {
        report("could not prune unused clip files", error);
      }
      requestPersistentStorage();
      setDrafts([]);
      setCover(null);
      setSaved(true);
      window.setTimeout(() => onSaved(next), 1100);
    } catch (caught) {
      if (!kept && !story) await discardStoryFiles(storyId);
      setError(codeOf(caught));
      savingRef.current = false;
      setSaving(false);
    } finally {
      saveLock = false;
    }
  }

  function askLeave() {
    if (drafts.length > 0 && !saved) setConfirmLeave(true);
    else onCancel();
  }

  if (saved) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center" role="status">
        <div className="grid justify-items-center gap-4">
          <div className="check-pop">
            <Check className="size-14" strokeWidth={3} aria-hidden="true" />
          </div>
          <h2 className="font-display text-4xl font-semibold">{text.saved}</h2>
          <p className="text-lg font-bold text-muted">{story?.unwrapped ? text.savedOpen : text.savedWrapped}</p>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <button type="button" className="icon-btn tap" onClick={askLeave} aria-label={text.back}>
          <ArrowLeft className="size-6" />
        </button>
        <h1 className="min-w-0 flex-1 text-xl font-extrabold">{story ? text.editStory : text.newStory}</h1>
        <LangSwitch />
      </header>
      <div className="upload-scroll grid flex-1 content-start gap-3 overflow-y-auto px-5 pt-2 pb-4">
        <label className="grid gap-2 font-extrabold text-ink">
          {text.title}
          <input
            className="field"
            value={title}
            placeholder={text.defaultTitle}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            enterKeyHint="done"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="choice tap" onClick={() => cameraRef.current?.click()}>
            <Camera className="size-7" aria-hidden="true" />
            {text.camera}
          </button>
          <button type="button" className="choice tap" onClick={() => galleryRef.current?.click()}>
            <ImageIcon className="size-7" aria-hidden="true" />
            {text.gallery}
          </button>
        </div>
        <input
          ref={cameraRef}
          className="sr-only"
          type="file"
          accept="video/*"
          capture="environment"
          onChange={(event) => void addFiles(event.target.files, event.target)}
        />
        <input
          ref={galleryRef}
          className="sr-only"
          type="file"
          accept="video/*"
          multiple
          onChange={(event) => void addFiles(event.target.files, event.target)}
        />
        {reading ? (
          <p className="flex items-center gap-2 font-bold text-muted">
            <span className="busy-dot" /> {text.reading}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-3xl bg-card px-4 py-3 font-bold" role="alert">
            {uiError(lang, error)}
          </p>
        ) : null}
        {drafts.length > 0 ? (
          <ol className="grid gap-3">
            {drafts.map((clip, index) => (
              <li key={clip.key} className="flex items-center gap-3 rounded-card bg-card p-3 shadow-lift">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-cobalt font-extrabold text-card">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{text.clip(index + 1)}</p>
                  <p className="font-bold text-muted">{formatLength(clip.durationMs, lang)}</p>
                </div>
                <button
                  type="button"
                  className="icon-btn tap"
                  aria-label={text.moveUp(index + 1)}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="size-6" />
                </button>
                <button
                  type="button"
                  className="icon-btn tap"
                  aria-label={text.moveDown(index + 1)}
                  disabled={index === drafts.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="size-6" />
                </button>
                <button
                  type="button"
                  className="icon-btn tap"
                  aria-label={text.removeClip(index + 1)}
                  onClick={() => setDrafts((current) => current.filter((item) => item.key !== clip.key))}
                >
                  <Trash2 className="size-5" />
                </button>
              </li>
            ))}
          </ol>
        ) : reading ? null : (
          <p className="text-lg font-bold text-muted">{text.addClips}</p>
        )}
        {drafts.length > 1 ? <p className="font-bold text-muted">{text.together} {formatLength(total, lang)}</p> : null}
        {coverClip ? (
          <CoverPicker
            file={coverClip.file}
            durationMs={coverClip.durationMs}
            clipName={text.clip(drafts.findIndex((clip) => clip.key === coverClip.key) + 1)}
            selectedKey={coverClip.key}
            choices={drafts.map((clip, index) => ({ key: clip.key, label: text.clip(index + 1) }))}
            initialCover={keepInitial && coverClip.key === firstKey.current ? (story?.cover ?? null) : null}
            title={title.trim() || text.defaultTitle}
            lengthLabel={formatLength(total, lang)}
            onChoose={setCoverClipKey}
            onCover={rememberCover}
          />
        ) : null}
      </div>
      <div className="sticky bottom-0 grid gap-2 bg-sky px-5 pt-2 pb-5">
        {error ? (
          <p className="font-bold" role="alert">
            {uiError(lang, error)}
          </p>
        ) : null}
        <button className="btn-primary tap" type="submit" disabled={!canSave}>
          {saveLabel(text, saving, step, story != null)}
        </button>
      </div>
      {confirmLeave ? (
        <div className="dialog-back" role="presentation" onClick={() => setConfirmLeave(false)}>
          <div
            className="dialog-card grid gap-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="leave-title" className="font-display text-3xl font-semibold">
              {text.leaveAsk}
            </h2>
            <p className="text-lg font-bold text-muted">{text.leaveHint}</p>
            <button type="button" className="btn-primary tap" onClick={() => setConfirmLeave(false)}>
              {text.keepEditing}
            </button>
            <button type="button" className="btn-quiet tap" onClick={onCancel}>
              {text.leave}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
