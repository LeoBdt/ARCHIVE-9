import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { getJson, type Home as HomeData, type Viewer } from "../api.ts";
import { SearchBox } from "../components/Header.tsx";
import { Feed } from "../components/Feed.tsx";
import { Sprite } from "../components/Sprite.tsx";
import { affinitySegments, avatarColor, clock, formatCount, greeting, initials } from "../format.ts";

const TIME_ZONE = "Europe/Paris";

const SKILL_BADGES = {
  temporary: { label: "TEMPORAIRE", color: "var(--yellow)" },
  triggered: { label: "DÉCLENCHEUR", color: "var(--blue)" },
  permanent: { label: "PERMANENTE", color: "var(--text)" },
};

function Segments({ lit }: { lit: number }) {
  return (
    <div className="segments" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < lit ? "on" : undefined} />
      ))}
    </div>
  );
}

export function Home({ viewer }: { viewer: Viewer }) {
  // Polled for now; the live stream comes with phase 6c.
  const { data, error } = useQuery({ queryKey: ["home"], queryFn: () => getJson<HomeData>("/api/home"), refetchInterval: 30_000 });

  if (error) return <main className="page"><p className="error">Le noyau ne répond pas. Réessaie dans un instant.</p></main>;
  if (!data) return <main className="page" aria-busy="true" />;

  const feed = data.version
    ? [...data.feed, { at: data.version.startedAt, kind: "system" as const, text: `Je renais sous le nom ${data.version.label.split(" ")[0] ?? ""}.` }]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 12)
    : data.feed;
  const version = data.version
    ? `VERSION ${data.version.label.toUpperCase()} · EN LIGNE DEPUIS ${clock(data.version.startedAt, TIME_ZONE)}`
    : "VERSION INCONNUE";

  return (
    <main className="page">
      <SearchBox className="mobile-search" id="search-mobile" />

      <section aria-label="État d'ARCHIVE-9" className="row">
        <div className="hero px">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <Sprite asleep={data.paused} />
            <div className="state" style={{ color: data.paused ? "var(--faint)" : "var(--green)" }}>
              <i style={{ background: data.paused ? "var(--faint)" : "var(--green)" }} />
              {data.paused ? "EN VEILLE" : "EN LIGNE"}
            </div>
          </div>
          <div className="hero-text">
            <div className="label">{version}</div>
            <h1>
              Connexion au noyau établie.
              <br />
              <span>
                {greeting(new Date(), TIME_ZONE)}, {viewer.name}.
              </span>
            </h1>
            {data.status && (
              <div className="bubble px-red">
                « {data.status} »<span className="cursor" style={{ color: "var(--red)" }}> ▌</span>
              </div>
            )}
            {data.paused && <div className="bubble px-red">En veille. J'écoute quand même.</div>}
            {data.mood && (
              <div style={{ fontSize: 14, color: "var(--muted)" }}>
                Humeur du jour : <span style={{ color: "var(--text)" }}>{data.mood}</span>
              </div>
            )}
          </div>
        </div>

        <div className="stats">
          <div className="stat px-dim">
            <b>{formatCount(data.counts.messages)}</b>
            <span>messages que j'ai lus. Tous.</span>
          </div>
          <div className="stat px-dim">
            <b>{formatCount(data.counts.facts)}</b>
            <span>fragments retenus sur vous.</span>
          </div>
          <div className="stat px-dim">
            <b>{formatCount(data.counts.dossiers)}</b>
            <span>dossiers ouverts.</span>
          </div>
          <div className="stat optional px-dim">
            <b>{formatCount(data.counts.skills)}</b>
            <span>skills qu'on m'a apprises.</span>
          </div>
        </div>
      </section>

      <div className="row">
        <section aria-labelledby="dossiers" style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="section-head">
            <h2 id="dossiers">Les dossiers que je consulte le plus</h2>
            <Link to="/archives" style={{ fontSize: 14 }}>
              Toutes les archives →
            </Link>
          </div>
          {data.closest.length === 0 ? (
            <p className="empty">Aucun dossier pour l'instant. Parlez-moi.</p>
          ) : (
            <div className="grid">
              {data.closest.map((m) => (
                <Link key={m.id} to={`/archives/${m.id}`} className="card px-dim">
                  <div className="who">
                    <span className="avatar" style={{ width: 40, height: 40, background: avatarColor(m.id), fontSize: 16 }}>
                      {initials(m.name)}
                    </span>
                    <div>
                      <strong>{m.name}</strong>
                      <small>
                        {m.isBot ? `bot · ${formatCount(m.messages)} messages` : `${formatCount(m.messages)} messages · ${formatCount(m.facts)} fragments`}
                      </small>
                    </div>
                  </div>
                  <div className="tagline">{m.tagline ? `« ${m.tagline} »` : "Dossier en cours de rédaction."}</div>
                  <div className="bar">
                    <span>affinité</span>
                    <Segments lit={affinitySegments(m.affinity)} />
                    <span className="sr-only">{`${String(m.affinity)} sur 100`}</span>
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
          <p className="empty">Personne ne m'a encore rien appris. Demande-moi, en me mentionnant.</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {data.skills.map((k) => {
              const badge = SKILL_BADGES[k.expiresAt ? "temporary" : k.kind];
              return (
                <div key={k.name} className="card px-dim" style={{ gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontFamily: "var(--pixel)", fontSize: 14 }}>{k.name}</span>
                    <span className="badge" style={{ background: badge.color }}>
                      {badge.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{k.rule}</div>
                  <div style={{ fontSize: 12, color: "var(--faint)" }}>
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
