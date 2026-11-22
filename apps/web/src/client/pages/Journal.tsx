import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getJson, type Journal as JournalData, type ReplyEntry } from "../api.ts";
import { Feed } from "../components/Feed.tsx";
import { clock } from "../format.ts";

const TIME_ZONE = "Europe/Paris";

const OUTCOMES = {
  replied: { label: "RÉPONDU", color: "var(--green)", tilt: -2 },
  reacted: { label: "RÉACTION", color: "var(--blue)", tilt: 2 },
  silent: { label: "SILENCE", color: "var(--muted)", tilt: 2 },
  offline: { label: "HORS LIGNE", color: "var(--red-soft)", tilt: -3 },
};

const STATUS = {
  done: { label: "FAIT", color: "var(--green)" },
  refused: { label: "REFUSÉ", color: "var(--yellow)" },
  failed: { label: "ÉCHOUÉ", color: "var(--red-soft)" },
  undone: { label: "ANNULÉ", color: "var(--muted)" },
};

const TOOLS: Record<string, string> = {
  createChannel: "créer un salon",
  renameChannel: "renommer un salon",
  renameMember: "changer un pseudo",
  setRole: "donner ou retirer un rôle",
  pinMessage: "épingler un message",
  createThread: "ouvrir un fil",
  createPoll: "lancer un sondage",
};

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: TIME_ZONE })} ${clock(iso, TIME_ZONE)}`;
}

function detail(params: Record<string, unknown>): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return [text(params.name), text(params.role), text(params.nickname), text(params.question)].filter(Boolean).join(" · ");
}

function Reply({ r }: { r: ReplyEntry }) {
  const [open, setOpen] = useState(false);
  const o = OUTCOMES[r.outcome];
  const u = r.usage;
  const tech = u
    ? [
        ["modèle", u.model ?? "?"],
        ["via", u.provider ?? "?"],
        ["tokens", `${u.inputTokens.toLocaleString("fr-FR")} → ${u.outputTokens.toLocaleString("fr-FR")}`],
        ["raisonnement", `${u.reasoningTokens.toLocaleString("fr-FR")} tokens`],
        ["coût", u.costUsd > 0 ? `${u.costUsd.toFixed(4).replace(".", ",")} $` : "gratuit"],
        ["durée", `${(u.durationMs / 1000).toFixed(1).replace(".", ",")} s`],
      ]
    : [];
  return (
    <li className="px-dim" style={{ background: "var(--panel)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <time dateTime={r.createdAt} style={{ fontSize: 12, color: "var(--faint)" }}>
            {when(r.createdAt)}
          </time>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{r.isDm ? "en message privé" : `#${r.channelName ?? "?"}`}</span>
          <span className="stamp" style={{ marginLeft: "auto", fontSize: 11, padding: "1px 6px", borderWidth: 2, color: o.color, transform: `rotate(${String(o.tilt)}deg)` }}>
            {o.label}
          </span>
        </div>
        {r.content && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>{r.authorName}</span>
            <span style={{ fontSize: 14, color: "var(--text-soft)", overflowWrap: "anywhere" }}>{r.content}</span>
          </div>
        )}
        {r.details?.sent && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 14, borderLeft: "3px solid var(--red)", marginLeft: 12 }}>
            <span style={{ fontSize: 12, color: "var(--red)" }}>ARCHIVE-9</span>
            <span style={{ fontSize: 14, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{r.details.sent}</span>
          </div>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
          style={{ alignSelf: "flex-start", fontFamily: "var(--pixel)", fontSize: 12, background: "none", color: "var(--red)", border: 0, padding: "8px 0", minHeight: 40, cursor: "pointer" }}
        >
          {open ? "▾ Masquer le pourquoi" : "▸ Pourquoi ?"}
        </button>
      </div>
      {open && (
        <div className="drawer" style={{ borderLeft: 0, borderRight: 0, borderBottom: 0, borderTop: "2px solid var(--line)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 style={{ fontSize: 13 }}>Ce qui m'a fait réagir</h3>
            <span style={{ fontSize: 13, color: "var(--text-soft)" }}>{r.reason ?? "?"}</span>
            {r.details?.context && r.details.context.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, marginTop: 8 }}>Ce que j'avais en tête</h3>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--text-soft)" }}>
                  {r.details.context.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 style={{ fontSize: 13 }}>Mon raisonnement</h3>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-soft)", background: "var(--panel)", padding: "12px 14px", borderLeft: "3px solid var(--edge)", whiteSpace: "pre-line", maxHeight: 320, overflowY: "auto" }}>
              {r.details?.reasoning ?? "Mon modèle ne m'a pas donné son raisonnement cette fois."}
            </p>
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 style={{ fontSize: 13 }}>Ce que j'ai fait</h3>
            {r.details?.steps && r.details.steps.length > 0 ? (
              <ol className="timeline" style={{ gap: 10 }}>
                {r.details.steps.map((s, i) => (
                  <li key={i}>
                    <span style={{ fontFamily: "var(--pixel)", fontSize: 12 }}>{s.tool}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>{s.summary}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Rien.</span>
            )}
            {tech.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 14px", fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                {tech.map(([k, v]) => (
                  <span key={k}>
                    {k} <b style={{ color: "var(--text)", fontWeight: 500 }}>{v}</b>
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </li>
  );
}

type Tab = "replies" | "actions" | "feed";
const TABS: [Tab, string][] = [
  ["replies", "Mes réponses"],
  ["actions", "Mes actions"],
  ["feed", "Ce que j'ai appris"],
];

export function Journal() {
  const [tab, setTab] = useState<Tab>("replies");
  const { data } = useQuery({ queryKey: ["journal"], queryFn: () => getJson<JournalData>("/api/journal"), refetchInterval: 30_000 });
  return (
    <main className="page" style={{ gap: 28 }}>
      <div className="page-head">
        <div className="label">Journal</div>
        <h1>Tout ce que j'ai fait.</h1>
        <p>Chaque réponse, avec ce qui m'y a poussé. Mes actions sur le serveur, celles que j'ai refusées, ce que j'ai appris. Rien n'est caché.</p>
      </div>
      <div role="tablist" aria-label="Sections" style={{ display: "flex", flexWrap: "wrap", gap: 6, borderBottom: "2px solid var(--line)", paddingBottom: 12 }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
            }}
            style={{ fontFamily: "var(--pixel)", fontSize: 13, background: tab === key ? "var(--red)" : "var(--panel)", color: tab === key ? "var(--bg)" : "var(--text)", border: 0, padding: "12px 16px", minHeight: 44, cursor: "pointer" }}
          >
            {label}
          </button>
        ))}
      </div>
      {!data && <div aria-busy="true" />}
      {data && tab === "replies" && (
        data.replies.length === 0 ? (
          <p className="empty">Aucune réponse enregistrée pour l'instant. Je note tout à partir de maintenant.</p>
        ) : (
          <ol className="plain" style={{ gap: 14 }}>
            {data.replies.map((r) => (
              <Reply key={r.id} r={r} />
            ))}
          </ol>
        )
      )}
      {data && tab === "actions" && (
        data.actions.length === 0 ? (
          <p className="empty">Je n'ai encore touché à rien.</p>
        ) : (
          <ul className="plain px-dim" style={{ background: "var(--panel)", padding: "4px 16px", gap: 0 }}>
            {data.actions.map((a) => {
              const status = STATUS[a.status];
              return (
                <li key={a.id} className="row-line" style={{ flexWrap: "wrap" }}>
                  <time dateTime={a.createdAt}>{when(a.createdAt)}</time>
                  <span className="stamp" style={{ fontSize: 11, padding: "1px 6px", borderWidth: 2, color: status.color }}>
                    {status.label}
                  </span>
                  <span style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>
                      {TOOLS[a.tool] ?? a.tool}
                      {detail(a.params) ? ` · ${detail(a.params)}` : ""}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--faint)" }}>
                      {a.requestedBy ? `demandé par ${a.requestedBy}` : "de moi-même"}
                      {a.refusalReason ? ` · ${a.refusalReason}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )
      )}
      {data && tab === "feed" && <Feed items={data.events} timeZone={TIME_ZONE} journalLink={false} />}
    </main>
  );
}
