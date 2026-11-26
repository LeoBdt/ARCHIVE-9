import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { getJson, postJson, type FactOperationView, type NoteView, type TechniqueView } from "../api.ts";
import { isWorking, Process, useRequest } from "../components/Process.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { formatCount, versionText, when } from "../format.ts";

type Section = "notes" | "feedback" | "tidy" | "drawers" | "storage";

const OPS: Record<FactOperationView["op"], string> = { move: "DÉPLACÉ", rewrite: "REFORMULÉ", merge: "FUSIONNÉ", delete: "SUPPRIMÉ", drawer: "TIROIR PERSO" };
const STATUS: Record<FactOperationView["status"], [string, string]> = {
  done: ["fait", "var(--green)"],
  planned: ["en attente", "var(--yellow)"],
  applied: ["appliqué", "var(--green)"],
  dismissed: ["écarté", "var(--faint)"],
  failed: ["plus possible", "var(--red-soft)"],
};
const VERDICTS = { adopted: ["ADOPTÉ", "var(--green)"], partial: ["EN PARTIE", "var(--yellow)"], ignored: ["IGNORÉ", "var(--faint)"] } as const;
const NOTE_STATUS: Record<NoteView["status"], [string, string]> = {
  open: ["ouverte", "var(--yellow)"],
  done: ["fait", "var(--green)"],
  declined: ["refusé", "var(--faint)"],
  later: ["plus tard", "var(--blue)"],
};

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} Mo`;

function Notebook({ notes, isOwner }: { notes: NoteView[]; isOwner: boolean }) {
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const answer = useMutation({
    mutationFn: ({ id, status }: { id: string; status: NoteView["status"] }) => postJson(`/api/technique/notes/${id}`, { status, answer: drafts[id] ?? "" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technique"] }),
  });
  const groups: [NoteView["kind"], string][] = [
    ["gap", "Ce qui me manque"],
    ["wish", "Ce que j'aimerais changer chez moi"],
  ];
  return (
    <div className="grid two-cols">
      {groups.map(([kind, title]) => {
        const list = notes.filter((n) => n.kind === kind);
        return (
          <section key={kind} className="panel px-dim" aria-label={title}>
            <div className="section-head">
              <h2>{title}</h2>
              <span className="meta strong">{list.filter((n) => n.status === "open").length} ouvertes</span>
            </div>
            {list.length === 0 && <p className="empty">Rien d'écrit pour l'instant.</p>}
            <ul className="plain scroll-box tall">
              {list.map((n) => (
                <li key={n.id} className="op-row">
                  <div className="row-wrap">
                    <span className="label" style={{ color: NOTE_STATUS[n.status][1] }}>
                      {NOTE_STATUS[n.status][0]}
                    </span>
                    <span className="meta">
                      {when(n.createdAt)} · {n.source === "conversation" ? "en conversation" : n.label !== null ? `réflexion ${versionText(n.label)}` : "réflexion"}
                    </span>
                  </div>
                  <p>{n.content}</p>
                  {n.reason && <p className="meta">{n.reason}</p>}
                  {n.answer && <p className="soft">↪ {n.answer}</p>}
                  {isOwner && (
                    <div className="note-answer">
                      <input
                        className="search px-dim"
                        aria-label="Ta réponse"
                        placeholder="Un mot pour lui (optionnel)"
                        value={drafts[n.id] ?? ""}
                        onChange={(e) => {
                          setDrafts({ ...drafts, [n.id]: e.target.value });
                        }}
                      />
                      {(["done", "later", "declined"] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          className="button-ghost small"
                          disabled={answer.isPending}
                          onClick={() => {
                            answer.mutate({ id: n.id, status });
                          }}
                        >
                          {{ done: "Fait", later: "Plus tard", declined: "Refuser" }[status]}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Feedback({ list }: { list: TechniqueView["feedback"] }) {
  const [who, setWho] = useState("");
  const shown = list.filter((f) => !who || f.authorName === who);
  const authors = [...new Set(list.map((f) => f.authorName))].sort((a, b) => a.localeCompare(b, "fr"));
  return (
    <section className="panel px-dim" aria-label="Tous les retours">
      <div className="section-head">
        <h2>Tous les retours</h2>
        <span className="meta strong">
          {list.filter((f) => f.verdict === "adopted").length} adoptés · {list.filter((f) => f.verdict === "ignored").length} ignorés · {list.filter((f) => !f.reviewedAt).length} en attente
        </span>
      </div>
      <div className="row-wrap">
        <button type="button" className={`chip${who ? "" : " on"}`} onClick={() => { setWho(""); }}>
          tout le monde
        </button>
        {authors.map((a) => (
          <button key={a} type="button" className={`chip${who === a ? " on" : ""}`} onClick={() => { setWho(a); }}>
            {a}
          </button>
        ))}
      </div>
      <ul className="plain scroll-box tall">
        {shown.map((f) => (
          <li key={f.id} className="op-row">
            <div className="row-wrap">
              {f.verdict ? (
                <span className="label" style={{ color: VERDICTS[f.verdict][1] }}>
                  {VERDICTS[f.verdict][0]}
                </span>
              ) : (
                <span className="label" style={{ color: "var(--yellow)" }}>
                  {f.reviewedAt ? "LU" : "EN ATTENTE"}
                </span>
              )}
              <span className="meta">
                {f.authorName} · {when(f.createdAt)} · {f.source === "site" ? "site" : "Discord"}
                {f.reviewedLabel !== null ? ` · pesé en ${versionText(f.reviewedLabel)}` : ""}
              </span>
            </div>
            <p>
              {f.about ? <span className="meta">à propos de « {f.about} » : </span> : null}
              {f.content}
            </p>
            {f.verdictReason && <p className="soft">↪ {f.verdictReason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tidy({ operations, dryRun }: { operations: FactOperationView[]; dryRun: boolean }) {
  const client = useQueryClient();
  const [filter, setFilter] = useState<"planned" | "all">(operations.some((o) => o.status === "planned") ? "planned" : "all");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const { data: request } = useRequest(requestId);
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "apply" | "dismiss" }) => postJson(`/api/technique/operations/${id}`, { action }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technique"] }),
  });
  const cleanup = useMutation({
    mutationFn: () => postJson<{ requestId: string }>("/api/technique/cleanup", {}),
    onSuccess: (r) => {
      setRequestId(r.requestId);
    },
  });
  const shown = filter === "planned" ? operations.filter((o) => o.status === "planned") : operations;
  const working = isWorking(request, requestId);
  return (
    <section className="panel px-dim" aria-label="Rangement des fragments">
      <div className="section-head">
        <h2>Ce que mon rangement a fait</h2>
        <button type="button" className="button-ghost small" onClick={() => { setAsking(true); }}>
          Lancer un grand ménage
        </button>
      </div>
      <p className="soft small">{dryRun ? "Mode d'essai : les fusions et suppressions attendent ton accord." : "Mode d'essai coupé : ARCHIVE-9 fusionne et supprime seul."}</p>
      <div className="row-wrap">
        <button type="button" className={`chip${filter === "planned" ? " on" : ""}`} onClick={() => { setFilter("planned"); }}>
          en attente ({operations.filter((o) => o.status === "planned").length})
        </button>
        <button type="button" className={`chip${filter === "all" ? " on" : ""}`} onClick={() => { setFilter("all"); }}>
          tout ({operations.length})
        </button>
      </div>
      {shown.length === 0 && <p className="empty">Rien ici.</p>}
      <ul className="plain scroll-box tall">
        {shown.map((o) => (
          <li key={o.id} className="op-row">
            <div className="row-wrap">
              <span className="label" style={{ color: "var(--text)" }}>
                {OPS[o.op]}
              </span>
              <span className="label" style={{ color: STATUS[o.status][1] }}>
                {STATUS[o.status][0]}
              </span>
              <Link to={`/dossiers/${o.memberId}`} className="who-link">
                {o.memberName}
              </Link>
              {o.ref && <span className="chip">#{o.ref}</span>}
              <span className="meta">
                {when(o.createdAt)} · {o.run === "cleanup" ? "grand ménage" : "le soir"}
              </span>
            </div>
            {o.op === "move" && (
              <p className="meta">
                {o.details.from} → {o.details.to}
              </p>
            )}
            {o.op === "drawer" && <p>Nouveau tiroir « {o.details.drawer?.label} » avec {o.details.merged?.length ?? 0} fragments</p>}
            {(o.op === "rewrite" || o.op === "merge") && o.details.before && o.details.after !== o.details.before && <p className="op-before">{o.details.before}</p>}
            {o.op === "delete" && <p className="op-before">{o.details.before}</p>}
            {(o.op === "rewrite" || o.op === "merge") && <p>{o.details.after}</p>}
            {o.op === "merge" && o.details.merged?.map((m) => (
              <p key={m.id} className="meta">
                absorbe #{m.ref} : {m.content}
              </p>
            ))}
            <p className="soft small">{o.reason}</p>
            {o.status === "planned" && (
              <div className="row-wrap">
                <button type="button" className="button-ghost small" disabled={decide.isPending} onClick={() => { decide.mutate({ id: o.id, action: "apply" }); }}>
                  Appliquer
                </button>
                <button type="button" className="button-ghost small" disabled={decide.isPending} onClick={() => { decide.mutate({ id: o.id, action: "dismiss" }); }}>
                  Écarter
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {asking && (
        <Sheet
          title="Grand ménage"
          locked={working}
          onClose={() => {
            setAsking(false);
            setRequestId(null);
            void client.invalidateQueries({ queryKey: ["technique"] });
          }}
        >
          {!requestId ? (
            <>
              <p className="soft">Je relis tous les dossiers un par un, pour 0,50 $ au plus.{dryRun ? " En mode d'essai, je ne fais que proposer les fusions et les suppressions." : ""}</p>
              <div className="row-wrap">
                <button type="button" className="button" disabled={cleanup.isPending} onClick={() => { cleanup.mutate(); }}>
                  Lancer
                </button>
                <button type="button" className="button-ghost" onClick={() => { setAsking(false); }}>
                  Annuler
                </button>
              </div>
            </>
          ) : (
            <Process request={request} />
          )}
        </Sheet>
      )}
    </section>
  );
}

function Drawers({ drawers }: { drawers: TechniqueView["drawers"] }) {
  return (
    <section className="panel px-dim" aria-label="Les tiroirs que j'ai ouverts">
      <div className="section-head">
        <h2>Les tiroirs que j'ai ouverts</h2>
        <span className="meta strong">{drawers.length}</span>
      </div>
      {drawers.length === 0 && <p className="empty">Aucun pour l'instant.</p>}
      <ul className="plain scroll-box">
        {drawers.map((d) => (
          <li key={d.key} className="op-row">
            <div className="row-wrap">
              <b>{d.label}</b>
              <span className="meta">
                {d.owner ? `perso · ${d.owner}` : "commun"} · {d.count} fragments · {when(d.created_at)}
              </span>
            </div>
            {d.reason && <p className="soft small">{d.reason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Storage({ storage }: { storage: TechniqueView["storage"] }) {
  const c = storage.counts;
  const n = (key: string) => formatCount(Number(c[key] ?? 0));
  const tiles: [string, string][] = [
    ["messages", n("messages")],
    ["dont sources de fragments", n("source_messages")],
    ["dont MP", n("dm_messages")],
    ["fragments actuels", n("facts")],
    ["versions gardées", n("fact_rows")],
    ["images vues", `${n("images_described")} / ${n("images")}`],
    ["tiroirs", `${n("drawers")} (${n("personal_drawers")} perso)`],
    ["membres", n("members")],
    ["base", megabytes(Number(c.database_bytes ?? 0))],
  ];
  return (
    <section className="panel px-dim" aria-label="Stockage">
      <div className="section-head">
        <h2>Ma mémoire, en chiffres</h2>
        {c.oldest_message && <span className="meta strong">plus vieux message : {when(String(c.oldest_message))}</span>}
      </div>
      <div className="storage-grid">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <b>{value}</b>
            <span className="meta">{label}</span>
          </div>
        ))}
      </div>
      <h3 className="label">Les plus grosses tables</h3>
      <ul className="plain">
        {storage.tables.map((t) => (
          <li key={t.name} className="row-wrap">
            <span className="grow">{t.name}</span>
            <span className="meta">
              {formatCount(Math.round(t.rows))} lignes · {megabytes(t.bytes)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Admin › Technique: its notebook, every feedback, what the tidy did, its drawers, its storage. */
export function TechniqueTab() {
  const [section, setSection] = useState<Section>("notes");
  const { data } = useQuery({ queryKey: ["technique"], queryFn: () => getJson<TechniqueView>("/api/technique"), refetchInterval: 30_000 });
  if (!data) return <div aria-busy="true" />;
  const planned = data.operations.filter((o) => o.status === "planned").length;
  return (
    <div className="stack-16">
      <Tabs
        label="Technique"
        value={section}
        onChange={setSection}
        tabs={[
          ["notes", "Mon carnet", data.notes.filter((n) => n.status === "open").length],
          ["feedback", "Retours", data.feedback.length],
          ["tidy", "Rangement", planned],
          ["drawers", "Tiroirs", data.drawers.length],
          ["storage", "Stockage"],
        ]}
      />
      {section === "notes" && <Notebook notes={data.notes} isOwner={data.isOwner} />}
      {section === "feedback" && <Feedback list={data.feedback} />}
      {section === "tidy" && <Tidy operations={data.operations} dryRun={data.tidyDryRun} />}
      {section === "drawers" && <Drawers drawers={data.drawers} />}
      {section === "storage" && <Storage storage={data.storage} />}
    </div>
  );
}
