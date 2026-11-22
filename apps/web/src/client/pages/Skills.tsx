import { useQuery } from "@tanstack/react-query";
import { getJson, type SkillView } from "../api.ts";
import { clock, formatCount } from "../format.ts";

const TIME_ZONE = "Europe/Paris";

function badge(s: SkillView) {
  if (s.expiresAt) return { label: "TEMPORAIRE", color: "var(--yellow)" };
  return s.kind === "triggered" ? { label: "DÉCLENCHEUR", color: "var(--blue)" } : { label: "PERMANENTE", color: "var(--text)" };
}

export function Skills() {
  const { data } = useQuery({ queryKey: ["skills"], queryFn: () => getJson<SkillView[]>("/api/skills"), refetchInterval: 60_000 });
  if (!data) return <main className="page" aria-busy="true" />;
  const permanent = data.filter((s) => s.kind === "permanent").length;
  return (
    <main className="page" style={{ gap: 28 }}>
      <div className="page-head">
        <div className="label">
          Skills · {data.length} sur 200 · {permanent} permanentes sur 10
        </div>
        <h1>Ce qu'on m'a appris.</h1>
        <p>Des consignes que vous m'avez données. Permanentes, je les suis toujours ; à déclencheur, quand leurs mots apparaissent. Pour m'en apprendre une, mentionne-moi et demande.</p>
      </div>
      {data.length === 0 ? (
        <p className="empty">Personne ne m'a encore rien appris.</p>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {data.map((s) => {
            const b = badge(s);
            return (
              <article key={s.id} className="card px-dim" style={{ gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 400 }}>{s.name}</h2>
                  <span className="badge" style={{ background: b.color }}>
                    {b.label}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{s.rule}</p>
                {s.kind === "triggered" && <div style={{ fontSize: 12, color: "var(--text-soft)" }}>quand on dit : {s.triggers.join(", ")}</div>}
                <div style={{ fontSize: 12, color: "var(--faint)" }}>
                  par {s.author ?? "un ancien membre"} · servie {formatCount(s.uses)} fois
                  {s.expiresAt ? ` · jusqu'à ${clock(s.expiresAt, TIME_ZONE)}` : ""}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
