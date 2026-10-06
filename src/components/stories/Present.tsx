import { useEffect } from "react";

export function Bow() {
  return (
    <svg className="bow" viewBox="0 0 200 156" aria-hidden="true">
      <path className="tail" d="M92 78 L108 86 L102 142 L88 124 L70 146 Z" />
      <path className="tail" d="M108 78 L92 86 L98 142 L112 124 L130 146 Z" />
      <path className="band" d="M100 72 C74 34 26 14 18 40 C10 66 52 82 98 74" />
      <path className="lite" d="M100 72 C74 34 26 14 18 40 C10 66 52 82 98 74" />
      <path className="band" d="M100 72 C126 34 174 14 182 40 C190 66 148 82 102 74" />
      <path className="lite" d="M100 72 C126 34 174 14 182 40 C190 66 148 82 102 74" />
      <path className="band" d="M100 80 C76 62 42 50 36 68 C30 88 66 98 98 82" />
      <path className="lite" d="M100 80 C76 62 42 50 36 68 C30 88 66 98 98 82" />
      <path className="band" d="M100 80 C124 62 158 50 164 68 C170 88 134 98 102 82" />
      <path className="lite" d="M100 80 C124 62 158 50 164 68 C170 88 134 98 102 82" />
      <ellipse className="knot" cx="100" cy="78" rx="14" ry="11" />
    </svg>
  );
}

export function GiftCard() {
  return (
    <div className="gift-card">
      <span className="ribbon-v" />
      <span className="ribbon-h" />
      <Bow />
    </div>
  );
}

export function UnwrapOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(onDone, reduce ? 0 : 1200);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div className="unwrap-screen" aria-hidden="true">
      <div className="unwrap-panel left">
        <span className="ribbon-v" />
        <span className="ribbon-h" />
      </div>
      <div className="unwrap-panel right">
        <span className="ribbon-v" />
        <span className="ribbon-h" />
      </div>
      <Bow />
    </div>
  );
}
