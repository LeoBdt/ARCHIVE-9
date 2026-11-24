import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getJson, postJson, type Esprit, type SelfStateView, type Viewer } from "../api.ts";
import { diffStates } from "../archive.ts";
import { isWorking, Process, useRequest } from "../components/Process.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Sprite } from "../components/Sprite.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { dayMonth, versionText, when } from "../format.ts";

const SOURCES = { initial: "première prise de conscience", reflection: "réflexion du soir", midday: "réflexion de midi", rollback: "retour en arrière" };
const VERDICTS = {
  adopted: { label: "ADOPTÉ", color: "var(--green)" },
  partial: { label: "EN PARTIE", color: "var(--yellow)" },
  ignored: { label: "IGNORÉ", color: "var(--faint)" },
};
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** When each item first showed up, read from the history (oldest version that has it). */
function sinceWhen(history: Esprit["history"], pick: (s: SelfStateView) => string[] | string): Map<string, string> {
  const first = new Map<string, string>();
  for (const v of [...history].reverse()) {
    const value = pick(v.state);
    for (const item of Array.isArray(value) ? value : [value]) if (item && !first.has(item)) first.set(item, v.createdAt);
  }
  return first;
}

/** The next reflection, from the hours set by the admins. */
function nextReflection(hours: { midday: number; evening: number }): string {
  const now = new Date();
  const local = Number(now.toLocaleString("fr-FR", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Paris" }));
  if (local < hours.midday) return `aujourd'hui ${hour(hours.midday)} (midi)`;
  if (local < hours.evening) return `aujourd'hui ${hour(hours.evening)} (soir)`;
  return `demain ${hour(hours.midday)} (midi)`;
}

function CommentSheet({ about, onClose }: { about: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const { data: request } = useRequest(requestId);
  const send = useMutation({
    mutationFn: () => postJson<{ requestId: string }>("/api/esprit/comment", { about, comment: text }),
    onSuccess: (r) => {
      setRequestId(r.requestId);
    },
  });
  return (
    <Sheet title="Commenter" onClose={onClose} locked={isWorking(request, requestId) || send.isPending}>
      <div className="quote">{about}</div>
      <label htmlFor="comment" className="label">
        Ton commentaire
      </label>
      <textarea
        id="comment"
        className="field"
        rows={3}
        maxLength={600}
        value={text}
        disabled={requestId !== null}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      {send.error && <p className="error">{send.error.message === "too_many" ? "Beaucoup de demandes aujourd'hui : réessaie demain." : "Envoi impossible."}</p>}
      {requestId === null && (
        <div>
          <button type="button" className="button" disabled={text.trim().length < 3 || send.isPending} onClick={() => { send.mutate(); }}>
            Envoyer
          </button>
        </div>
      )}
      <p className="meta">Il te répond tout de suite, mais ne change rien lui-même : il pèse ton commentaire à sa réflexion du soir.</p>
      <Process request={request} />
    </Sheet>
  );
}

function Item({ text, since, from, canComment, onComment }: { text: string; since?: string; from?: string; canComment: boolean; onComment: () => void }) {
  return (
    <li className="mind-item">
      <p>{text}</p>
      <div className="row-wrap meta">
        {since && <span>depuis le {dayMonth(since)}</span>}
        {from && <span>· {from}</span>}
        {canComment && (
          <button type="button" className="button-ghost small push-right" onClick={onComment}>
            Commenter
          </button>
        )}
      </div>
    </li>
  );
}

export function Mind({ viewer }: { viewer: Viewer }) {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ["esprit"], queryFn: () => getJson<Esprit>("/api/esprit"), refetchInterval: 60_000 });
  const [tab, setTab] = useState<"pending" | "history">("history");
  const [comment, setComment] = useState<string | null>(null);
  const rollback = useMutation({
    mutationFn: (version: number) => postJson("/api/esprit/rollback", { version }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["esprit"] }),
  });
  const [confirmRollback, setConfirmRollback] = useState<{ version: number; label: number } | null>(null);
  if (!data) return <main className="page" aria-busy="true" />;
  const current = data.history[0];
  const state = current?.state;
  const opinionsSince = sinceWhen(data.history, (s) => s.opinions);
  const jokesSince = sinceWhen(data.history, (s) => s.runningJokes);
  const resolutions = state?.resolutions ?? [];
  const admin = viewer.isAdmin;

  return (
    <main className="page">
      <section aria-label="Mon état" className="px mind-hero">
        <Sprite cell={8} asleep={data.paused} mood={state?.icon} />
        <div className="stack-12 grow">
          <div className="row-wrap">
            {current && <span className="badge big" style={{ background: "var(--red)" }}>VERSION {versionText(current.label)}</span>}
            {current && (
              <span className="chip">
                {SOURCES[current.source]} · {when(current.createdAt)}
              </span>
            )}
            <span className="chip">prochaine : {nextReflection(data.reflectionHours)}</span>
          </div>
          <h1 className="page-title">Ce que je suis devenu.</h1>
          {state && (
            <div className="mood">
              Humeur du moment : <span>{state.mood}</span>
            </div>
          )}
          {data.status && <div className="bubble px-red">« {data.status} »</div>}
        </div>
      </section>

      <section aria-labelledby="resolutions" className="panel px-dim">
        <div className="section-head">
          <h2 id="resolutions" style={{ color: "var(--red)" }}>
            Mes résolutions
          </h2>
          <span className="chip">le soir</span>
        </div>
        {resolutions.length === 0 ? (
          <p className="empty">Aucune pour l'instant.</p>
        ) : (
          <ul className="plain mind-list">
            {resolutions.map((r) => (
              <Item key={r} text={r} canComment={admin} onComment={() => { setComment(`résolution : ${r}`); }} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid mind-grid">
        <section className="panel px-dim">
          <div className="section-head">
            <h2>Mes opinions</h2>
            <span className="chip">le soir</span>
          </div>
          <ul className="plain mind-list">
            {(state?.opinions ?? []).map((o) => (
              <Item key={o} text={o} since={opinionsSince.get(o)} canComment={admin} onComment={() => { setComment(`opinion : ${o}`); }} />
            ))}
          </ul>
        </section>
        <section className="panel px-dim">
          <div className="section-head">
            <h2>Mes blagues récurrentes</h2>
            <span className="chip">midi et soir</span>
          </div>
          <ul className="plain mind-list">
            {(state?.runningJokes ?? []).map((o) => (
              <Item key={o} text={o} since={jokesSince.get(o)} canComment={admin} onComment={() => { setComment(`blague : ${o}`); }} />
            ))}
          </ul>
        </section>
        <section className="panel px-dim">
          <div className="section-head">
            <h2>Mon journal</h2>
            <span className="chip">midi et soir</span>
          </div>
          <ul className="plain mind-list">
            <Item text={state?.notes.length ? state.notes : "Rien d'écrit pour l'instant."} since={current?.createdAt} canComment={admin && Boolean(state?.notes)} onComment={() => { setComment("mon journal"); }} />
          </ul>
        </section>
      </div>

      <section aria-labelledby="retours" className="panel px-dim">
        <h2 id="retours">Les retours qu'on m'a faits</h2>
        <Tabs
          label="Retours"
          value={tab}
          onChange={setTab}
          tabs={[
            ["pending", "En attente", data.pending.length],
            ["history", "Historique", data.reviewed.length],
          ]}
        />
        {tab === "pending" ? (
          data.pending.length === 0 ? (
            <p className="empty">Rien en attente.</p>
          ) : (
            <ul className="plain scroll-box">
              {data.pending.map((f) => (
                <li key={f.id} className="row-line">
                  <time dateTime={f.createdAt}>{when(f.createdAt)}</time>
                  <span className="stack-4">
                    <span>
                      <b>{f.author}</b>
                      {f.about ? ` sur « ${f.about} »` : ""} · {f.content}
                    </span>
                    <span className="meta">relecture à {hour(data.reflectionHours.evening)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : data.reviewed.length === 0 ? (
          <p className="empty">Aucun retour relu pour l'instant.</p>
        ) : (
          <ul className="plain scroll-box">
            {data.reviewed.map((f) => {
              const v = f.verdict ? VERDICTS[f.verdict] : null;
              return (
                <li key={f.id} className="row-line">
                  <time dateTime={f.createdAt}>{dayMonth(f.createdAt)}</time>
                  <span className="stack-4">
                    <span>
                      <b>{f.author}</b>
                      {f.about ? ` sur « ${f.about} »` : ""} · {f.content}
                    </span>
                    <span>
                      {v ? (
                        <span className="verdict" style={{ background: v.color }}>
                          {v.label}
                        </span>
                      ) : (
                        <span className="verdict" style={{ background: "var(--edge)", color: "var(--text)" }}>
                          LU
                        </span>
                      )}{" "}
                      <span className="soft">{f.verdictReason ?? "Lu avant que je note mes décisions."}</span>
                    </span>
                    <span className="meta">
                      relu {when(f.reviewedAt)}
                      {f.reviewedLabel !== null ? ` · version ${versionText(f.reviewedLabel)}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="histoire" className="stack-16">
        <h2 id="histoire">Mon histoire</h2>
        <ol className="timeline">
          {data.history.map((v, i) => (
            <li key={v.version}>
              <div className="row-wrap">
                <span className="pixel-date">{when(v.createdAt)}</span>
                <span className="soft small">
                  version {versionText(v.label)} · {SOURCES[v.source]}
                </span>
                {admin && i > 0 && (
                  <button type="button" className="button-ghost small push-right" onClick={() => { setConfirmRollback({ version: v.version, label: v.label }); }}>
                    Revenir à cette version
                  </button>
                )}
              </div>
              <div className="soft">Humeur : {v.state.mood}</div>
              <div className="row-wrap small">
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

      {comment && (
        <CommentSheet
          about={comment}
          onClose={() => {
            setComment(null);
          }}
        />
      )}
      {confirmRollback && (
        <Sheet title={`Revenir à la version ${versionText(confirmRollback.label)} ?`} onClose={() => { setConfirmRollback(null); }}>
          <p className="soft">Son état redevient celui-là, sous un nouveau numéro. L'historique garde tout.</p>
          <div className="row-wrap">
            <button
              type="button"
              className="button"
              onClick={() => {
                rollback.mutate(confirmRollback.version);
                setConfirmRollback(null);
              }}
            >
              Revenir
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
