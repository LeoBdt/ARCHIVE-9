import { useQuery } from "@tanstack/react-query";
import { getJson, type Backstage } from "../api.ts";
import { clock } from "../format.ts";

const TIME_ZONE = "Europe/Paris";

/** Why a message got no answer, in plain words. */
const IGNORED: Record<string, string> = {
  outside_agents: "hors AGENTS, sans mention",
  not_listened: "salon que je n'écoute pas",
  trivial: "message vide ou emojis",
  opted_out: "membre hors archives",
  foreign_bot: "bot inconnu",
  paused: "j'étais en pause",
  observer_mode: "mode observateur",
};

const euros = (usd: number) => `${usd.toFixed(2).replace(".", ",")} $`;

export function Coulisses() {
  const { data } = useQuery({ queryKey: ["coulisses"], queryFn: () => getJson<Backstage>("/api/coulisses"), refetchInterval: 30_000 });
  if (!data) return <main className="page" aria-busy="true" />;

  const days = [...new Set(data.costs.map((c) => c.day))].slice(-7);
  const cost = (day: string, tasks: string[]) => data.costs.filter((c) => c.day === day && tasks.includes(c.task)).reduce((s, c) => s + c.costUsd, 0);
  const max = Math.max(0.01, ...days.map((d) => cost(d, ["reply", "triage", "analysis", "reflection"])));
  const kpis = [
    [String(data.today.seen), "messages que j'ai lus en 24 h"],
    [String(data.today.replies), "réponses que j'ai envoyées"],
    [euros(data.today.spentToday), "dépensés aujourd'hui"],
    [data.today.medianMs ? `${(data.today.medianMs / 1000).toFixed(1).replace(".", ",")} s` : "?", "pour répondre, en moyenne"],
  ];

  return (
    <main className="page" style={{ gap: 28 }}>
      <div className="page-head">
        <div className="label">Coulisses</div>
        <h1>Sous mon capot.</h1>
        <p>Ce que je décide, ce que je coûte, ce qui casse. Tout le monde peut regarder.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {kpis.map(([value, label]) => (
          <div key={label} className="stat px-dim">
            <b style={{ fontSize: 26 }}>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section aria-labelledby="tri" className="px-dim" style={{ flex: "999 1 560px", minWidth: 0, background: "var(--panel)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "2px solid var(--line)" }}>
            <h2 id="tri" style={{ fontSize: 16 }}>
              Mon tri en direct
            </h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>ce que j'ai lu sans répondre</span>
          </div>
          {data.triage.length === 0 ? (
            <p className="empty" style={{ padding: 16 }}>
              Rien pour l'instant.
            </p>
          ) : (
            <ol className="plain" style={{ gap: 0 }}>
              {data.triage.map((t, i) => (
                <li key={i} style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "baseline" }}>
                    <time dateTime={t.createdAt} style={{ fontSize: 12, color: "var(--faint)" }}>
                      {clock(t.createdAt, TIME_ZONE)}
                    </time>
                    <span style={{ fontFamily: "var(--pixel)", fontSize: 11, color: t.outcome === "ignored" ? "var(--faint)" : "var(--muted)" }}>{t.outcome === "ignored" ? "IGNORE" : "SE TAIT"}</span>
                    <span style={{ fontSize: 13 }}>{t.isDm ? "un MP" : `#${t.channelName ?? "?"} · ${t.authorName ?? "?"}`}</span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text-soft)" }}>
                    {t.outcome === "ignored" ? (IGNORED[t.reason ?? ""] ?? t.reason) : `intérêt ${String(t.interest ?? "?")}/10${t.reason ? ` : ${t.reason}` : ""}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 24 }}>
          <section className="panel px-dim">
            <h2>Ce que je coûte sur 7 jours</h2>
            <div role="img" aria-label="Coût par jour sur 7 jours" style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110 }}>
              {days.map((d) => (
                <div key={d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 86 }}>
                    <span style={{ display: "block", height: `${String(Math.round((cost(d, ["reply", "triage"]) / max) * 86))}px`, background: "var(--red)" }} />
                    <span style={{ display: "block", height: `${String(Math.round((cost(d, ["analysis", "reflection"]) / max) * 86))}px`, background: "var(--purple)" }} />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--faint)" }}>{new Date(d).toLocaleDateString("fr-FR", { weekday: "short" }).slice(0, 2)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: "var(--muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 10, height: 10, background: "var(--red)", display: "block" }} />
                réponses
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 10, height: 10, background: "var(--purple)", display: "block" }} />
                analyse et réflexion
              </span>
            </div>
          </section>

          <section className="panel px-dim">
            <h2>Ce que j'ai ignoré en 24 h</h2>
            {data.ignored.length === 0 && <p className="empty">Rien.</p>}
            {data.ignored.map((g) => (
              <div key={g.reason ?? "?"} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 56px", gap: 10, fontSize: 13 }}>
                <span style={{ color: "var(--text-soft)" }}>{IGNORED[g.reason ?? ""] ?? g.reason}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--pixel)" }}>{g.n}</span>
              </div>
            ))}
          </section>

          <section className="panel px-red" style={{ background: "var(--red-deep)" }}>
            <h2 style={{ color: "var(--red-ink)" }}>Ce qui m'a fait trébucher</h2>
            {data.errors.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--red-ink)" }}>Rien en 24 h.</span>
            ) : (
              data.errors.map((e, i) => (
                <span key={i} style={{ fontSize: 13, color: "var(--red-ink)" }}>
                  {clock(e.createdAt, TIME_ZONE)} · {e.task} · {e.model} · {e.status !== "ok" ? e.status : `secours (${e.fallbackReason ?? "?"})`}
                </span>
              ))
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
