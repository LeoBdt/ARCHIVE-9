import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { getJson, postJson, type AccessRow, type SettingsView, type Viewer } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Select } from "../components/Select.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { TechniqueTab } from "./Technique.tsx";

const LEVELS = [
  ["observateur", "Il ne parle que quand on lui parle."],
  ["discret", "Au plus 2 interventions spontanées par heure et par salon."],
  ["normal", "Au plus 5 par heure et par salon."],
  ["bavard", "Au plus 12 par heure et par salon."],
];

type Change = Partial<Omit<SettingsView, "channels">>;
const HOURS: [string, string][] = Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, "0")}:00`]);

function Confirm({ text, onYes, onClose }: { text: string; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet title={text} onClose={onClose}>
      <div className="row-wrap">
        <button
          type="button"
          className="button"
          onClick={() => {
            onYes();
            onClose();
          }}
        >
          Confirmer
        </button>
        <button type="button" className="button-ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Sheet>
  );
}

function SettingsTab() {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => getJson<SettingsView>("/api/settings") });
  const [ask, setAsk] = useState<{ text: string; change: Change } | null>(null);
  const [q, setQ] = useState("");
  const save = useMutation({
    mutationFn: (change: Change) => postJson("/api/settings", change),
    onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
  });
  if (!data) return <div aria-busy="true" />;
  const change = (text: string, value: Change) => {
    setAsk({ text, change: value });
  };
  const listened = new Set(data.listenedChannelIds);
  const needle = q.trim().toLowerCase();
  const groups = new Map<string, SettingsView["channels"]>();
  for (const c of data.channels) {
    if (needle && !c.name.toLowerCase().includes(needle)) continue;
    const key = c.category ?? "Sans catégorie";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const setGroup = (ids: string[], on: boolean) => ({ listenedChannelIds: on ? [...new Set([...data.listenedChannelIds, ...ids])] : data.listenedChannelIds.filter((id) => !ids.includes(id)) });

  return (
    <div className="grid settings-grid">
      <section className="panel px-dim">
        <h2>Pause</h2>
        <p className="soft">En pause, ARCHIVE-9 n'écrit plus rien, mais il écoute et archive toujours.</p>
        <button
          type="button"
          className="button"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            change(data.paused ? "Relancer ARCHIVE-9 ?" : "Mettre ARCHIVE-9 en pause ?", { paused: !data.paused });
          }}
        >
          {data.paused ? "Relancer ARCHIVE-9" : "Mettre ARCHIVE-9 en pause"}
        </button>
      </section>

      <section className="panel px-dim">
        <h2>Sa spontanéité dans AGENTS</h2>
        <div role="radiogroup" aria-label="Niveau" className="levels">
          {LEVELS.map(([name], n) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={data.spontaneity === n}
              className={data.spontaneity === n ? "on" : undefined}
              onClick={() => {
                change(`Passer la spontanéité à « ${name ?? ""} » ?`, { spontaneity: n });
              }}
            >
              <b>{n}</b>
              {name}
            </button>
          ))}
        </div>
        <p className="soft small">{LEVELS[data.spontaneity]?.[1]}</p>
      </section>

      <section className="panel px-dim">
        <h2>Ses réflexions</h2>
        <div className="row-wrap">
          <Select
            label="Midi"
            value={String(data.reflectionHours.midday)}
            options={HOURS.filter(([h]) => Number(h) < data.reflectionHours.evening)}
            onChange={(h) => {
              change(`Réflexion de midi à ${h.padStart(2, "0")}:00 ?`, { reflectionHours: { ...data.reflectionHours, midday: Number(h) } });
            }}
          />
          <Select
            label="Soir"
            value={String(data.reflectionHours.evening)}
            options={HOURS.filter(([h]) => Number(h) > data.reflectionHours.midday)}
            onChange={(h) => {
              change(`Réflexion du soir à ${h.padStart(2, "0")}:00 ?`, { reflectionHours: { ...data.reflectionHours, evening: Number(h) } });
            }}
          />
        </div>
        <p className="soft small">À midi, une pause courte (humeur, journal, une blague au plus). Le soir, la grande : opinions, résolutions, retours et rangement des tiroirs.</p>
      </section>

      <section className="panel px-dim">
        <h2>Signaler le mode secours</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={data.showFallbackTag}
            onChange={() => {
              change("Changer l'affichage du mode secours ?", { showFallbackTag: !data.showFallbackTag });
            }}
          />
          Ajouter « -# noyau-&lt;modèle&gt; » à ses messages quand un modèle de secours répond
        </label>
      </section>

      <section className="panel px-dim">
        <h2>Le rangement des dossiers</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={data.tidyDryRun}
            onChange={() => {
              change(data.tidyDryRun ? "Laisser ARCHIVE-9 fusionner et supprimer seul ?" : "Repasser en mode d'essai ?", { tidyDryRun: !data.tidyDryRun });
            }}
          />
          Mode d'essai : ses fusions et suppressions attendent l'accord d'un admin dans Technique
        </label>
      </section>

      <section className="panel px-dim span-all">
        <div className="section-head">
          <h2>Salons qu'il écoute</h2>
          <span className="meta strong">
            {listened.size} sur {data.channels.length}
          </span>
        </div>
        {data.channels.length === 0 ? (
          <p className="empty">La liste des salons arrive au prochain démarrage du bot.</p>
        ) : (
          <>
            <label htmlFor="channel-q" className="sr-only">
              Chercher un salon
            </label>
            <input
              id="channel-q"
              type="search"
              className="search px-dim"
              placeholder="Chercher un salon…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
            <div className="scroll-box channel-box">
              {[...groups].map(([category, list]) => {
                const all = list.every((c) => listened.has(c.id));
                return (
                  <details key={category} open className="channel-group">
                    <summary>
                      <span className="label">{category}</span>
                      <span className="meta"> · {list.filter((c) => listened.has(c.id)).length}/{list.length}</span>
                      <button
                        type="button"
                        className="link-button push-right"
                        onClick={(e) => {
                          e.preventDefault();
                          change(all ? `Ne plus écouter les ${String(list.length)} salons de ${category} ?` : `Écouter tous les salons de ${category} ?`, setGroup(list.map((c) => c.id), !all));
                        }}
                      >
                        {all ? "tout retirer" : "tout écouter"}
                      </button>
                    </summary>
                    {list.map((c) => {
                      const on = listened.has(c.id);
                      return (
                        <label key={c.id} className="check">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              change(on ? `Ne plus écouter #${c.name} ?` : `Écouter et archiver #${c.name} ?`, setGroup([c.id], !on));
                            }}
                          />
                          #{c.name}
                          {c.isPublic === false && <span className="meta"> · privé</span>}
                        </label>
                      );
                    })}
                  </details>
                );
              })}
            </div>
          </>
        )}
      </section>
      {ask && (
        <Confirm
          text={ask.text}
          onYes={() => {
            save.mutate(ask.change);
          }}
          onClose={() => {
            setAsk(null);
          }}
        />
      )}
    </div>
  );
}

