import { useEffect, useId, useRef, useState } from "react";

/** The site's own dropdown: pixel frame, the current choice in red, works with the keyboard. */
export function Select<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: [K, string][]; onChange: (value: K) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o[0] === value)?.[1] ?? "";

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o[0] === value)));
    setOpen(true);
  };
  const pick = (k: K) => {
    onChange(k);
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="select" ref={root}>
      <button
        ref={button}
        type="button"
        className="select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open) setOpen(false);
          else show();
        }}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            show();
            return;
          }
          if (!open) return;
          if (event.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
          else if (event.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (event.key === "Enter") pick(options[active]?.[0] ?? value);
          else if (event.key === "Escape") setOpen(false);
          else return;
          event.preventDefault();
        }}
      >
        <b>{label}</b>
        <span>{current}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul id={id} role="listbox" className="select-list px-dim" aria-label={label}>
          {options.map(([k, text], i) => (
            <li
              key={k}
              role="option"
              aria-selected={k === value}
              className={i === active ? "active" : undefined}
              onMouseEnter={() => {
                setActive(i);
              }}
              onClick={() => {
                pick(k);
              }}
            >
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
