import { useEffect, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Text that writes itself like a terminal, once. Instant when motion is reduced. */
export function Typed({ text, speed = 18 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(() => (reduced() ? text.length : 0));
  useEffect(() => {
    if (shown >= text.length) return;
    const timer = setTimeout(() => {
      setShown((n) => Math.min(text.length, n + 2));
    }, speed);
    return () => {
      clearTimeout(timer);
    };
  }, [shown, text, speed]);
  return (
    <span>
      {text.slice(0, shown)}
      {shown < text.length && <span className="cursor" aria-hidden="true">▌</span>}
      <span className="sr-only">{text.slice(shown)}</span>
    </span>
  );
}
