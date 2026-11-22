import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { getJson, type Relations as RelationsData } from "../api.ts";
import { LEVELS, signed } from "../archive.ts";
import { Cabinet, CardList, Marks } from "../components/Cabinet.tsx";
import { avatarColor, initials } from "../format.ts";

type Person = RelationsData["people"][number];

function PersonCard({ p, index }: { p: Person; index: number }) {
  const trend = p.week === 0 ? "stable" : `${signed(p.week)} / 7 j`;
  const trendColor = p.week > 0 ? "#1c5c3e" : p.week < 0 ? "#8a2a33" : "#33333b";
  return (
    <Link to={`/archives/${p.id}`} className="index-card" style={{ gap: 10 }}>
      <span className="tab">N°{String(index + 1).padStart(3, "0")}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="avatar" style={{ width: 32, height: 32, background: avatarColor(p.id), fontSize: 12 }}>
          {initials(p.name)}
        </span>
        <span style={{ fontFamily: "var(--pixel)", fontSize: 14, flex: 1 }}>
          {p.name}
          {p.isBot ? " [bot]" : ""}
        </span>
        <span style={{ fontSize: 12, color: trendColor }}>{trend}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr) 36px", gap: "4px 8px", alignItems: "center", fontSize: 12, color: "#33333b" }}>
        <span>affinité</span>
        <Marks lit={Math.round((p.affinity + 100) / 10)} total={20} on={p.affinity < 0 ? "#8a2a33" : "#b0343f"} label={`affinité ${signed(p.affinity)}`} />
        <span style={{ color: "#1a1a20", textAlign: "right" }}>{signed(p.affinity)}</span>
        <span>confiance</span>
        <Marks lit={Math.round(p.trust / 5)} total={20} on="#1a1a20" label={`confiance ${String(p.trust)}`} />
        <span style={{ color: "#1a1a20", textAlign: "right" }}>{p.trust}</span>
      </div>
      {p.feeling && <p style={{ fontSize: 13, fontStyle: "italic", flex: "none" }}>« {p.feeling} »</p>}
    </Link>
  );
}

export function Relations() {
  const { data } = useQuery({ queryKey: ["relations"], queryFn: () => getJson<RelationsData>("/api/relations") });
  if (!data) return <main className="page" aria-busy="true" />;
  const people = data.people.filter((p) => !p.isBot).length;
  const drawers = LEVELS.map((level) => {
    const inside = data.people.filter((p) => level.test(p.affinity));
    return {
      key: level.key,
      label: level.label,
      sublabel: level.rule,
      color: level.color,
      count: inside.length,
      content: inside.length ? (
        <CardList items={inside} label={level.label} render={(p, i) => <PersonCard p={p} index={i} />} />
      ) : (
        <p className="empty">Personne dans ce tiroir.</p>
      ),
    };
  });

  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div className="label">
          Mes relations · {people} membres · {data.people.length - people} bots
        </div>
        <h1>Ce que je pense de vous.</h1>
        <p>L'affinité, c'est la façon dont vous me traitez. La confiance, c'est ce que je crois de ce que vous me dites. Les deux bougent lentement : une phrase ne suffit pas à me retourner.</p>
      </div>

      <section aria-labelledby="fichier" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-head">
          <h2 id="fichier" style={{ fontSize: 18 }}>
            Le fichier
          </h2>

        </div>
        <Cabinet drawers={drawers} />
      </section>

      <section aria-labelledby="mouvements" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="mouvements" style={{ fontSize: 18 }}>
          Ce qui a bougé cette semaine
        </h2>
        {data.moves.length === 0 ? (
          <p className="empty">Rien n'a bougé. Semaine calme.</p>
        ) : (
          <ul className="grid" style={{ listStyle: "none", margin: 0, padding: 0, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {data.moves.map((e, i) => (
              <li key={i} className="px-dim" style={{ background: "var(--panel)", padding: "12px 14px", display: "flex", gap: 12, alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--pixel)", fontSize: 13, width: 34, flex: "none", color: e.affinityDelta >= 0 ? "var(--green)" : "var(--red-soft)" }}>
                  {signed(e.affinityDelta)}
                </span>
                <span style={{ fontSize: 13, color: "var(--text-soft)" }}>
                  <b style={{ color: "var(--text)", fontWeight: 500 }}>{e.name}</b> · {e.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
