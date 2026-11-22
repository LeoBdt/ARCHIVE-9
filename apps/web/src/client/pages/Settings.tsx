import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getJson, postJson, type AccessRow, type SettingsView, type Viewer } from "../api.ts";
import { avatarColor, initials } from "../format.ts";

const LEVELS = [
  ["observateur", "Il ne parle que quand on lui parle."],
  ["discret", "Au plus 2 interventions spontanées par heure et par salon."],
  ["normal", "Au plus 5 par heure et par salon."],
  ["bavard", "Au plus 12 par heure et par salon."],
];

function confirmed(text: string): boolean {
  return window.confirm(text);
}

function SettingsTab() {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => getJson<SettingsView>("/api/settings") });
  const save = useMutation({
    mutationFn: (change: Partial<SettingsView>) => postJson("/api/settings", change),
    onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
  });
  if (!data) return <div aria-busy="true" />;
  const change = (text: string, value: Partial<SettingsView>) => {
    if (confirmed(text)) save.mutate(value);
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 24 }}>
      <section className="panel px-dim" style={{ background: "var(--panel)" }}>
        <h2>Pause</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>En pause, ARCHIVE-9 n'écrit plus rien, mais il écoute et archive toujours.</p>
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
      <section className="panel px-dim" style={{ background: "var(--panel)" }}>
        <h2>Sa spontanéité dans AGENTS</h2>
        <div role="radiogroup" aria-label="Niveau" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {LEVELS.map(([name], n) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={data.spontaneity === n}
              onClick={() => {
                change(`Passer la spontanéité à « ${name ?? ""} » ?`, { spontaneity: n });
              }}
              style={{ fontFamily: "var(--pixel)", fontSize: 11, background: data.spontaneity === n ? "var(--text)" : "#16161c", color: data.spontaneity === n ? "var(--bg)" : "var(--text)", border: 0, padding: "12px 6px", minHeight: 52, cursor: "pointer" }}
            >
              <span style={{ display: "block", fontSize: 16 }}>{n}</span>
              {name}
            </button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{LEVELS[data.spontaneity]?.[1]}</p>
      </section>
      <section className="panel px-dim" style={{ background: "var(--panel)" }}>
        <h2>Salons qu'ARCHIVE-9 écoute</h2>
        {data.channels.length === 0 && <p className="empty">La liste des salons arrive au prochain démarrage du bot.</p>}
        {data.channels.map((c) => {
          const on = data.listenedChannelIds.includes(c.id);
          return (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, minHeight: 36, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  change(on ? `Ne plus écouter #${c.name} ?` : `Écouter et archiver #${c.name} ?`, {
                    listenedChannelIds: on ? data.listenedChannelIds.filter((id) => id !== c.id) : [...data.listenedChannelIds, c.id],
                  });
                }}
                style={{ width: 18, height: 18, accentColor: "var(--red)" }}
              />
              <span>#{c.name}</span>
              {c.category && <span style={{ fontSize: 12, color: "var(--faint)" }}>{c.category}</span>}
            </label>
          );
        })}
      </section>
      <section className="panel px-dim" style={{ background: "var(--panel)" }}>
        <h2>Signaler le mode secours</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={data.showFallbackTag}
            onChange={() => {
              change("Changer l'affichage du mode secours ?", { showFallbackTag: !data.showFallbackTag });
            }}
            style={{ width: 18, height: 18, accentColor: "var(--red)" }}
          />
          Ajouter « -# noyau-&lt;modèle&gt; » à ses messages quand un modèle de secours répond
        </label>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Pour revenir à une ancienne version de lui, va sur la page Mémoire.</p>
      </section>
    </div>
  );
}

function AccessTab() {
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["access"], queryFn: () => getJson<AccessRow[]>("/api/access") });
  const toggle = useMutation({
    mutationFn: (row: AccessRow) => postJson("/api/access", { memberId: row.id, admin: !row.isAdmin }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["access"] }),
  });
  const rows = (data ?? []).filter((r) => r.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || Number(b.isAdmin) - Number(a.isAdmin));
  return (
    <section aria-labelledby="acces" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 id="acces" style={{ fontSize: 18 }}>
        Qui est admin
      </h2>
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
        style={{ maxWidth: 420 }}
      />
      <ul className="plain px-dim" style={{ background: "var(--panel)", gap: 0 }}>
        {rows.slice(0, 80).map((r) => (
          <li key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderBottom: "1px solid var(--line-soft)" }}>
            <span className="avatar" style={{ width: 32, height: 32, background: avatarColor(r.id), fontSize: 12 }}>
              {initials(r.name)}
            </span>
            <span style={{ flex: 1 }}>{r.name}</span>
            {(r.isOwner || r.isAdmin) && <span style={{ fontFamily: "var(--pixel)", fontSize: 11, color: r.isOwner ? "var(--red)" : "var(--text)" }}>{r.isOwner ? "PROPRIÉTAIRE" : "ADMIN"}</span>}
            {!r.isOwner && (
              <button
                type="button"
                className="button-ghost"
                style={r.isAdmin ? { color: "var(--red-soft)", borderColor: "var(--red-soft)" } : { color: "var(--text)", borderColor: "var(--text)" }}
                onClick={() => {
                  if (confirmed(r.isAdmin ? `Retirer les droits d'admin à ${r.name} ?` : `Nommer ${r.name} admin ?`)) toggle.mutate(r);
                }}
              >
                {r.isAdmin ? "Retirer" : "Nommer admin"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Settings({ viewer }: { viewer: Viewer }) {
  const [tab, setTab] = useState<"settings" | "access">("settings");
  if (!viewer.isAdmin)
    return (
      <main className="soon">
        <h1 style={{ fontSize: 28 }}>Réservé aux admins.</h1>
      </main>
    );
  const tabs: ["settings" | "access", string][] = viewer.isOwner
    ? [
        ["settings", "Réglages"],
        ["access", "Accès"],
      ]
    : [["settings", "Réglages"]];
  return (
    <main className="page" style={{ gap: 28 }}>
      <div className="page-head">
        <div className="label" style={{ color: "var(--red)" }}>
          Admin
        </div>
        <h1>Réglages d'ARCHIVE-9.</h1>
        <p>Chaque changement demande une confirmation et apparaît au journal.</p>
      </div>
      <div role="tablist" aria-label="Sections" style={{ display: "flex", flexWrap: "wrap", gap: 6, borderBottom: "2px solid var(--line)", paddingBottom: 12 }}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
            }}
            style={{ fontFamily: "var(--pixel)", fontSize: 13, background: tab === key ? "var(--red)" : "var(--panel)", color: tab === key ? "var(--bg)" : "var(--text)", border: 0, padding: "12px 16px", minHeight: 44, cursor: "pointer" }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "settings" ? <SettingsTab /> : <AccessTab />}
    </main>
  );
}