function AccessTab() {
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState<AccessRow | null>(null);
  const { data } = useQuery({ queryKey: ["access"], queryFn: () => getJson<AccessRow[]>("/api/access") });
  const toggle = useMutation({
    mutationFn: (row: AccessRow) => postJson("/api/access", { memberId: row.id, admin: !row.isAdmin }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["access"] }),
  });
  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter((r) => !needle || [r.name, r.username, r.id].some((v) => v.toLowerCase().includes(needle))).sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || Number(b.isAdmin) - Number(a.isAdmin));
  return (
    <section aria-labelledby="acces" className="panel px-dim">
      <h2 id="acces">Qui peut régler ARCHIVE-9</h2>
      <label htmlFor="acces-q" className="sr-only">
        Chercher un membre
      </label>
      <input
        id="acces-q"
        type="search"
        className="search px-dim"
        placeholder="Chercher un membre…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
      />
      <ul className="plain scroll-box">
        {rows.map((r) => (
          <li key={r.id} className="access-row">
            <Avatar id={r.id} name={r.name} hash={r.avatar} size={32} />
            <span className="grow" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span>{r.name}</span>
              <span className="meta">
                @{r.username} · {r.id}
              </span>
            </span>
            {(r.isOwner || r.isAdmin) && <span className="label small" style={{ color: r.isOwner ? "var(--red)" : "var(--text)" }}>{r.isOwner ? "PROPRIÉTAIRE" : "ADMIN"}</span>}
            {!r.isOwner && (
              <button type="button" className="button-ghost small" onClick={() => { setAsk(r); }}>
                {r.isAdmin ? "Retirer" : "Nommer admin"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {ask && (
        <Confirm
          text={ask.isAdmin ? `Retirer les droits d'admin à ${ask.name} ?` : `Nommer ${ask.name} admin ?`}
          onYes={() => {
            toggle.mutate(ask);
          }}
          onClose={() => {
            setAsk(null);
          }}
        />
      )}
    </section>
  );
}

type AdminTab = "settings" | "technique" | "access";

/** The admin space: settings, what goes on under the hood, and who is admin (owner only). */
export function Settings({ viewer }: { viewer: Viewer }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: AdminTab = asked === "technique" || (asked === "access" && viewer.isOwner) ? asked : "settings";
  const setTab = (next: AdminTab) => {
    setParams(next === "settings" ? {} : { tab: next }, { replace: true });
  };
  if (!viewer.isAdmin)
    return (
      <main className="soon">
        <h1 style={{ fontSize: 28 }}>Réservé aux admins.</h1>
      </main>
    );
  return (
    <main className="page cascade">
      <h1 className="page-title">Admin</h1>
      <Tabs
        label="Admin"
        value={tab}
        onChange={setTab}
        tabs={[
          ["settings", "Réglages"],
          ["technique", "Technique"],
          ...(viewer.isOwner ? ([["access", "Accès"]] as [AdminTab, string][]) : []),
        ]}
      />
      {tab === "settings" ? <SettingsTab /> : tab === "technique" ? <TechniqueTab /> : <AccessTab />}
    </main>
  );
}
