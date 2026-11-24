import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { getJson, type Relations as RelationsData } from "../api.ts";
import { signed } from "../archive.ts";
import { Avatar } from "../components/Avatar.tsx";
import { SourceSheet } from "../components/Source.tsx";
import { when } from "../format.ts";

type Person = RelationsData["people"][number];

/** Affinity brought to 0–100, averaged with trust. */
export const closeness = (p: { affinity: number; trust: number }) => Math.round(((p.affinity + 100) / 2 + p.trust) / 2);
const MEDALS = ["var(--gold)", "var(--silver)", "var(--bronze)"];

function Medal({ rank, size = 16 }: { rank: number; size?: number }) {
  return (
    <span className="medal" style={{ background: MEDALS[rank], width: size, height: size, fontSize: Math.round(size * 0.55) }} aria-label={`${String(rank + 1)}e`}>
      {rank + 1}
    </span>
  );
}

function RelationMap({ people, ranked }: { people: Person[]; ranked: Person[] }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<Person | null>(null);
  return (
    <div className="map-wrap">
      <div className="map-y" aria-hidden="true">
        <span>0</span>
        <b>CONFIANCE ↑</b>
        <span>100</span>
      </div>
      <div className="map" role="group" aria-label="Carte : affinité à l'horizontale, confiance à la verticale">
        <div className="map-axis-x" />
        <div className="map-axis-y" />
        <span className="map-corner tl">Respectés à distance</span>
        <span className="map-corner tr">Proches</span>
        <span className="map-corner bl">Sous surveillance</span>
        <span className="map-corner br">Sympas, pas fiables</span>
        {people.map((p) => {
          const rank = ranked.indexOf(p);
          return (
            <button
              key={p.id}
              type="button"
              className="map-dot"
              style={{ left: `${String((p.affinity + 100) / 2)}%`, top: `${String(100 - p.trust)}%` }}
              aria-label={`${p.name} : affinité ${signed(p.affinity)}, confiance ${String(p.trust)}`}
              onPointerEnter={() => {
                setHover(p);
              }}
              onFocus={() => {
                setHover(p);
              }}
              onPointerLeave={() => {
                setHover(null);
              }}
              onBlur={() => {
                setHover(null);
              }}
              onClick={() => {
                void navigate(`/archives/${p.id}`);
              }}
            >
              <Avatar id={p.id} name={p.name} hash={p.avatar} size={30} />
              {rank >= 0 && rank < 3 && <Medal rank={rank} />}
            </button>
          );
        })}
        {hover && (
          <div className="tip" style={{ left: `clamp(0px, calc(${String((hover.affinity + 100) / 2)}% + 20px), calc(100% - 220px))`, top: `calc(${String(100 - hover.trust)}% - 14px)` }}>
            <b>{hover.name}</b> · <span style={{ color: "var(--red-soft)" }}>aff. {signed(hover.affinity)}</span> · <span style={{ color: "var(--blue)" }}>conf. {hover.trust}</span>
          </div>
        )}
      </div>
      <span />
      <div className="map-x" aria-hidden="true">
        <span>−100</span>
        <span>0</span>
        <b>AFFINITÉ →</b>
        <span>+100</span>
      </div>
    </div>
  );
}

