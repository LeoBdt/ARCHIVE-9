import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { getJson, type ActionEntry, type ErrorGroup, type LearnedEntry, type ReplyEntry, type TriageDetails, type TriageView } from "../api.ts";
import { signed, stamp } from "../archive.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { SourceSheet } from "../components/Source.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { clock, ms, TIME_ZONE, tokens, usd, when } from "../format.ts";

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

/** How each step of a reply reads in the journal. */
const STEP_NAMES: Record<string, string> = {
  sendReply: "Réponse envoyée",
  sendMessage: "Message envoyé",
  addReaction: "Réaction",
  staySilent: "Silence",
  readChannel: "Relu un salon",
  findMember: "Cherché un membre",
  myFacts: "Relu son dossier",
  forgetMyFacts: "Retiré des fragments",
  correctMyFact: "Corrigé un fragment",
  noteFeedback: "Noté un retour",
  setMyPreference: "Noté une préférence",
  createSkill: "Créé une skill",
  deleteSkill: "Supprimé une skill",
  listSkills: "Listé les skills",
};

const IGNORED: Record<string, string> = {
  outside_agents: "hors AGENTS, pas de mention",
  foreign_bot: "un bot qui n'est pas une IA",
  not_listened: "salon non écouté",
  paused: "pendant une pause",
  opted_out: "membre hors archives",
  trivial: "rien à répondre (emoji seul…)",
  observer_mode: "spontanéité à 0",
};

const TASKS: Record<string, string> = { triage: "tri", reply: "réponse", analysis: "analyse", reflection: "réflexion" };

