import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { getJson, type Home as HomeData, type Viewer } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Feed } from "../components/Feed.tsx";
import { SearchBox } from "../components/Header.tsx";
import { Sprite } from "../components/Sprite.tsx";
import { affinitySegments, clock, formatCount, greeting, TIME_ZONE, when } from "../format.ts";

export const SKILL_BADGES = {
  temporary: { label: "TEMPORAIRE", color: "var(--yellow)" },
  triggered: { label: "MOTS", color: "var(--purple)" },
  permanent: { label: "TOUJOURS", color: "var(--blue)" },
};

export function Segments({ lit, kind = "aff" }: { lit: number; kind?: "aff" | "trust" }) {
  return (
    <div className={`segments ${kind}`} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < lit ? "on" : undefined} />
      ))}
    </div>
  );
}

const SOURCE_NAMES = { midday: "réflexion de midi", reflection: "réflexion du soir", rollback: "retour en arrière", initial: "première prise de conscience" };

export function Home({ viewer }: { viewer: Viewer }) {
  const { data, error } = useQuery({ queryKey: ["home"], queryFn: () => getJson<HomeData>("/api/home"), refetchInterval: 60_000 });

  if (error) return <main className="page"><p className="error">Le noyau ne répond pas. Réessaie dans un instant.</p></main>;
  if (!data) return <main className="page" aria-busy="true" />;

  const [name = "", sha = ""] = (data.version?.label ?? "").split(" ");
  const feed = data.version
    ? [...data.feed, { at: data.version.startedAt, kind: "system" as const, text: `Je renais sous le nom ${name}.` }].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7)
    : data.feed.slice(0, 7);

  return (
    <main className="page">
      <SearchBox className="mobile-search" id="search-mobile" />

      <section aria-label="État d'ARCHIVE-9" className="home-state">
        <div className="hero px">
          <div className="hero-sprite">
            <Sprite asleep={data.paused} mood={data.icon} />
            <div className="state" style={{ color: data.paused ? "var(--faint)" : "var(--green)" }}>
              <i style={{ background: data.paused ? "var(--faint)" : "var(--green)" }} />
              {data.paused ? "EN VEILLE" : "EN LIGNE"}
            </div>
          </div>
          <div className="hero-text">
            <div className="label strong">
              {data.version ? (
                <>
                  Version {name} <span className="mono-faint">{sha}</span> · en ligne depuis {when(data.version.startedAt)}
                </>
              ) : (
                "Version inconnue"
              )}
            </div>
            <h1 className="type-in">
              Je vous archive.
              <br />
              <span>
                {greeting(new Date(), TIME_ZONE)}, {viewer.name}.
              </span>
            </h1>
            {data.paused && <div className="bubble px-red">En veille. J'écoute quand même.</div>}
            {data.status && (
              <div className="stack-6">
                <div className="label small">
                  Mon statut Discord{data.statusAt && <span className="label-data"> · écrit {when(data.statusAt)}</span>}
                </div>
                <div className="bubble px-red">
                  « {data.status} »<span className="cursor" style={{ color: "var(--red)" }}> ▌</span>
                </div>
              </div>
            )}
            {data.mood && (
              <div className="mood">
                Humeur du moment : <span>{data.mood}</span>
                {data.moodAt && data.moodSource && (
                  <span className="meta">
                    {" "}
                    · {SOURCE_NAMES[data.moodSource]}, {when(data.moodAt)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="stats">
          <div className="stat px-dim">
            <b>{formatCount(data.counts.messages)}</b>
            <span>messages lus</span>
          </div>
          <div className="stat px-dim">
            <b>{formatCount(data.counts.facts)}</b>
            <span>fragments retenus</span>
          </div>
          <div className="stat px-dim">
            <b>{formatCount(data.counts.dossiers)}</b>
            <span>dossiers ouverts</span>
          </div>
          <div className="stat optional px-dim">
            <b>{formatCount(data.counts.skills)}</b>
            <span>skills apprises</span>
          </div>
        </div>
      </section>

      <div className="home-row">
        <section aria-labelledby="dossiers" className="home-dossiers">
          <div className="section-head">
            <h2 id="dossiers">Les dossiers que je consulte le plus</h2>
            <Link to="/dossiers" style={{ fontSize: 14 }}>
              Tous les dossiers →
            </Link>
          </div>
          {data.closest.length === 0 ? (
            <p className="empty">Aucun dossier pour l'instant. Parlez-moi.</p>
          ) : (
            <div className="grid three">
              {data.closest.map((m) => (
                <Link key={m.id} to={`/dossiers/${m.id}`} className="card px-dim">
                  <div className="who">
                    <Avatar id={m.id} name={m.name} hash={m.avatar} />
                    <div>
                      <strong>{m.name}</strong>
                      <small>{m.isBot ? `bot · ${formatCount(m.messages)} messages` : `${formatCount(m.messages)} messages · ${formatCount(m.facts)} fragments`}</small>
                    </div>
                  </div>
                  <div className="tagline">{m.tagline ? `« ${m.tagline} »` : "Dossier en cours de rédaction."}</div>
                  <div className="bar">
                    <span>affinité</span>
                    <Segments lit={affinitySegments(m.affinity)} />
                    <span className="sr-only">{`affinité ${String(m.affinity)}, de −50 à 50`}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <Feed items={feed} timeZone={TIME_ZONE} />
      </div>

      <section aria-labelledby="skills" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="section-head">
          <h2 id="skills">Ce qu'on m'a appris</h2>
          <Link to="/skills" style={{ fontSize: 14 }}>
            Toutes les skills →
          </Link>
        </div>
        {data.skills.length === 0 ? (
          <p className="empty">Personne ne m'a encore rien appris. Demande-moi, en me mentionnant, ou sur la page Skills.</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" }}>
            {data.skills.map((k) => {
              const badge = SKILL_BADGES[k.expiresAt ? "temporary" : k.kind];
              return (
                <div key={k.name} className="card px-dim" style={{ gap: 10 }}>
                  <div className="skill-head">
                    <span className="skill-name">{k.name}</span>
                    <span className="badge" style={{ background: badge.color }}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="skill-rule">{k.rule}</div>
                  <div className="meta">
                    par {k.author ?? "un ancien membre"} · servie {formatCount(k.uses)} fois
                    {k.expiresAt ? ` · jusqu'à ${clock(k.expiresAt, TIME_ZONE)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
