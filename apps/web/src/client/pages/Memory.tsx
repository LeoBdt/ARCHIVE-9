import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson, type Memory as MemoryData, type Viewer } from "../api.ts";
import { diffStates } from "../archive.ts";
import { Sprite } from "../components/Sprite.tsx";
import { clock } from "../format.ts";

const TIME_ZONE = "Europe/Paris";
const SOURCES = { initial: "première prise de conscience", reflection: "réflexion du soir", rollback: "retour en arrière" };

export function Memory({ viewer }: { viewer: Viewer }) {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ["memory"], queryFn: () => getJson<MemoryData>("/api/memory"), refetchInterval: 60_000 });
  const rollback = useMutation({
    mutationFn: (version: number) => postJson("/api/memory/rollback", { version }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["memory"] }),
  });
  if (!data) return <main className="page" aria-busy="true" />;
  const current = data.history[0];
  const state = current?.state;
  const resolutions = state?.resolutions ?? [];

  return (
    <main className="page" style={{ gap: 36 }}>
      <section aria-label="Mon état" className="px" style={{ background: "var(--panel)", padding: "32px 40px", display: "flex", flexWrap: "wrap", gap: 36, alignItems: "center" }}>
        <Sprite cell={8} />
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="label">
            Ma mémoire · version {current?.version ?? "?"} de moi-même
            {current ? ` · ${SOURCES[current.source]} le ${new Date(current.createdAt).toLocaleDateString("fr-FR")}` : ""}
          </div>
          <h1 style={{ fontSize: 34, lineHeight: 1.15 }}>Ce que je suis devenu.</h1>
          {state && (
            <div style={{ fontSize: 16, color: "var(--text-soft)" }}>
              Humeur : <span style={{ color: "var(--text)" }}>{state.mood}</span>
            </div>
          )}
          {data.status && <div className="bubble px-red">« {data.status} »</div>}
        </div>
      </section>

      <section aria-labelledby="resolutions" className="panel px-dim" style={{ padding: 24, gap: 14 }}>
        <div className="section-head">
          <h2 id="resolutions" style={{ fontSize: 20, color: "var(--red)" }}>
            Mes résolutions
          </h2>
          <span style={{ fontSize: 12, color: "var(--faint)" }}>{resolutions.length} sur 8</span>
        </div>
        {resolutions.length === 0 ? (
          <p className="empty">Aucune pour l'instant. Personne ne s'est plaint, ou je n'ai pas encore réfléchi.</p>
        ) : (
          <ol className="grid" style={{ listStyle: "none", margin: 0, padding: 0, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {resolutions.map((r) => (
              <li key={r} className="px-dim" style={{ background: "var(--panel)", padding: "14px 16px", fontSize: 15 }}>
                {r}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24 }}>
        <section className="panel px-dim" style={{ background: "var(--panel)" }}>
          <h2>Mes opinions</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: "var(--text-soft)" }}>
            {(state?.opinions ?? []).map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
        <section className="panel px-dim" style={{ background: "var(--panel)" }}>
          <h2>Mes blagues récurrentes</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: "var(--text-soft)" }}>
            {(state?.runningJokes ?? []).map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
        <section className="panel px-dim" style={{ background: "var(--panel)" }}>
          <h2>Mon journal</h2>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-soft)" }}>{state && state.notes.length > 0 ? state.notes : "Rien d'écrit pour l'instant."}</p>
        </section>
      </div>

      <section aria-labelledby="pending" className="panel px-dim">
        <div className="section-head">
          <h2 id="pending">Ce qu'on m'a reproché</h2>
          <span style={{ fontSize: 12, color: "var(--faint)" }}>Je les relis ce soir.</span>
        </div>
        {data.pending.length === 0 ? (
          <p className="empty">Rien en attente.</p>
        ) : (
          <ul className="plain">
            {data.pending.map((f, i) => (
              <li key={i} className="row-line">
                <time dateTime={f.createdAt}>{clock(f.createdAt, TIME_ZONE)}</time>
                <span style={{ color: "var(--text-soft)" }}>
                  <b style={{ color: "var(--text)", fontWeight: 500 }}>{f.author}</b> · {f.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="histoire" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="section-head">
          <h2 id="histoire">Mon histoire</h2>

        </div>
        <ol className="timeline">
          {data.history.map((v, i) => (
            <li key={v.version}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 16px", alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--pixel)", fontSize: 13 }}>{new Date(v.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span>
                <span style={{ fontSize: 12, color: "var(--faint)" }}>
                  version {v.version} · {SOURCES[v.source]}
                </span>
                {viewer.isAdmin && i > 0 && (
                  <button
                    type="button"
                    className="button-ghost"
                    style={{ marginLeft: "auto", color: "var(--muted)", borderColor: "var(--edge)", fontSize: 11 }}
                    onClick={() => {
                      if (window.confirm(`Remettre ARCHIVE-9 dans son état de la version ${String(v.version)} ? L'historique garde tout.`)) rollback.mutate(v.version);
                    }}
                  >
                    Revenir à cette version
                  </button>
                )}
              </div>
              <div style={{ fontSize: 14, color: "var(--text-soft)" }}>Humeur : {v.state.mood}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 13 }}>
                {diffStates(data.history[i + 1]?.state, v.state).map((c, k) => (
                  <span key={k} style={{ color: c.color }}>
                    {c.text}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
