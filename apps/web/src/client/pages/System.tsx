import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { getJson, type MoodIcon, type Release, type SystemView } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { LineChart, StackedBars } from "../components/Charts.tsx";
import { MOOD_LABELS, SiteIcon, Sprite } from "../components/Sprite.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { ms, tokens, usd, when } from "../format.ts";

const REPO = "https://github.com/LeoBdt/ARCHIVE-9/commit/";
const TASKS: [string, string, string][] = [
  ["reply", "réponse", "var(--text)"],
  ["analysis", "analyse", "var(--green)"],
  ["reflection", "réflexion", "var(--purple)"],
  ["triage", "tri", "var(--blue)"],
];
const TASK_NAMES = Object.fromEntries(TASKS.map(([k, l]) => [k, l]));
type Range = 1 | 7 | 30;

function lastDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 24 * 60 * 60_000).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }));
  return days;
}

function Costs({ data }: { data: SystemView }) {
  const [range, setRange] = useState<Range>(30);
  const days = lastDays(range === 1 ? 2 : range);
  const rows = data.daily.filter((d) => days.includes(d.day));
  const sum = (pick: (r: SystemView["daily"][number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const month = data.daily.reduce((a, r) => a + r.costUsd, 0);
  const daysWithData = new Set(data.daily.map((d) => d.day)).size || 1;
  const budgetShare = Math.min(1, data.last24.replyCostUsd / Math.max(0.0001, data.replyBudgetUsd));
  const perDay = days.map((day) => ({ day, values: TASKS.map(([k]) => rows.find((r) => r.day === day && r.task === k)?.costUsd ?? 0) }));
  const tokenDays = days.map((day) => {
    const d = rows.filter((r) => r.day === day);
    return { day, input: Math.round(d.reduce((a, r) => a + r.inputTokens, 0) / 1000), output: Math.round(d.reduce((a, r) => a + r.outputTokens + r.reasoningTokens, 0) / 1000) };
  });
  const topTokens = Math.max(10, ...tokenDays.map((d) => Math.max(d.input, d.output)));
  const people = data.byPerson;
  const topPerson = Math.max(0.0001, ...people.map((p) => p.costUsd));

  return (
    <div className="stack-24">
      <div className="chips" role="group" aria-label="Période">
        {([1, 7, 30] as const).map((r) => (
          <button key={r} type="button" className={`chip${range === r ? " on" : ""}`} aria-pressed={range === r} onClick={() => { setRange(r); }}>
            {r === 1 ? "24 h" : `${String(r)} j`}
          </button>
        ))}
      </div>
      <div className="kpis">
        <div className="stat px-dim">
          <span className="label small">24 h</span>
          <b>{usd(data.last24.costUsd)}</b>
          <span>{data.last24.calls} appels</span>
        </div>
        <div className="stat px-dim">
          <span className="label small">{range === 1 ? "2 derniers jours" : `${String(range)} jours`}</span>
          <b>{usd(sum((r) => r.costUsd))}</b>
          <span>≈ {usd((month / daysWithData) * 30)} sur un mois</span>
        </div>
        <div className="stat px-dim">
          <span className="label small">Tokens</span>
          <b>{tokens(sum((r) => r.inputTokens + r.outputTokens))}</b>
          <span>
            entrée {tokens(sum((r) => r.inputTokens))} · sortie {tokens(sum((r) => r.outputTokens))} · raisonnement {tokens(sum((r) => r.reasoningTokens))}
          </span>
        </div>
        <div className="stat px-dim">
          <span className="label small">Budget des réponses</span>
          <b>
            {usd(data.last24.replyCostUsd)} / {usd(data.replyBudgetUsd)}
          </b>
          <span>24 h glissantes</span>
          <span className="gauge" aria-hidden="true">
            <i style={{ width: `${String(Math.round(budgetShare * 100))}%` }} />
          </span>
        </div>
        <div className="stat px-dim">
          <span className="label small">Erreurs 24 h</span>
          <b>{data.last24.calls ? `${((data.last24.errors / data.last24.calls) * 100).toFixed(1).replace(".", ",")} %` : "0 %"}</b>
          <span>
            {data.last24.errors} sur {data.last24.calls} · <Link to="/journal">le détail</Link>
          </span>
        </div>
        <div className="stat px-dim">
          <span className="label small">Temps de réponse</span>
          <b>{ms(data.speed.median)}</b>
          <span>médiane · 95 % sous {ms(data.speed.p95)}</span>
        </div>
      </div>

      <section className="panel px-dim">
        <div className="section-head">
          <h2>Dépense par jour</h2>
          <span className="legend">
            {TASKS.map(([k, l, c]) => (
              <span key={k}>
                <i style={{ background: c }} />
                {l}
              </span>
            ))}
          </span>
        </div>
        <StackedBars days={perDay} parts={TASKS.map(([, label, color]) => ({ label, color }))} format={usd} label="Dépense par jour et par tâche" />
      </section>

      <div className="grid two-cols">
        <section className="panel px-dim">
          <div className="section-head">
            <h2>Tokens par jour</h2>
            <span className="legend">
              <span>
                <i style={{ background: "var(--blue)" }} />
                entrée (k)
              </span>
              <span>
                <i style={{ background: "var(--red)" }} />
                sortie et raisonnement (k)
              </span>
            </span>
          </div>
          <LineChart
            points={tokenDays}
            series={[
              { key: "input", label: "entrée", color: "var(--blue)", format: (n) => `${String(n)} k` },
              { key: "output", label: "sortie", color: "var(--red)", format: (n) => `${String(n)} k` },
            ]}
            min={0}
            max={topTokens}
            ticks={[0, Math.round(topTokens / 2), topTokens]}
            height={150}
            label="Tokens par jour"
          />
        </section>
        <section className="panel px-dim">
          <h2>Qui me coûte le plus</h2>
          {people.length === 0 ? (
            <p className="empty">Personne encore.</p>
          ) : (
            <ul className="plain stack-8">
              {people.map((p) => (
                <li key={p.id} className="cost-row">
                  <Link to={`/archives/${p.id}`} className="who-link">
                    <Avatar id={p.id} name={p.name} hash={p.avatar} size={24} />
                    <span>{p.name}</span>
                  </Link>
                  <span className="cost-bar">
                    <i style={{ width: `${String((p.costUsd / topPerson) * 100)}%` }} />
                  </span>
                  <span className="num">{usd(p.costUsd)}</span>
                </li>
              ))}
            </ul>
          )}
          <span className="meta">mes réponses à leurs messages, 14 jours</span>
        </section>
      </div>

      <section className="panel px-dim">
        <h2>Par modèle · 30 jours</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tâche</th>
                <th>Modèle</th>
                <th>Appels</th>
                <th>Entrée</th>
                <th>Sortie</th>
                <th>Coût</th>
                <th>Médiane</th>
                <th>Erreurs</th>
                <th>Secours</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => (
                <tr key={`${m.task}-${m.model}`}>
                  <td>{TASK_NAMES[m.task] ?? m.task}</td>
                  <td className="wrap">
                    {m.model}
                    {m.served && m.served.length > 0 && <span className="meta"> · a servi : {m.served.slice(0, 4).join(", ")}</span>}
                  </td>
                  <td>{m.calls}</td>
                  <td>{tokens(m.inputTokens)}</td>
                  <td>{tokens(m.outputTokens)}</td>
                  <td>{m.costUsd > 0 ? usd(m.costUsd) : "gratuit"}</td>
                  <td>{ms(m.medianMs)}</td>
                  <td>{m.calls ? `${((m.errors / m.calls) * 100).toFixed(1).replace(".", ",")} %` : "-"}</td>
                  <td>{m.fallbacks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReleaseCard({ title, current, previous, icon, label }: { title: string; current: Release | undefined; previous: Release | undefined; icon: React.ReactNode; label: string }) {
  return (
    <section className="panel px-dim release">
      <div className="release-head">
        {icon}
        <div className="stack-4">
          <span className="label">{title}</span>
          <h2 className="release-label">{current ? label : "?"}</h2>
          {current && (
            <span className="meta">
              <a href={`${REPO}${current.sha}`} target="_blank" rel="noreferrer noopener">
                {current.sha.slice(0, 7)}
              </a>{" "}
              · {when(current.createdAt)}
            </span>
          )}
        </div>
      </div>
      {!current ? (
        <p className="empty">Le journal des versions commence à la prochaine mise à jour.</p>
      ) : (
        <>
          {current.comment && <p className="soft">{current.comment}</p>}
          <ul className="changes">
            {current.items.map((item, i) => (
              <li key={i}>
                {item.text}{" "}
                <a className="meta" href={`${REPO}${item.sha}`} target="_blank" rel="noreferrer noopener">
                  {item.sha}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {previous && (
        <div className="release-previous">
          <span className="label small">
            Avant : {previous.label} ·{" "}
            <a href={`${REPO}${previous.sha}`} target="_blank" rel="noreferrer noopener">
              {previous.sha.slice(0, 7)}
            </a>{" "}
            · {when(previous.createdAt)}
          </span>
          <ul className="changes small">
            {previous.items.slice(0, 6).map((item, i) => (
              <li key={i}>{item.text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const MOODS: MoodIcon[] = ["neutral", "amused", "curious", "tired", "annoyed", "glitch"];

export function System() {
  const [tab, setTab] = useState<"costs" | "versions">("costs");
  const { data } = useQuery({ queryKey: ["systeme"], queryFn: () => getJson<SystemView>("/api/systeme"), refetchInterval: 120_000 });
  if (!data) return <main className="page" aria-busy="true" />;
  const [core, corePrevious] = data.releases.core;
  const [site, sitePrevious] = data.releases.site;
  return (
    <main className="page">
      <h1 className="page-title">Système</h1>
      <Tabs
        label="Système"
        value={tab}
        onChange={setTab}
        tabs={[
          ["costs", "Coûts et tokens"],
          ["versions", "Versions"],
        ]}
      />
      {tab === "costs" ? (
        <Costs data={data} />
      ) : (
        <div className="stack-24">
          <div className="grid two-cols">
            <ReleaseCard title="Le noyau" label={core?.label ?? data.version?.label.split(" ")[0] ?? "?"} current={core} previous={corePrevious} icon={<Sprite cell={5} still={false} />} />
            <ReleaseCard title="Le site" label={site?.label ?? "?"} current={site} previous={sitePrevious} icon={<SiteIcon cell={5} />} />
          </div>
          <section className="panel px-dim">
            <h2>Mes têtes</h2>
            <div className="moods">
              {[...MOODS, "asleep" as const].map((m) => (
                <div key={m} className="mood-face">
                  {m === "asleep" ? <Sprite cell={5} asleep /> : <Sprite cell={5} mood={m} />}
                  <span className="meta">{MOOD_LABELS[m]}</span>
                </div>
              ))}
            </div>
            <p className="meta">Je choisis ma tête à chaque réflexion, d'après mon humeur. En pause, je dors.</p>
          </section>
        </div>
      )}
    </main>
  );
}
