import type { Home } from "../api.ts";
import { clock, FEED_KINDS } from "../format.ts";

export function Feed({ items, timeZone }: { items: Home["feed"]; timeZone: string }) {
  return (
    <section aria-labelledby="live" className="live px-dim">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 id="live">En direct</h2>
        <span style={{ fontSize: 12, color: "var(--red)", display: "flex", alignItems: "center", gap: 6 }}>
          <i className="cursor" style={{ width: 8, height: 8, background: "var(--red)", display: "block" }} />
          flux ouvert
        </span>
      </div>
      {items.length === 0 ? (
        <p className="empty">Rien pour l'instant. J'écoute.</p>
      ) : (
        <ol>
          {items.map((item, i) => {
            const kind = FEED_KINDS[item.kind];
            return (
              <li key={`${item.at}-${String(i)}`}>
                <time dateTime={item.at}>{clock(item.at, timeZone)}</time>
                <span className="kind" style={{ color: kind.color }}>
                  {kind.label}
                </span>
                <span className="what">{item.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
