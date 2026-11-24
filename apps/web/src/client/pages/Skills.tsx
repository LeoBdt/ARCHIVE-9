import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getJson, postJson, type SkillRevision, type SkillView, type Viewer } from "../api.ts";
import { isWorking, Process, useRequest } from "../components/Process.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { dayMonth, formatCount, when } from "../format.ts";
import { SKILL_BADGES } from "./Home.tsx";

type Filter = "all" | "mine" | "triggered" | "permanent" | "temporary";

/** One field: ARCHIVE-9 picks the type, the scope and the name, and shows how it checks. */
function TeachSheet({ skill, onClose }: { skill?: SkillView; onClose: () => void }) {
  const client = useQueryClient();
  const [text, setText] = useState(skill ? skill.rule : "");
  const [requestId, setRequestId] = useState<string | null>(null);
  const { data: request } = useRequest(requestId);
  const send = useMutation({
    mutationFn: () => postJson<{ requestId: string }>(skill ? `/api/skills/${skill.id}` : "/api/skills", { text }),
    onSuccess: (r) => {
      setRequestId(r.requestId);
    },
  });
  if (request && !isWorking(request, requestId)) void client.invalidateQueries({ queryKey: ["skills"] });
  return (
    <Sheet title={skill ? `Modifier ${skill.name}` : "M'apprendre quelque chose"} onClose={onClose} locked={isWorking(request, requestId) || send.isPending}>
      <label htmlFor="teach" className="label">
        {skill ? "Ce que je dois faire maintenant" : "Ce que tu veux m'apprendre"}
      </label>
      <textarea
        id="teach"
        className="field"
        rows={4}
        maxLength={600}
        value={text}
        disabled={requestId !== null}
        placeholder="ex. : quand quelqu'un parle de la météo, réagis avec l'emoji qui va"
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      {send.error && <p className="error">{send.error.message === "too_many" ? "Beaucoup de demandes aujourd'hui : réessaie demain." : "Envoi impossible."}</p>}
      {requestId === null && (
        <div>
          <button type="button" className="button" disabled={text.trim().length < 5 || send.isPending || text.trim() === skill?.rule} onClick={() => { send.mutate(); }}>
            {skill ? "Enregistrer" : "Lui apprendre"}
          </button>
        </div>
      )}
      <Process request={request} />
    </Sheet>
  );
}

function HistorySheet({ skill, onClose }: { skill: SkillView; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ["skill-history", skill.id], queryFn: () => getJson<SkillRevision[]>(`/api/skills/${skill.id}/history`) });
  return (
    <Sheet title={`Historique de ${skill.name}`} onClose={onClose}>
      <ol className="timeline">
        <li>
          <span className="pixel-date">maintenant</span>
          <span className="soft">{skill.rule}</span>
        </li>
        {(data ?? []).map((r, i) => (
          <li key={i}>
            <span className="pixel-date">jusqu'au {dayMonth(r.createdAt)}</span>
            <span className="soft">{r.rule}</span>
            <span className="meta">remplacée {when(r.createdAt)}{r.editedBy ? ` par ${r.editedBy}` : ""}</span>
          </li>
        ))}
        <li>
          <span className="pixel-date">créée {when(skill.createdAt)}</span>
          <span className="meta">par {skill.author ?? "un ancien membre"}</span>
        </li>
      </ol>
    </Sheet>
  );
}

export function Skills({ viewer }: { viewer: Viewer }) {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ["skills"], queryFn: () => getJson<SkillView[]>("/api/skills"), refetchInterval: 60_000 });
  const [filter, setFilter] = useState<Filter>("all");
  const [teach, setTeach] = useState<{ skill?: SkillView } | null>(null);
  const [history, setHistory] = useState<SkillView | null>(null);
  const [removing, setRemoving] = useState<SkillView | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => postJson(`/api/skills/${id}/delete`, {}),
    onSuccess: () => client.invalidateQueries({ queryKey: ["skills"] }),
  });
  if (!data) return <main className="page" aria-busy="true" />;
  const kindOf = (k: SkillView): Filter => (k.expiresAt ? "temporary" : k.kind);
  const list = data.filter((k) => filter === "all" || (filter === "mine" ? k.authorId === viewer.id : kindOf(k) === filter));
  const filters: [Filter, string][] = [
    ["all", `toutes · ${String(data.length)}`],
    ["mine", `les miennes · ${String(data.filter((k) => k.authorId === viewer.id).length)}`],
    ["triggered", "mots"],
    ["permanent", "toujours"],
    ["temporary", "temporaires"],
  ];

  return (
    <main className="page">
      <div className="section-head">
        <h1 className="page-title">Ce qu'on m'a appris</h1>
        <button type="button" className="button" onClick={() => { setTeach({}); }}>
          M'apprendre quelque chose
        </button>
      </div>
      <div className="chips" role="group" aria-label="Filtrer">
        {filters.map(([k, label]) => (
          <button key={k} type="button" className={`chip${filter === k ? " on" : ""}`} aria-pressed={filter === k} onClick={() => { setFilter(k); }}>
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="empty">Rien ici pour l'instant.</p>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" }}>
          {list.map((k, i) => {
            const badge = SKILL_BADGES[kindOf(k) === "temporary" ? "temporary" : k.kind];
            const scope = k.channelName ? `#${k.channelName}` : k.memberName ? `avec ${k.memberName}` : null;
            return (
              <article key={k.id} className="card px-dim appear" style={{ animationDelay: `${String(Math.min(i, 12) * 0.03)}s` }}>
                <div className="skill-head">
                  <span className="skill-name">{k.name}</span>
                  <span className="badge" style={{ background: badge.color }}>
                    {badge.label}
                    {scope ? ` · ${scope}` : ""}
                  </span>
                </div>
                <div className="skill-rule">{k.rule}</div>
                {k.triggers.length > 0 && <div className="meta">mots : {k.triggers.join(", ")}</div>}
                <div className="meta">
                  par {k.author ?? "un ancien membre"} · le {dayMonth(k.createdAt)} · servie {formatCount(k.uses)} fois
                  {k.revisions > 0 ? ` · modifiée ${when(k.updatedAt)}` : ""}
                  {k.expiresAt ? ` · jusqu'à ${when(k.expiresAt)}` : ""}
                </div>
                <div className="row-wrap push-bottom">
                  {k.canEdit && (
                    <>
                      <button type="button" className="button-ghost small" onClick={() => { setTeach({ skill: k }); }}>
                        Modifier
                      </button>
                      <button type="button" className="button-ghost small" onClick={() => { setRemoving(k); }}>
                        Supprimer
                      </button>
                    </>
                  )}
                  <button type="button" className="button-ghost small" onClick={() => { setHistory(k); }}>
                    Historique
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {teach && (
        <TeachSheet
          skill={teach.skill}
          onClose={() => {
            setTeach(null);
          }}
        />
      )}
      {history && (
        <HistorySheet
          skill={history}
          onClose={() => {
            setHistory(null);
          }}
        />
      )}
      {removing && (
        <Sheet title={`Supprimer ${removing.name} ?`} onClose={() => { setRemoving(null); }}>
          <p className="soft">Je ne l'appliquerai plus. Son historique reste.</p>
          <div>
            <button
              type="button"
              className="button"
              onClick={() => {
                remove.mutate(removing.id);
                setRemoving(null);
              }}
            >
              Supprimer
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
