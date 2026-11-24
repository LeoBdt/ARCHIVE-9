import { useEffect, useRef, type ReactNode } from "react";

/**
 * A window over a light veil. While `locked` (ARCHIVE-9 is working), neither the button,
 * Escape nor a click outside closes it.
 */
export function Sheet({ title, onClose, locked = false, wide = false, children }: { title: string; onClose: () => void; locked?: boolean; wide?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("textarea, input, button")?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [locked, onClose]);
  return (
    <div
      className="veil"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <div ref={box} className={`sheet-box px${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="section-head">
          <h2>{title}</h2>
          <button type="button" className="button-ghost small" disabled={locked} onClick={onClose}>
            {locked ? "En cours…" : "Fermer"}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