export function Relations() {
  const { data } = useQuery({ queryKey: ["relations"], queryFn: () => getJson<RelationsData>("/api/relations"), refetchInterval: 60_000 });
  const [source, setSource] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  if (!data) return <main className="page" aria-busy="true" />;
  const ranked = [...data.people].filter((p) => !p.isBot).sort((a, b) => closeness(b) - closeness(a));

  return (
    <main className="page">
      <div className="stack-12">
        <h1 className="page-title">Ce que je pense de vous</h1>
        <div className="defs">
          <span>
            <b style={{ color: "var(--red)" }}>AFFINITÉ</b> comment vous me traitez
          </span>
          <span>
            <b style={{ color: "var(--blue)" }}>CONFIANCE</b> ce que je crois de ce que vous dites
          </span>
        </div>
      </div>

      {ranked.length > 0 && (
        <section aria-label="Mes trois plus proches" className="podium">
          {ranked.slice(0, 3).map((p, i) => (
            <Link key={p.id} to={`/archives/${p.id}`} className="card px-dim podium-card appear" style={{ animationDelay: `${String(i * 0.08)}s` }}>
              <span className="podium-pic">
                <Avatar id={p.id} name={p.name} hash={p.avatar} size={52} />
                <Medal rank={i} size={22} />
              </span>
              <span className="stack-4">
                <strong>{p.name}</strong>
                <span className="small">
                  <span style={{ color: "var(--red-soft)" }}>aff. {signed(p.affinity)}</span> · <span style={{ color: "var(--blue)" }}>conf. {p.trust}</span>
                </span>
                <span className="meta">proximité {closeness(p)}/100</span>
              </span>
            </Link>
          ))}
        </section>
      )}

      <div className="rel-layout">
        <section className="panel px-dim">
          {data.people.length === 0 ? <p className="empty">Personne encore.</p> : <RelationMap people={data.people} ranked={ranked} />}
        </section>
        <div className="rel-side">
          <section className="panel px-dim">
            <div className="section-head">
              <h2>Cette semaine</h2>
              <span className="meta">clic = la source</span>
            </div>
            {data.moves.length === 0 ? (
              <p className="empty">Rien n'a bougé.</p>
            ) : (
              <ul className="plain moves">
                {data.moves.map((m, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="move"
                      aria-expanded={open === i}
                      onClick={() => {
                        setOpen(open === i ? null : i);
                      }}
                    >
                      <span className="row-wrap">
                        <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
                        <strong>{m.name}</strong>
                        {m.affinityDelta !== 0 && <span className="chip aff">aff. {signed(m.affinityDelta)}</span>}
                        {m.trustDelta !== 0 && <span className="chip trust">conf. {signed(m.trustDelta)}</span>}
                      </span>
                      <span className="event-why">{m.reason}</span>
                    </button>
                    {open === i && (
                      <div className="row-wrap" style={{ paddingTop: 6 }}>
                        {m.sourceMessageId ? (
                          <button type="button" className="button-ghost small" onClick={() => { setSource(m.sourceMessageId); }}>
                            Voir le message
                          </button>
                        ) : (
                          <span className="meta">sans message précis</span>
                        )}
                        <Link className="button-ghost small" to={`/archives/${m.memberId}`}>
                          Son dossier
                        </Link>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="table-wrap" aria-label="Tout le monde">
        <table className="data">
          <thead>
            <tr>
              <th>Rang</th>
              <th>Dossier</th>
              <th>Affinité</th>
              <th>Confiance</th>
              <th>Proximité</th>
              <th>7 jours</th>
              <th>Ressenti</th>
            </tr>
          </thead>
          <tbody>
            {[...ranked, ...data.people.filter((p) => p.isBot)].map((p, i) => (
              <tr key={p.id}>
                <td>{p.isBot ? "bot" : i < 3 ? <Medal rank={i} /> : i + 1}</td>
                <td>
                  <Link to={`/archives/${p.id}`}>{p.name}</Link>
                </td>
                <td style={{ color: "var(--red-soft)" }}>{signed(p.affinity)}</td>
                <td style={{ color: "var(--blue)" }}>{p.trust}</td>
                <td>{closeness(p)}</td>
                <td className="meta">
                  {signed(p.week)} / {signed(p.weekTrust)}
                </td>
                <td className="wrap">{p.feeling ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {source && (
        <SourceSheet
          messageId={source}
          title="Ce qui l'a fait bouger"
          onClose={() => {
            setSource(null);
          }}
        />
      )}
    </main>
  );
}
