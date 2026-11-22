import { useQuery } from "@tanstack/react-query";
import { getJson, type Journal as JournalData } from "../api.ts";
import { Feed } from "../components/Feed.tsx";

const TIME_ZONE = "Europe/Paris";

const STATUS = {
  done: { label: "FAIT", color: "var(--green)" },
  refused: { label: "REFUSÉ", color: "var(--yellow)" },
  failed: { label: "ÉCHOUÉ", color: "var(--red-soft)" },
  undone: { label: "ANNULÉ", color: "var(--faint)" },
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

function detail(params: Record<string, unknown>): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return [text(params.name), text(params.role), text(params.nickname), text(params.question)].filter(Boolean).join(" · ");
}

export function Journal() {
  const { data } = useQuery({ queryKey: ["journal"], queryFn: () => getJson<JournalData>("/api/journal"), refetchInterval: 30_000 });
  if (!data) return <main className="page" aria-busy="true" />;
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div className="label">Journal</div>
        <h1>Tout ce que j'ai fait.</h1>
        <p>Ce que j'ai appris, mes actions sur le serveur, et celles que j'ai refusées. Rien n'est caché.</p>
      </div>
      <div className="row">
        <section aria-labelledby="actions" style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="actions" style={{ fontSize: 18 }}>
            Mes actions sur le serveur
          </h2>
          {data.actions.length === 0 ? (
            <p className="empty">Je n'ai encore touché à rien.</p>
          ) : (
            <ul className="plain">
              {data.actions.map((a) => {
                const status = STATUS[a.status];
                return (
                  <li key={a.id} className="row-line" style={{ flexWrap: "wrap" }}>
                    <time dateTime={a.createdAt}>
                      {new Date(a.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: TIME_ZONE })} {new Date(a.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE })}
                    </time>
                    <span style={{ fontFamily: "var(--pixel)", fontSize: 11, color: status.color, width: 76, flex: "none" }}>{status.label}</span>
                    <span style={{ flex: "1 1 240px", color: "var(--text-soft)" }}>
                      {TOOLS[a.tool] ?? a.tool}
                      {detail(a.params) ? ` · ${detail(a.params)}` : ""}
                      {a.requestedBy ? <span style={{ color: "var(--faint)" }}> · demandé par {a.requestedBy}</span> : null}
                      {a.refusalReason ? <span style={{ color: "var(--faint)" }}> · {a.refusalReason}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <Feed items={data.events} timeZone={TIME_ZONE} journalLink={false} />
      </div>
    </main>
  );
}
