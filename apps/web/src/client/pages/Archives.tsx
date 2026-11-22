import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { getJson, type DossierSummary } from "../api.ts";
import { affinitySegments, avatarColor, formatCount, initials } from "../format.ts";

export function Archives() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data } = useQuery({ queryKey: ["dossiers", q], queryFn: () => getJson<DossierSummary[]>(`/api/dossiers?q=${encodeURIComponent(q)}`) });

  return (
    <main className="page" style={{ gap: 28 }}>
      <div className="page-head">
        <div className="label">Archives · {data ? formatCount(data.length) : "…"} dossiers</div>
        <h1>Tous les dossiers.</h1>
        <p>Chacun de vous a le sien. Les plus épais d'abord.</p>
      </div>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          setParams(typeof value === "string" && value.trim() ? { q: value.trim() } : {});
        }}
      >
        <label htmlFor="archives-q" className="sr-only">
          Chercher un dossier
        </label>
        <input id="archives-q" name="q" type="search" defaultValue={q} key={q} className="search px-dim" placeholder="Un nom, un ancien pseudo…" style={{ width: "100%", maxWidth: 420 }} />
      </form>
      {data?.length === 0 && <p className="empty">Aucun dossier à ce nom. Peut-être qu'il ne m'a jamais parlé.</p>}
      <div className="grid">
        {data?.map((m) => (
          <Link key={m.id} to={`/archives/${m.id}`} className="card px-dim">
            <div className="who">
              <span className="avatar" style={{ width: 40, height: 40, background: avatarColor(m.id), fontSize: 16 }}>
                {initials(m.name)}
              </span>
              <div>
                <strong>{m.name}</strong>
                <small>
                  {m.isBot ? "bot · " : ""}
                  {formatCount(m.messages)} messages · {formatCount(m.facts)} fiches
                </small>
              </div>
            </div>
            <div className="tagline">{m.tagline ? `« ${m.tagline} »` : "Dossier en cours de rédaction."}</div>
            {m.affinity !== null && (
              <div className="bar">
                <span>affinité</span>
                <div className="segments" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, i) => (
                    <i key={i} className={i < affinitySegments(m.affinity ?? 0) ? "on" : undefined} />
                  ))}
                </div>
              </div>
            )}
          </Link>
        ))}
      </div>
    </main>
  );
}
