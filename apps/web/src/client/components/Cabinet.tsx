import { useState, type ReactNode } from "react";

export interface DrawerSpec {
  key: string;
  label: string;
  sublabel?: string;
  color: string;
  count: number;
  content: ReactNode;
}

/** A filing cabinet: drawers that slide open one at a time, all shut at first. */
export function Cabinet({ drawers, unit = ["fragment", "fragments"] }: { drawers: DrawerSpec[]; unit?: [string, string] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="cabinet">
      {drawers.map((d) => {
        const isOpen = open === d.key;
        return (
          <div key={d.key} className="drawer-wrap">
            <button
              type="button"
              className={`drawer-face px-dim${isOpen ? " open" : ""}`}
              aria-expanded={isOpen}
              aria-controls={`drawer-${d.key}`}
              onClick={() => {
                setOpen(isOpen ? null : d.key);
              }}
            >
              <span className="drawer-edge" style={{ background: d.color }} />
              <span className="drawer-label">
                <span>{d.label}</span>
                {d.sublabel && <small>{d.sublabel}</small>}
              </span>
              <span className="drawer-count">
                {d.count} {d.count === 1 ? unit[0] : unit[1]}
              </span>
              <span className="drawer-handle" aria-hidden="true" />
              <span className="drawer-arrow" aria-hidden="true">
                {isOpen ? "▾" : "▸"}
              </span>
            </button>
            {isOpen && (
              <div id={`drawer-${d.key}`} className="drawer">
                {d.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Small marks for a gauge (reliability, affinity…), drawn on the cream cards. */
export function Marks({ lit, total = 5, on = "#8a2a33", label }: { lit: number; total?: number; on?: string; label: string }) {
  return (
    <span className="marks" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} style={{ background: i < lit ? on : "#b8ae96" }} />
      ))}
    </span>
  );
}

const PAGE = 9;

/** Cards of an open drawer, 9 at a time. */
export function CardList<T>({ items, render, label }: { items: T[]; render: (item: T, index: number) => ReactNode; label: string }) {
  const [shown, setShown] = useState(PAGE);
  const rest = items.length - shown;
  return (
    <>
      <ul className="cards" aria-label={label}>
        {items.slice(0, shown).map((item, i) => (
          <li key={i} className="card-slot" style={{ animationDelay: `${String(Math.min(i % PAGE, 8) * 0.05)}s` }}>
            {render(item, i)}
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          className="more"
          onClick={() => {
            setShown(shown + PAGE);
          }}
        >
          Afficher plus ({rest > PAGE ? `${String(PAGE)} sur ${String(rest)}` : String(rest)})
        </button>
      )}
    </>
  );
}
