import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { getJson, HttpError, postJson, type Category, type Dossier as DossierData, type Fact } from "../api.ts";
import { categoryOf, reliability, signed, stamp } from "../archive.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Cabinet, CardList, Marks } from "../components/Cabinet.tsx";
import { LineChart } from "../components/Charts.tsx";
import { isWorking, Process, useRequest } from "../components/Process.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { SourceSheet } from "../components/Source.tsx";
import { ago, dayMonth, formatCount, when } from "../format.ts";

const code = (i: number) => `F${String(i + 1).padStart(3, "0")}`;

/** The card pulled out of its drawer: the change is saved, then ARCHIVE-9 follows up, step by step. */
function EditSheet({ fact, label, memberId, onClose }: { fact: Fact; label: string; memberId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [text, setText] = useState(fact.content);
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const { data: request } = useRequest(requestId);
  const working = isWorking(request, requestId);
  const save = useMutation({
    mutationFn: (action: "correct" | "remove") =>
      postJson<{ requestId: string }>(`/api/facts/${fact.id}`, action === "remove" ? { action, reason } : { action, content: text, reason }),
    onSuccess: async (result) => {
      setRequestId(result.requestId);
      await client.invalidateQueries({ queryKey: ["dossier", memberId] });
    },
  });
  if (request?.status === "done" && !working) void client.invalidateQueries({ queryKey: ["dossier", memberId] });

  return (
    <Sheet title={`Corriger ${label}`} onClose={onClose} locked={working || save.isPending}>
      <div className="edit-card-inline">
        <span className="tab">{label}</span>
        <p className="ink">Ce que j'ai retenu : « {fact.content} »</p>
        <label htmlFor="edit-text" className="ink-label">
          La bonne version
        </label>
        <textarea
          id="edit-text"
          rows={3}
          value={text}
          disabled={requestId !== null}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <label htmlFor="edit-why" className="ink-label">
          Pourquoi (obligatoire pour retirer)
        </label>
        <input
          id="edit-why"
          value={reason}
          disabled={requestId !== null}
          placeholder="ex. : je suis en master, pas en licence"
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        {save.error && <p className="ink" style={{ color: "#8a2a33" }}>{save.error.message === "too_many" ? "Beaucoup de corrections aujourd'hui : réessaie demain." : save.error.message}</p>}
        {requestId === null && (
          <div className="row-wrap">
            <button type="button" className="ink-button" disabled={save.isPending || text.trim() === fact.content} onClick={() => { save.mutate("correct"); }}>
              Enregistrer
            </button>
            <button type="button" className="ink-button ghost" disabled={save.isPending || reason.trim().length < 3} onClick={() => { save.mutate("remove"); }}>
              Retirer ce fragment
            </button>
          </div>
        )}
      </div>
      <Process request={request} />
    </Sheet>
  );
}

function FactCard({ fact, label, onEdit, onSource }: { fact: Fact; label: string; onEdit?: () => void; onSource?: () => void }) {
  const s = stamp(fact.nature, fact.reportedByName);
  const lit = reliability(fact.confidence);
  return (
    <article className="index-card">
      <span className="tab">{label}</span>
      <div className="card-top">
        <span className={s.dashed ? "stamp dashed" : "stamp"} style={{ color: s.ink, transform: `rotate(${String(s.tilt)}deg)` }}>
          {s.text}
        </span>
        <Marks lit={lit} label={`fiabilité ${String(lit)} sur 5`} />
      </div>
      <p>{fact.content}</p>
      <div className="card-dates">
        noté {when(fact.createdAt)}
        {fact.corrected && (
          <>
            <br />
            corrigé {when(fact.corrected.at)}
            {fact.corrected.by ? ` par ${fact.corrected.by}` : ""}
          </>
        )}
      </div>
      <div className="card-actions">
        {onSource ? (
          <button type="button" className="card-action" onClick={onSource}>
            source
          </button>
        ) : fact.source ? (
          <a href={fact.source} target="_blank" rel="noreferrer noopener">
            source ↗
          </a>
        ) : (
          <span className="ink-label">{fact.corrected ? "écrit par la personne" : "sans source"}</span>
        )}
        {onEdit && (
          <button type="button" className="card-action" onClick={onEdit}>
            modifier
          </button>
        )}
      </div>
    </article>
  );
}

function Relation({ data, onSource }: { data: DossierData; onSource: (id: string) => void }) {
  const r = data.relationship;
  if (!r) return <p className="empty">Je ne lui ai jamais vraiment parlé.</p>;
  return (
    <>
      <div className="duo">
        <div className="duo-aff">
          <span className="label">Affinité</span>
          <b>{signed(r.affinity)}</b>
          <small>comment {data.isBot ? "il" : "on"} me traite</small>
        </div>
        <div className="duo-trust">
          <span className="label">Confiance</span>
          <b>{r.trust}</b>
          <small>ce que je crois de ce qui est dit</small>
        </div>
      </div>
      {r.feeling && (
        <div className="block">
          <span className="label">Mon ressenti</span>
          <p>« {r.feeling} »</p>
        </div>
      )}
      <div className="section-head">
        <span className="label">30 derniers jours</span>
        <span className="legend">
          <span>
            <i style={{ background: "var(--red)" }} />
            affinité
          </span>
          <span>
            <i style={{ background: "var(--blue)" }} />
            confiance
          </span>
        </span>
      </div>
      <LineChart
        points={data.history}
        series={[
          { key: "affinity", label: "affinité", color: "var(--red)", format: signed },
          { key: "trust", label: "confiance", color: "var(--blue)" },
        ]}
        min={Math.min(-20, ...data.history.map((h) => h.affinity)) - 5}
        max={100}
        ticks={[0, 50, 100]}
        label={`Affinité et confiance sur 30 jours : affinité ${signed(r.affinity)}, confiance ${String(r.trust)} aujourd'hui`}
      />
      <h3 className="label">Derniers événements</h3>
      {data.events.length === 0 ? (
        <p className="empty">Rien de notable ces 30 derniers jours.</p>
      ) : (
        <ul className="plain events">
          {data.events.map((e, i) => (
            <li key={i}>
              <div className="row-wrap">
                <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
                {e.affinityDelta !== 0 && <span className="chip aff">affinité {signed(e.affinityDelta)}</span>}
                {e.trustDelta !== 0 && <span className="chip trust">confiance {signed(e.trustDelta)}</span>}
              </div>
              <span className="event-why">
                {e.reason}
                {e.sourceMessageId && (
                  <button type="button" className="link-button" onClick={() => { onSource(e.sourceMessageId ?? ""); }}>
                    source
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Dossier() {
  const { id = "" } = useParams();
  const { data, error } = useQuery({ queryKey: ["dossier", id], queryFn: () => getJson<DossierData>(`/api/dossiers/${id}`) });
  const [editing, setEditing] = useState<{ fact: Fact; label: string } | null>(null);
  const [source, setSource] = useState<{ id: string; title: string } | null>(null);

  if (error instanceof HttpError && error.status === 404) {
    return (
      <main className="page">
        <p className="empty">Aucun dossier ici. Soit je ne connais pas cette personne, soit elle a quitté mes archives.</p>
        <Link to="/archives">← Les archives</Link>
      </main>
    );
  }
  if (!data) return <main className="page" aria-busy="true" />;

  const codes = new Map(data.facts.map((f, i) => [f.id, code(i)]));
  const known = new Map<string, Category>(data.categories.map((c) => [c.key, c]));
  const drawers = data.categories
    .map((c) => ({ c, facts: data.facts.filter((f) => f.category === c.key) }))
    .filter((d) => d.facts.length > 0)
    .map(({ c, facts }) => ({
      key: c.key,
      label: c.label.toUpperCase(),
      sublabel: c.createdBy === "archive-9" && c.createdAt ? `tiroir créé par moi le ${dayMonth(c.createdAt)}` : undefined,
      color: c.color,
      count: facts.length,
      content: (
        <CardList
          label={c.label}
          items={facts}
          render={(f) => (
            <div style={{ ["--cc" as string]: categoryOf(f.category, known).color }}>
              <FactCard
                fact={f}
                label={codes.get(f.id) ?? ""}
                onSource={f.sourceMessageId ? () => { setSource({ id: f.sourceMessageId ?? "", title: `Source de ${codes.get(f.id) ?? ""}` }); } : undefined}
                onEdit={data.canEdit ? () => { setEditing({ fact: f, label: codes.get(f.id) ?? "" }); } : undefined}
              />
            </div>
          )}
        />
      ),
    }));

  return (
    <main className="page">
      <div className="dossier-layout">
        <div className="stack-24">
          <section className="panel px dossier-head">
            <div className="id-row">
              <Avatar id={data.id} name={data.name} hash={data.avatar} size={88} />
              <div className="id-text">
                <h1>{data.name}</h1>
                {data.aliases.length > 0 && <div className="aliases">aussi : {data.aliases.join(", ")}</div>}
                <div className="chips">
                  <span className="chip">dossier n°{data.id.slice(-4)}</span>
                  <span className="chip">ouvert le {dayMonth(data.firstSeenAt)}</span>
                  {data.changedAt && <span className="chip">modifié {ago(data.changedAt)}</span>}
                  <span className="chip">{formatCount(data.facts.length)} fragments</span>
                  <span className="chip">{formatCount(data.messages)} messages</span>
                </div>
              </div>
            </div>
            {(data.tagline ?? data.summary) && (
              <div className="split">
                <div className="block">
                  <span className="label">En une phrase</span>
                  <p className="pull">{data.tagline ?? "…"}</p>
                  {data.summaryAt && <span className="meta">écrite {when(data.summaryAt)}</span>}
                </div>
                <div className="block">
                  <span className="label">Résumé</span>
                  <p>{data.summary ?? "Pas encore assez de fragments."}</p>
                  {data.summaryAt && <span className="meta">réécrit {when(data.summaryAt)}</span>}
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="fragments" className="stack-12">
            <div className="section-head">
              <h2 id="fragments">Ses fragments</h2>
              <span className="meta">{drawers.length} tiroirs</span>
            </div>
            {drawers.length === 0 ? <p className="empty">Rien d'archivé pour l'instant.</p> : <Cabinet drawers={drawers} />}
          </section>
        </div>

        <aside className="stack-18">
          <section className="panel px-dim">
            <h2>Notre relation</h2>
            <Relation data={data} onSource={(messageId) => { setSource({ id: messageId, title: "Ce qui l'a fait bouger" }); }} />
          </section>
          {data.isMine && (
            <section className="panel px-dim">
              <h2>Si c'est ton dossier</h2>
              <p className="meta strong">Tu peux corriger ou retirer chaque fragment ici. Pour tout effacer, tape <code>/oublie-moi</code> sur Discord.</p>
            </section>
          )}
        </aside>
      </div>

      {editing && (
        <EditSheet
          fact={editing.fact}
          label={editing.label}
          memberId={data.id}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {source && (
        <SourceSheet
          messageId={source.id}
          title={source.title}
          onClose={() => {
            setSource(null);
          }}
        />
      )}
    </main>
  );
}
