import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { getJson, type DossierSummary } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Select } from "../components/Select.tsx";
import { ago, formatCount } from "../format.ts";
import { signed } from "../archive.ts";

type Sort = "changed" | "facts" | "messages" | "affinity" | "trust" | "newest" | "name";

const SORTS: [Sort, string][] = [
  ["changed", "modifié récemment"],
  ["facts", "plus de fragments"],
  ["messages", "plus actif"],
  ["affinity", "affinité"],
  ["trust", "confiance"],
  ["newest", "nouveaux dossiers"],
  ["name", "A → Z"],
];

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
const BY: Record<Sort, (a: DossierSummary, b: DossierSummary) => number> = {
  changed: (a, b) => time(b.changedAt) - time(a.changedAt),
  facts: (a, b) => b.facts - a.facts,
  messages: (a, b) => b.messages - a.messages,
  affinity: (a, b) => (b.affinity ?? -999) - (a.affinity ?? -999),
  trust: (a, b) => (b.trust ?? -1) - (a.trust ?? -1),
  newest: (a, b) => time(b.firstSeenAt) - time(a.firstSeenAt),
  name: (a, b) => a.name.localeCompare(b.name, "fr"),
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function Dossiers() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState<Sort>("changed");
  const [kind, setKind] = useState<"all" | "human" | "bot">("all");
  const { data } = useQuery({ queryKey: ["dossiers"], queryFn: () => getJson<DossierSummary[]>("/api/dossiers") });

  const list = useMemo(() => {
    const needle = fold(q.trim());
    return (data ?? [])
      .filter((d) => kind === "all" || (kind === "bot") === d.isBot)
      .filter((d) => !needle || [d.name, ...d.aliases, d.tagline ?? ""].some((n) => fold(n).includes(needle)))
      .sort(BY[sort]);
  }, [data, q, sort, kind]);

  return (
    <main className="page" style={{ gap: 24 }}>
      <div className="section-head">
        <h1 className="page-title">Les dossiers</h1>
        <span className="meta strong">{data ? `${formatCount(list.length)} dossier${list.length > 1 ? "s" : ""}` : "…"}</span>
      </div>
      <div className="toolbar">
        <label htmlFor="dossiers-q" className="sr-only">
          Chercher dans les dossiers
        </label>
        <input
          id="dossiers-q"
          type="search"
          className="search px-dim"
          placeholder="Nom, surnom, ancien pseudo…"
          value={q}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
          }}
        />
        <Select label="Trier" value={sort} options={SORTS} onChange={setSort} />
        <div className="chips" role="group" aria-label="Qui">
          {(
            [
              ["all", "tous"],
              ["human", "membres"],
              ["bot", "bots"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`chip${kind === k ? " on" : ""}`}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!data ? null : list.length === 0 ? (
        <p className="empty">Aucun dossier ne correspond à « {q} ».</p>
      ) : (
        <div className="dossier-list">
          <div className="dossier-row head" aria-hidden="true">
            <span />
            <span>dossier</span>
            <span>modifié</span>
            <span className="hide-s">fragments</span>
            <span className="hide-s">messages</span>
            <span>affinité · confiance</span>
          </div>
          {list.map((d, i) => (
            <Link key={d.id} to={`/dossiers/${d.id}`} className="dossier-row px-dim appear" style={{ animationDelay: `${String(Math.min(i, 12) * 0.03)}s` }}>
              <Avatar id={d.id} name={d.name} hash={d.avatar} />
              <span className="cell-main">
                <strong>
                  {d.name}
                  {d.isBot && (
                    <span className="badge" style={{ background: "var(--blue)", marginLeft: 8 }}>
                      BOT
                    </span>
                  )}
                </strong>
                <small>{d.tagline ?? "Dossier en cours de rédaction."}</small>
              </span>
              <span className="cell">{d.changedAt ? ago(d.changedAt) : "jamais"}</span>
              <span className="cell hide-s">{formatCount(d.facts)}</span>
              <span className="cell hide-s">{formatCount(d.messages)}</span>
              <span className="cell">
                {d.affinity === null ? (
                  <span className="meta">pas encore</span>
                ) : (
                  <>
                    <span style={{ color: "var(--red-soft)" }}>{signed(d.affinity)}</span> · <span style={{ color: "var(--blue)" }}>{d.trust ?? 25}</span>
                  </>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
