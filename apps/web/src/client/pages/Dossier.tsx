import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { getJson, HttpError, type Dossier as DossierData } from "../api.ts";
import { CATEGORIES, CATEGORY_ORDER, reliability, signed, stamp } from "../archive.ts";
import { Cabinet, CardList, Marks } from "../components/Cabinet.tsx";
import { avatarColor, formatCount, initials } from "../format.ts";

type Fact = DossierData["facts"][number];

function FactCard({ fact, index }: { fact: Fact; index: number }) {
  const s = stamp(fact.nature, fact.reportedByName);
  const lit = reliability(fact.confidence);
  return (
    <article className="index-card">
      <span className="tab">F{String(index + 1).padStart(3, "0")}</span>
      <p>{fact.content}</p>
      <div className="card-foot">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="ink-label">fiabilité</span>
          <Marks lit={lit} label={`fiabilité ${String(lit)} sur 5`} />
        </div>
        <span className={s.dashed ? "stamp dashed" : "stamp"} style={{ color: s.ink, transform: `rotate(${String(s.tilt)}deg)` }}>
          {s.text}
        </span>
      </div>
      {fact.source && (
        <a href={fact.source} target="_blank" rel="noreferrer noopener">
          source ↗
        </a>
      )}
    </article>
  );
}

function Relation({ data }: { data: DossierData }) {
  const r = data.relationship;
  if (!r) return <p className="empty">Je ne lui ai jamais vraiment parlé.</p>;
  const max = Math.max(1, ...data.affinityHistory.map((v) => Math.abs(v)));
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>affinité</span>
          <span>{signed(r.affinity)}</span>
        </div>
        <div className="bars" aria-hidden="true">
          {Array.from({ length: 20 }, (_, i) => (
            <i key={i} style={i < Math.round((r.affinity + 100) / 10) ? { background: "var(--red)" } : undefined} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>confiance</span>
          <span>{r.trust}</span>
        </div>
        <div className="bars" aria-hidden="true">
          {Array.from({ length: 20 }, (_, i) => (
            <i key={i} style={i < Math.round(r.trust / 5) ? { background: "var(--text)" } : undefined} />
          ))}
        </div>
      </div>
      {r.feeling && (
        <div style={{ fontSize: 14, color: "var(--text-soft)" }}>
          Ressenti : <span style={{ color: "var(--text)" }}>{r.feeling}</span>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, color: "var(--faint)" }}>affinité sur 30 jours</div>
        <div className="history" role="img" aria-label={`Affinité sur 30 jours, de ${signed(data.affinityHistory[0] ?? 0)} à ${signed(r.affinity)}`}>
          {data.affinityHistory.map((v, i) => (
            <i key={i} style={{ height: `${String(Math.max(4, Math.round((Math.abs(v) / max) * 56)))}px` }} />
          ))}
        </div>
      </div>
    </>
  );
}

export function Dossier() {
  const { id = "" } = useParams();
  const { data, error } = useQuery({ queryKey: ["dossier", id], queryFn: () => getJson<DossierData>(`/api/dossiers/${id}`) });

  if (error instanceof HttpError && error.status === 404)
    return (
      <main className="soon">
        <h1 style={{ fontSize: 28 }}>Ce dossier n'existe pas.</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>Ou il a été effacé à la demande de son propriétaire.</p>
        <Link to="/archives">← Archives</Link>
      </main>
    );
  if (!data) return <main className="page" aria-busy="true" />;

  const byCategory = new Map<string, Fact[]>();
  for (const fact of data.facts) byCategory.set(fact.category, [...(byCategory.get(fact.category) ?? []), fact]);
  let ref = 0;
  const drawers = CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => {
    const facts = byCategory.get(c) ?? [];
    const first = ref;
    ref += facts.length;
    const meta = CATEGORIES[c] ?? { label: c.toUpperCase(), color: "#b9b9c3" };
    return {
      key: c,
      label: meta.label,
      color: meta.color,
      count: facts.length,
      content: <CardList items={facts} label={meta.label} render={(fact, i) => <FactCard fact={fact} index={first + i} />} />,
    };
  });

  return (
    <main className="page" style={{ gap: 32 }}>
      <Link to="/archives" style={{ fontSize: 13, textDecoration: "none" }}>
        ← Archives
      </Link>

      <section aria-label="Identité" className="px" style={{ background: "var(--panel)", padding: 32, display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
        <span className="avatar" aria-hidden="true" style={{ width: 96, height: 96, background: avatarColor(data.id), fontSize: 40 }}>
          {initials(data.name)}
        </span>
        <div style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="label">
            Dossier n°{data.id} · ouvert le {new Date(data.firstSeenAt).toLocaleDateString("fr-FR")}
            {data.isBot ? " · bot" : ""}
          </div>
          <h1 style={{ fontSize: 44, lineHeight: 1.05 }}>{data.name}</h1>
          {data.aliases.length > 0 && <div style={{ fontSize: 13, color: "var(--faint)" }}>aussi connu sous : {data.aliases.join(", ")}</div>}
          {data.tagline && (
            <div className="bubble px-red" style={{ marginTop: 8 }}>
              « {data.tagline} »
            </div>
          )}
        </div>
        <div style={{ flex: "0 1 260px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <div className="stat px-dim" style={{ padding: 14, background: "var(--panel-deep)" }}>
            <b style={{ fontSize: 24 }}>{formatCount(data.messages)}</b>
            <span>messages lus</span>
          </div>
          <div className="stat px-dim" style={{ padding: 14, background: "var(--panel-deep)" }}>
            <b style={{ fontSize: 24 }}>{formatCount(data.facts.length)}</b>
            <span>fiches</span>
          </div>
        </div>
      </section>

      <div className="row">
        <div style={{ flex: "999 1 600px", minWidth: 0, display: "flex", flexDirection: "column", gap: 28 }}>
          {data.summary && (
            <section aria-labelledby="resume" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 id="resume" style={{ fontSize: 18 }}>
                Ce que j'en retiens
              </h2>
              <p style={{ margin: 0, color: "var(--text-soft)", maxWidth: "70ch" }}>{data.summary}</p>
            </section>
          )}
          <section aria-labelledby="fiches" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="section-head">
              <h2 id="fiches" style={{ fontSize: 18 }}>
                Fiches
              </h2>
              <span style={{ fontSize: 12, color: "var(--faint)" }}>
                {data.facts.length} fiches dans {drawers.length} tiroirs
              </span>
            </div>
            {drawers.length === 0 ? <p className="empty">Rien d'archivé pour l'instant.</p> : <Cabinet drawers={drawers} />}
          </section>
        </div>

        <aside aria-label="Notre relation" style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <section className="panel px-dim">
            <h2>{data.isBot ? "Ce que je pense de ce bot" : "Ce que je pense de cette personne"}</h2>
            <Relation data={data} />
          </section>
          {data.events.length > 0 && (
            <section className="panel px-dim">
              <h2>Derniers événements</h2>
              {data.events.map((e, i) => (
                <div key={i} style={{ fontSize: 13, color: "var(--text-soft)" }}>
                  {signed(e.affinityDelta)} · {e.reason}
                </div>
              ))}
            </section>
          )}
          {data.isMine && (
            <section className="panel px-dim">
              <h2>C'est ton dossier</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
                Tu peux me demander sur Discord de corriger ou de retirer une fiche, ou disparaître avec <code>/oublie-moi</code>. Bientôt, directement ici.
              </p>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
