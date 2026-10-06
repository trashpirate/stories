import { useEffect } from "react";

export function GiftCard() {
  return <img className="gift-photo" src="/gift.jpg" alt="" />;
}

export function UnwrapOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(onDone, reduce ? 0 : 1200);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div className="unwrap-screen" aria-hidden="true">
      <div className="unwrap-panel left" />
      <div className="unwrap-panel right" />
    </div>
  );
}
