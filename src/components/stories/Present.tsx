import { useEffect } from "react";

export function Bow() {
  return (
    <div className="bow" aria-hidden="true">
      <span className="loop loop-l" />
      <span className="loop loop-r" />
      <span className="knot" />
      <span className="tail tail-l" />
      <span className="tail tail-r" />
    </div>
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
