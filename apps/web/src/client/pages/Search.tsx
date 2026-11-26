import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { getJson, type SearchView } from "../api.ts";
import { stamp, signed } from "../archive.ts";
import { Avatar } from "../components/Avatar.tsx";
import { SourceSheet } from "../components/Source.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { when } from "../format.ts";

type Kind = "all" | "fragments" | "messages" | "dossiers" | "skills" | "journal" | "relations";

/** What each chip shows, and what it adds to the bar. */
const HINTS: [string, string][] = [
  ["@nom", "@"],
  ["#K7QX3M", "#"],
  ["F012", "F"],
  ["tiroir:jeux", "tiroir:"],
  ["nature:blague", "nature:"],
  ["type:messages", "type:"],
  ["après:20/11", "après:"],
  ['"phrase exacte"', '"'],
];

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Wraps the searched words in <mark>, accents and case ignored. */
export function highlight(text: string, words: string[]): ReactNode {
  const needles = words.map(fold).filter((w) => w.length > 1);
  if (needles.length === 0) return text;
  const folded = fold(text);
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = needles.map((n) => ({ n, at: folded.indexOf(n, i) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (!hit) break;
    if (hit.at > i) parts.push(text.slice(i, hit.at));
    parts.push(<mark key={hit.at}>{text.slice(hit.at, hit.at + hit.n.length)}</mark>);
    i = hit.at + hit.n.length;
  }
  parts.push(text.slice(i));
  return parts;
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="panel px-dim" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="meta strong">{count}</span>
      </div>
      <ul className="plain scroll-box tall">{children}</ul>
    </section>
  );
}

export function Search() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(text.trim());
  const [kind, setKind] = useState<Kind>("all");
  const [source, setSource] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // The bar in the header sends people here with ?q=.
  const fromUrl = params.get("q") ?? "";
  useEffect(() => {
    setText((current) => (current.trim() === fromUrl.trim() ? current : fromUrl));
  }, [fromUrl]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = text.trim();
      setQ(next);
      setParams(next ? { q: next } : {}, { replace: true });
    }, 180);
    return () => {
      clearTimeout(t);
    };
  }, [text, setParams]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => getJson<SearchView>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const results = q && data && !data.empty ? data : null;
  const words = results ? [...results.query.text.split(/\s+/), ...results.query.phrases] : [];
  const counts: Record<Exclude<Kind, "all">, number> = {
    fragments: results?.fragments.length ?? 0,
    messages: results?.messages.length ?? 0,
    dossiers: results?.dossiers.length ?? 0,
    skills: results?.skills.length ?? 0,
    journal: results?.journal.length ?? 0,
    relations: results?.relations.length ?? 0,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const show = (k: Exclude<Kind, "all">) => kind === "all" || kind === k;

  return (
    <main className="page" style={{ gap: 20 }}>
      <div className="section-head">
        <h1 className="page-title">Fouiller mes archives</h1>
        {results && (
          <span className="meta strong" aria-live="polite">
            {total} résultat{total > 1 ? "s" : ""} · {results.tookMs} ms
          </span>
        )}
      </div>
      <div className="toolbar">
        <label htmlFor="search-q" className="sr-only">
          Fouiller les archives
        </label>
        <input
          id="search-q"
          ref={input}
          type="search"
          className="search px-dim"
          autoFocus
          placeholder="Un mot, @quelqu'un, #K7QX3M…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </div>
      <div className="row-wrap" aria-label="Filtres possibles">
        {HINTS.map(([label, insert]) => (
          <button
            key={label}
            type="button"
            className="chip"
            onClick={() => {
              setText(`${text.trim()} ${insert}`.trimStart());
              input.current?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {results && total > 0 && (
        <Tabs
          label="Types de résultats"
          value={kind}
          onChange={setKind}
          tabs={[
            ["all", "Tout", total],
            ["fragments", "Fragments", counts.fragments],
            ["messages", "Messages", counts.messages],
            ["dossiers", "Dossiers", counts.dossiers],
            ["skills", "Skills", counts.skills],
            ["journal", "Réponses", counts.journal],
            ["relations", "Relations", counts.relations],
          ]}
        />
      )}

      {!q && <p className="empty">Tape quelque chose : je cherche partout à la fois.</p>}
      {q && !results && isFetching && <p className="empty">Je fouille…</p>}
      {results && total === 0 && <p className="empty">Rien dans mes archives pour ça.{results.people.length === 0 && q.includes("@") ? " Je ne connais personne de ce nom." : ""}</p>}

      {results && (
        <div className="stack-12" style={{ opacity: isFetching ? 0.6 : 1 }}>
          {show("fragments") && (
            <Group title="Fragments" count={counts.fragments}>
              {results.fragments.map((f) => {
                const s = stamp(f.nature, null);
                return (
                  <li key={f.id} className="search-hit appear">
                    <div className="row-wrap">
                      <Link to={`/dossiers/${f.memberId}`} className="who-link">
                        <Avatar id={f.memberId} name={f.memberName} hash={f.avatar} size={22} />
                        {f.memberName}
                      </Link>
                      <span className="chip">#{f.ref}</span>
                      <span className="meta">
                        F{String(f.rank).padStart(3, "0")} · {f.categoryLabel ?? f.category} · {s.text.toLowerCase()} · {when(f.createdAt)}
                      </span>
                    </div>
                    <p>{highlight(f.content, words)}</p>
                  </li>
                );
              })}
            </Group>
          )}
          {show("messages") && (
            <Group title="Messages" count={counts.messages}>
              {results.messages.map((m) => (
                <li key={m.id} className="search-hit">
                  <div className="row-wrap">
                    <Link to={`/dossiers/${m.authorId}`} className="who-link">
                      <Avatar id={m.authorId} name={m.authorName} hash={m.avatar} size={22} />
                      {m.authorName}
                    </Link>
                    <span className="meta">
                      {m.isDm ? "message privé" : `#${m.channelName ?? "salon"}`} · {when(m.createdAt)}
                    </span>
                    <button
                      type="button"
                      className="button-ghost small"
                      onClick={() => {
                        setSource(m.id);
                      }}
                    >
                      Voir le fil
                    </button>
                  </div>
                  <p>{highlight(m.content || "(sans texte)", words)}</p>
                  {m.images?.map((d, i) => (
                    <p key={i} className="meta">
                      image : {highlight(d, words)}
                    </p>
                  ))}
                </li>
              ))}
            </Group>
          )}
          {show("dossiers") && (
            <Group title="Dossiers" count={counts.dossiers}>
              {results.dossiers.map((d) => (
                <li key={d.id} className="search-hit">
                  <Link to={`/dossiers/${d.id}`} className="who-link">
                    <Avatar id={d.id} name={d.name} hash={d.avatar} size={28} />
                    {d.name}
                  </Link>
                  <span className="meta">
                    @{d.username} · {d.facts} fragments
                  </span>
                  {d.tagline && <p className="soft">{d.tagline}</p>}
                </li>
              ))}
            </Group>
          )}
          {show("skills") && (
            <Group title="Skills" count={counts.skills}>
              {results.skills.map((k) => (
                <li key={k.id} className="search-hit">
                  <div className="row-wrap">
                    <b>{k.name}</b>
                    <span className="meta">
                      {k.authorName ?? "un ancien membre"} · {when(k.createdAt)}
                    </span>
                  </div>
                  <p>{highlight(k.rule, words)}</p>
                </li>
              ))}
            </Group>
          )}
          {show("journal") && (
            <Group title="Mes réponses" count={counts.journal}>
              {results.journal.map((j) => (
                <li key={j.id} className="search-hit">
                  <span className="meta">
                    {j.authorName} · {j.channelName ? `#${j.channelName}` : "message privé"} · {when(j.createdAt)}
                  </span>
                  {j.content && <p className="soft">{highlight(j.content, words)}</p>}
                  {j.sent && <p>↪ {highlight(j.sent, words)}</p>}
                </li>
              ))}
            </Group>
          )}
          {show("relations") && (
            <Group title="Relations" count={counts.relations}>
              {results.relations.map((r, i) => (
                <li key={`${r.memberId}-${String(i)}`} className="search-hit">
                  <div className="row-wrap">
                    <Link to={`/dossiers/${r.memberId}`}>{r.memberName}</Link>
                    {r.affinityDelta !== 0 && <span className="chip aff">affinité {signed(r.affinityDelta)}</span>}
                    {r.trustDelta !== 0 && <span className="chip trust">confiance {signed(r.trustDelta)}</span>}
                    <span className="meta">{when(r.createdAt)}</span>
                  </div>
                  <p>{highlight(r.reason, words)}</p>
                </li>
              ))}
            </Group>
          )}
        </div>
      )}
      {source && (
        <SourceSheet
          messageId={source}
          title="Le message dans son fil"
          onClose={() => {
            setSource(null);
          }}
        />
      )}
    </main>
  );
}