function detail(params: Record<string, unknown>): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return [text(params.name), text(params.role), text(params.nickname), text(params.question)].filter(Boolean).join(" · ");
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function Tech({ items }: { items: [string, string][] }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Reply({ r }: { r: ReplyEntry }) {
  const o = OUTCOMES[r.outcome];
  const u = r.usage;
  const d = r.details;
  const triggered = r.reason ?? d?.triage?.reason ?? null;
  return (
    <li className="panel px-dim reply appear">
      <div className="row-wrap">
        <span className="stamp" style={{ color: o.color, transform: `rotate(${String(o.tilt)}deg)` }}>
          {o.label}
        </span>
        <span className="chip">{when(r.createdAt)}</span>
        <span className="chip">{r.isDm ? "message privé" : `#${r.channelName ?? "?"}`}</span>
        <span className="chip">à {r.authorName}</span>
        {r.link && (
          <a className="push-right small" href={r.link} target="_blank" rel="noreferrer noopener">
            Voir sur Discord ↗
          </a>
        )}
      </div>
      {r.content && (
        <Block label="Le message">
          <div className="quote">
            <span className="quote-head">
              {r.authorName} · {clock(r.createdAt, TIME_ZONE)}
            </span>
            <span>{r.content}</span>
          </div>
        </Block>
      )}
      {d?.sent && (
        <Block label="Ma réponse">
          <div className="discord-msg">
            <span className="discord-name">ARCHIVE-9</span>
            <span>{d.sent}</span>
          </div>
        </Block>
      )}
      {triggered && (
        <Block label="Ce qui m'a fait réagir">
          <p>{triggered}</p>
        </Block>
      )}
      {(d?.people?.length ?? 0) > 0 || (d?.skills?.length ?? 0) > 0 || (d?.context?.length ?? 0) > 0 ? (
        <Block label="Ce que j'avais en tête">
          <div className="stack-8">
            {d?.people?.map((p) => (
              <Link key={p.id} to={`/archives/${p.id}`} className="person-line px-dim">
                <strong>{p.name}</strong>
                {p.affinity !== null ? (
                  <>
                    <span className="chip aff">affinité {signed(p.affinity)}</span>
                    <span className="chip trust">confiance {p.trust ?? 50}</span>
                  </>
                ) : (
                  <span className="meta">pas encore de relation</span>
                )}
                {p.feeling && <span className="soft small grow">« {p.feeling} »</span>}
              </Link>
            ))}
            {(d?.skills?.length ?? 0) > 0 && (
              <div className="row-wrap">
                <span className="meta">skills</span>
                {d?.skills?.map((s) => (
                  <Link key={s} to="/skills" className="chip skill-chip">
                    {s} ↗
                  </Link>
                ))}
              </div>
            )}
            {d?.context
              ?.filter((c) => !c.startsWith("Skills appliquées") && !/: (affinité|aucune relation)/.test(c))
              .map((c, i) => (
                <span key={i} className="meta strong">
                  {c}
                </span>
              ))}
          </div>
        </Block>
      ) : null}
      <details className="more">
        <summary>Détails</summary>
        <div className="stack-16">
          <Block label="Mon raisonnement">
            <p className="reasoning">{d?.reasoning ?? "Mon modèle ne m'a pas donné son raisonnement cette fois."}</p>
          </Block>
          {d?.steps && d.steps.length > 0 && (
            <Block label="Ce que j'ai fait">
              <ol className="steps">
                {d.steps.map((s, i) => (
                  <li key={i}>
                    <b>{STEP_NAMES[s.tool] ?? s.tool}</b> {s.tool === "addReaction" ? <span className="emoji">{s.summary}</span> : s.tool.startsWith("send") ? "" : <span className="meta">· {s.summary}</span>}
                  </li>
                ))}
              </ol>
            </Block>
          )}
          {u && (
            <Block label="Technique">
              <Tech
                items={[
                  ["modèle", u.model ?? "?"],
                  ["fournisseur", u.provider ?? "?"],
                  ["tokens", `${tokens(u.inputTokens)} → ${tokens(u.outputTokens)}`],
                  ["raisonnement", `${tokens(u.reasoningTokens)} tokens`],
                  ["coût", u.costUsd > 0 ? usd(u.costUsd) : "gratuit"],
                  ["durée", ms(u.durationMs)],
                  ["appels", String(u.calls)],
                  ["noyau", u.version ?? "?"],
                  ["secours", u.fallbackReason ? `oui · ${u.fallbackReason}` : "non"],
                ]}
              />
            </Block>
          )}
        </div>
      </details>
    </li>
  );
}

function why(e: Extract<LearnedEntry, { kind: "fact" | "correction" }>): string {
  if (e.correction) return e.correction.reason || "Corrigé sans raison donnée.";
  const s = e.source;
  const said = s?.content ? ` : « ${s.content} »` : "";
  switch (e.nature) {
    case "fact":
      return `Dit par la personne elle-même${said}`;
    case "reported":
      return `${e.reporter ?? s?.author ?? "Quelqu'un"} le dit${said}`;
    case "probable_joke":
      return `Dit pour rire, d'après le ton${said}`;
    case "inference":
      return `Je le déduis de plusieurs messages${said}`;
  }
}

function how(e: Extract<LearnedEntry, { kind: "fact" | "correction" }>): string {
  if (e.correction) return `Corrigé par ${e.correction.by ?? e.name} sur ${e.correction.source === "site" ? "le site" : "Discord"}. Avant : « ${e.correction.before} ». Appliqué tout de suite.`;
  const s = e.source;
  if (!s) return `Analyse ${when(e.at)}.`;
  const where = s.channelName ? `#${s.channelName}` : "un message privé";
  return `Analyse ${when(e.at)}, d'après un message ${s.author ? `de ${s.author} ` : ""}dans ${where}${s.at ? ` (${when(s.at)})` : ""}.`;
}

function Learned({ e, onSource }: { e: LearnedEntry; onSource: (id: string) => void }) {
  if (e.kind === "drawer") {
    return (
      <li className="panel px-dim learned appear">
        <div className="learned-top">
          <span className="kind-badge" style={{ background: "var(--purple)" }}>
            NOUVEAU TIROIR
          </span>
          <time dateTime={e.at}>{when(e.at)}</time>
        </div>
        <div className="row-wrap">
          <span className="cat" style={{ background: e.category.color }}>
            {e.category.label}
          </span>
          <span className="meta">{e.count} fragments rangés</span>
        </div>
        <Block label="Pourquoi">
          <p>{e.reason ?? "Plusieurs fragments partageaient ce thème."}</p>
        </Block>
        <Block label="Comment">
          <p>Rangement de ma réflexion du soir. Le code a vérifié qu'il y avait assez de fragments et pas de doublon.</p>
        </Block>
      </li>
    );
  }
  if (e.kind === "removal") {
    return (
      <li className="panel px-dim learned appear">
        <div className="learned-top">
          <span className="kind-badge" style={{ background: "var(--red-soft)" }}>
            FRAGMENT RETIRÉ
          </span>
          <time dateTime={e.at}>{when(e.at)}</time>
        </div>
        <Link to={`/archives/${e.memberId}`} className="who-link">
          <Avatar id={e.memberId} name={e.name} hash={e.avatar} size={32} />
          <strong>{e.name}</strong>
        </Link>
        <p className="learned-text struck">{e.content}</p>
        <Block label="Pourquoi">
          <p>{e.reason}</p>
        </Block>
        <Block label="Comment">
          <p>
            Retiré par {e.by ?? e.name} sur {e.via === "site" ? "le site" : "Discord"}. Je ne l'apprendrai plus.
          </p>
        </Block>
      </li>
    );
  }
  const s = stamp(e.nature, e.reporter);
  return (
    <li className="panel px-dim learned appear">
      <div className="learned-top">
        <span className="kind-badge" style={{ background: e.kind === "correction" ? "var(--yellow)" : "var(--green)" }}>
          {e.kind === "correction" ? "FRAGMENT CORRIGÉ" : "NOUVEAU FRAGMENT"}
        </span>
        <time dateTime={e.at}>{when(e.at)}</time>
      </div>
      <div className="row-wrap">
        <Link to={`/archives/${e.memberId}`} className="who-link">
          <Avatar id={e.memberId} name={e.name} hash={e.avatar} size={32} />
          <strong>{e.name}</strong>
        </Link>
        <span className="cat" style={{ background: e.category.color }}>
          {e.category.label}
        </span>
        <span className="mini-stamp" style={{ color: s.text === "FAIT" ? "var(--green)" : "var(--muted)" }}>
          {s.text}
        </span>
        {!e.current && <span className="meta">remplacé depuis</span>}
      </div>
      <p className="learned-text">{e.content}</p>
      <Block label="Pourquoi">
        <p>{why(e)}</p>
      </Block>
      <Block label="Comment">
        <p>{how(e)}</p>
      </Block>
      <div className="row-wrap">
        <Link className="button-ghost small" to={`/archives/${e.memberId}`}>
          Voir le dossier
        </Link>
        {e.source?.messageId && (
          <button type="button" className="button-ghost small" onClick={() => { onSource(e.source?.messageId ?? ""); }}>
            Voir la source
          </button>
        )}
      </div>
    </li>
  );
}

function TriageSheet({ row, onClose }: { row: TriageView["rows"][number]; onClose: () => void }) {
  const t: TriageDetails | undefined = row.details?.triage;
  return (
    <Sheet title={`Décision du tri · ${when(row.createdAt)}`} onClose={onClose} wide>
      {!t ? (
        <Block label="Ce qui s'est passé">
          <p>
            Message de {row.authorName} {row.isDm ? "en privé" : `dans #${row.channelName ?? "?"}`}. Le code l'a écarté avant tout modèle : {IGNORED[row.reason ?? ""] ?? row.reason}.
          </p>
        </Block>
      ) : (
        <>
          <Block label="Ce que le tri a lu">
            <pre className="transcript">{t.transcript}</pre>
          </Block>
          <Block label="Sa réponse">
            <Tech
              items={[
                ["adressé à moi", t.addressed ? "oui" : "non"],
                ["intérêt", `${String(t.interest)}/10`],
                ["raison", t.reason],
                ["décision", row.outcome === "silent" ? "je me tais" : row.outcome === "ignored" ? "ignoré" : "je réponds"],
              ]}
            />
          </Block>
          <Block label="Son raisonnement">
            <p className="reasoning">{t.reasoning ?? "Ce modèle n'a pas donné son raisonnement."}</p>
          </Block>
          <Block label="Technique">
            <Tech
              items={[
                ["modèle", t.model ?? "?"],
                ["secours", t.fallbackReason ? `oui · ${t.fallbackReason}` : "non"],
                ["tokens", t.inputTokens !== null ? `${tokens(t.inputTokens)} → ${tokens(t.outputTokens ?? 0)}` : "?"],
                ["durée", ms(t.durationMs)],
              ]}
            />
          </Block>
        </>
      )}
    </Sheet>
  );
}

function ErrorSheet({ group, onClose }: { group: ErrorGroup; onClose: () => void }) {
  return (
    <Sheet title={`${TASKS[group.task] ?? group.task} · ${String(group.attempts.length)} échec${group.attempts.length > 1 ? "s" : ""}`} onClose={onClose} wide>
      <Block label="Tentatives">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Heure</th>
                <th>Modèle</th>
                <th>Fournisseur</th>
                <th>Durée</th>
                <th>Tokens</th>
                <th>Résultat</th>
              </tr>
            </thead>
            <tbody>
              {group.attempts.map((a, i) => (
                <tr key={i}>
                  <td>{when(a.createdAt)}</td>
                  <td>{a.servedModel ?? a.model}</td>
                  <td>{a.provider}</td>
                  <td>{ms(a.durationMs)}</td>
                  <td>
                    {tokens(a.inputTokens)} → {tokens(a.outputTokens)}
                  </td>
                  <td style={{ color: "var(--red-soft)" }}>{a.status === "rate_limited" ? "limite atteinte" : "erreur"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
      <Block label="Message d'erreur">
        <pre className="transcript">{group.attempts.map((a) => a.error ?? "(sans message)").filter((v, i, all) => all.indexOf(v) === i).join("\n")}</pre>
      </Block>
      <Block label="Ce qui a suivi">
        <p>
          {group.next
            ? `${when(group.next.createdAt)} : ${TASKS[group.next.task] ?? group.next.task} réussie avec ${group.next.servedModel ?? group.next.model}${group.next.detail ? ` (${group.next.detail})` : ""}.`
            : "Pas encore de réussite depuis."}
        </p>
      </Block>
    </Sheet>
  );
}

type Tab = "replies" | "learned" | "actions" | "triage" | "errors";

export function Journal() {
  const [tab, setTab] = useState<Tab>("replies");
  const [source, setSource] = useState<string | null>(null);
  const [triage, setTriage] = useState<TriageView["rows"][number] | null>(null);
  const [error, setError] = useState<ErrorGroup | null>(null);
  const [errorTask, setErrorTask] = useState<string>("all");
  const query = <T,>(name: Tab) => ({ queryKey: ["journal", name], queryFn: () => getJson<T>(`/api/journal/${name}`), enabled: tab === name, refetchInterval: 60_000 });
  const replies = useQuery(query<ReplyEntry[]>("replies"));
  const learned = useQuery(query<LearnedEntry[]>("learned"));
  const actions = useQuery(query<ActionEntry[]>("actions"));
  const triageData = useQuery(query<TriageView>("triage"));
  const errors = useQuery({ ...query<ErrorGroup[]>("errors"), enabled: true });
  const errorList = (errors.data ?? []).filter((g) => errorTask === "all" || g.task === errorTask);

  return (
    <main className="page">
      <h1 className="page-title">Tout ce que j'ai fait</h1>
      <Tabs
        label="Journal"
        value={tab}
        onChange={setTab}
        tabs={[
          ["replies", "Mes réponses"],
          ["learned", "Ce que j'ai appris"],
          ["actions", "Mes actions"],
          ["triage", "Tri"],
          ["errors", "Erreurs", errors.data?.length ?? 0],
        ]}
      />

      {tab === "replies" &&
        (replies.data?.length === 0 ? (
          <p className="empty">Aucune réponse enregistrée pour l'instant.</p>
        ) : (
          <ol className="plain stack-16">{replies.data?.map((r) => <Reply key={r.id} r={r} />)}</ol>
        ))}

      {tab === "learned" &&
        (learned.data?.length === 0 ? (
          <p className="empty">Rien appris ces derniers temps.</p>
        ) : (
          <ol className="plain stack-14">
            {learned.data?.map((e, i) => (
              <Learned key={i} e={e} onSource={setSource} />
            ))}
          </ol>
        ))}

      {tab === "actions" &&
        (actions.data?.length === 0 ? (
          <p className="empty">Je n'ai encore touché à rien.</p>
        ) : (
          <ul className="plain panel px-dim scroll-box tall">
            {actions.data?.map((a) => {
              const status = STATUS[a.status];
              return (
                <li key={a.id} className="row-line">
                  <time dateTime={a.createdAt}>{when(a.createdAt)}</time>
                  <span className="mini-stamp" style={{ color: status.color }}>
                    {status.label}
                  </span>
                  <span className="stack-4 grow">
                    <span>
                      {TOOLS[a.tool] ?? a.tool}
                      {detail(a.params) ? ` · ${detail(a.params)}` : ""}
                    </span>
                    <span className="meta">
                      {a.requestedBy ? `demandé par ${a.requestedBy}` : "de moi-même"}
                      {a.refusalReason ? ` · ${a.refusalReason}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ))}

      {tab === "triage" && triageData.data && (
        <>
          <div className="kpis">
            {(
              [
                ["Décisions 24 h", triageData.data.counts.total],
                ["Répondu", triageData.data.counts.replied],
                ["Resté silencieux", triageData.data.counts.silent],
                ["Ignoré sans tri", triageData.data.counts.ignored],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="stat px-dim">
                <span className="label small">{l}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
          {triageData.data.ignored.length > 0 && (
            <p className="meta strong">Ignoré sans tri : {triageData.data.ignored.map((g) => `${IGNORED[g.reason ?? ""] ?? g.reason ?? "?"} ${String(g.n)}`).join(" · ")}</p>
          )}
          <section className="panel px-dim">
            <div className="table-wrap scroll-box tall">
              <table className="data clickable">
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th>Salon</th>
                    <th>De</th>
                    <th>Décision</th>
                    <th>Intérêt</th>
                    <th>Modèle</th>
                    <th>Raison</th>
                  </tr>
                </thead>
                <tbody>
                  {triageData.data.rows.map((r) => {
                    const t = r.details?.triage;
                    return (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={() => {
                          setTriage(r);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setTriage(r);
                        }}
                      >
                        <td>{when(r.createdAt)}</td>
                        <td>{r.isDm ? "MP" : `#${r.channelName ?? "?"}`}</td>
                        <td>{r.authorName}</td>
                        <td>{r.outcome === "ignored" ? "ignoré" : r.outcome === "silent" ? "se tait" : "répond"}</td>
                        <td>{t ? `${String(t.interest)}/10` : "-"}</td>
                        <td style={t?.fallbackReason ? { color: "var(--yellow)" } : undefined}>{t ? `${t.fallbackReason ? "secours · " : ""}${t.model ?? "?"}` : "aucun"}</td>
                        <td className="wrap">{t?.reason ?? IGNORED[r.reason ?? ""] ?? r.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <p className="meta">Quand Groq est limité, le tri passe par le routeur gratuit d'OpenRouter, qui choisit lui-même un modèle : c'est le modèle réellement servi qui s'affiche, en jaune. Les mentions @ ne passent jamais par le tri.</p>
        </>
      )}

      {tab === "errors" && (
        <section className="panel px-dim">
          <div className="row-wrap">
            {["all", "analysis", "reply", "triage", "reflection"].map((k) => (
              <button key={k} type="button" className={`chip${errorTask === k ? " on" : ""}`} aria-pressed={errorTask === k} onClick={() => { setErrorTask(k); }}>
                {k === "all" ? "tout" : TASKS[k]}
              </button>
            ))}
            <span className="meta push-right">48 h · {errorList.length} groupes</span>
          </div>
          {errorList.length === 0 ? (
            <p className="empty">Aucune erreur. Pour une fois.</p>
          ) : (
            <ul className="plain scroll-box tall stack-10">
              {errorList.map((g, i) => (
                <li key={i} className="error-group">
                  <div className="row-wrap">
                    <time>{g.from === g.to ? when(g.from) : `${when(g.from)} → ${clock(g.to, TIME_ZONE)}`}</time>
                    <span className="chip">×{g.attempts.length}</span>
                    <span className="chip">{TASKS[g.task] ?? g.task}</span>
                    <span className="meta">{g.model}</span>
                    <span className="verdict push-right" style={{ background: g.next ? "var(--green)" : "var(--red-soft)" }}>
                      {g.next ? "RÉSOLUE" : "EN COURS"}
                    </span>
                  </div>
                  <Block label="Cause">
                    <p>{g.attempts[0]?.status === "rate_limited" ? "Limite de requêtes du fournisseur atteinte." : (g.attempts[0]?.error ?? "Sans message")}</p>
                  </Block>
                  <Block label="Ce qui a suivi">
                    <p>{g.next ? `Réussie ${when(g.next.createdAt)} avec ${g.next.servedModel ?? g.next.model}.` : "Pas encore de réussite depuis."}</p>
                  </Block>
                  <div>
                    <button type="button" className="button-ghost small" onClick={() => { setError(g); }}>
                      Voir le détail
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {source && (
        <SourceSheet
          messageId={source}
          title="La source"
          onClose={() => {
            setSource(null);
          }}
        />
      )}
      {triage && (
        <TriageSheet
          row={triage}
          onClose={() => {
            setTriage(null);
          }}
        />
      )}
      {error && (
        <ErrorSheet
          group={error}
          onClose={() => {
            setError(null);
          }}
        />
      )}
    </main>
  );
}
