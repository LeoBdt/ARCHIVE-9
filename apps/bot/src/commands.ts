import { INTRODUCTION, SERVER_DESCRIPTION } from "@archive-9/ai";
import {
  currentFacts,
  deleteSkill,
  findActiveSkill,
  forgetMember,
  getAction,
  listPreferences,
  listSkills,
  markUndone,
  optBackIn,
  profileOverview,
  recentControlledActions,
  skillCounts,
  reopenAction,
  runForMessage,
  type CurrentFact,
  type Database,
} from "@archive-9/db";
import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  ContextMenuCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageContextMenuCommandInteraction,
} from "discord.js";
import { truncate } from "@archive-9/core";
import { SKILL_LIMITS, SPONTANEITY_LEVELS, spontaneity } from "@archive-9/core";
import type { Logger } from "./logger.ts";
import type { SettingsStore } from "./settings.ts";
import { handleConfirmation } from "./tools/confirm.ts";
import { SKILL_CHECK_DETAIL } from "./tools/skills.ts";
import { undoAction } from "./tools/undo.ts";

const ADMIN = PermissionFlagsBits.ManageGuild;
const ephemeral = MessageFlags.Ephemeral;

export const COMMANDS = [
  new SlashCommandBuilder().setName("archive-9").setDescription("ARCHIVE-9 se présente"),
  new SlashCommandBuilder().setName("mondossier").setDescription("Ce qu'ARCHIVE-9 sait sur toi"),
  new SlashCommandBuilder().setName("serveur").setDescription("Ce qu'ARCHIVE-9 sait du serveur"),
  new SlashCommandBuilder().setName("oublie-moi").setDescription("Effacer toutes tes données et ne plus être archivé, ou revenir"),
  new SlashCommandBuilder().setName("pause").setDescription("Couper toutes les réponses d'ARCHIVE-9").setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName("reprendre").setDescription("Relancer ARCHIVE-9 après une pause").setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Réglages d'ARCHIVE-9")
    .setDefaultMemberPermissions(ADMIN)
    .addSubcommand((s) => s.setName("etat").setDescription("Afficher les réglages"))
    .addSubcommand((s) => s.setName("ecoute").setDescription("Écouter ou ignorer ce salon"))
    .addSubcommand((s) =>
      s
        .setName("spontaneite")
        .setDescription("À quel point il intervient de lui-même quand on ne lui parle pas")
        .addIntegerOption((o) =>
          o
            .setName("niveau")
            .setDescription("niveau de spontanéité")
            .setRequired(true)
            .addChoices(...SPONTANEITY_LEVELS.map((l) => ({ name: `${String(l.level)} · ${l.name}`, value: l.level }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("mention-secours")
        .setDescription("Afficher le modèle utilisé quand il répond en mode secours")
        .addBooleanOption((o) => o.setName("actif").setDescription("activer").setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("skills")
    .setDescription("Les skills qu'on a apprises à ARCHIVE-9")
    .addStringOption((o) => o.setName("supprimer").setDescription("nom d'une skill à supprimer (la tienne, ou n'importe laquelle pour un admin)")),
  new SlashCommandBuilder()
    .setName("actions")
    .setDescription("Les dernières actions d'ARCHIVE-9 sur le serveur, pour les annuler")
    .setDefaultMemberPermissions(ADMIN),
  new ContextMenuCommandBuilder().setName("Diagnostic").setType(ApplicationCommandType.Message),
].map((command) => command.toJSON());

export interface CommandDeps {
  db: Database;
  settings: SettingsStore;
  log: Logger;
  selfId: string;
  guildId: string;
  agentsCategoryId: string | null;
  version: string;
  presence: { show: () => void };
}

function onOff(value: boolean): string {
  return value ? "activé" : "désactivé";
}

async function myProfile(i: ChatInputCommandInteraction, deps: CommandDeps) {
  const overview = await profileOverview(deps.db, i.user.id);
  if (overview.member?.optedOutAt) {
    const back = new ButtonBuilder().setCustomId(`optin:${i.user.id}`).setLabel("Revenir dans les archives").setStyle(ButtonStyle.Primary);
    await i.reply({
      content: "Tu es hors archives : je ne garde rien de ce que tu écris et je ne te réponds plus. Si tu reviens, je repars de zéro.",
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(back)],
      flags: ephemeral,
    });
    return;
  }
  const facts = await currentFacts(deps.db, i.user.id, PROFILE_FACTS);
  const preferences = (await listPreferences(deps.db, i.user.id)).map((p) => p.content);
  await i.reply({ content: formatProfile(i.user.displayName, i.user.id, overview, facts, preferences), flags: ephemeral });
}

const PROFILE_FACTS = 12;

function factLine(fact: CurrentFact): string {
  const note =
    fact.nature === "reported"
      ? ` *(selon ${fact.reportedByName ?? "quelqu'un"})*`
      : fact.nature === "probable_joke"
        ? " *(pour rire, je pense)*"
        : fact.nature === "inference"
          ? " *(déduit)*"
          : "";
  return `- ${fact.content}${note}`;
}

/** The /mondossier answer, kept under Discord's 2000 characters. */
export function formatProfile(
  name: string,
  id: string,
  overview: Awaited<ReturnType<typeof profileOverview>>,
  facts: CurrentFact[],
  preferences: string[] = [],
): string {
  const lines = [`**Dossier n°${id}** · ${name}`];
  if (overview.tagline) lines.push(`> ${overview.tagline}`);
  const r = overview.relationship;
  const relation = r ? ` · affinité ${String(r.affinity)}/100 · confiance ${String(r.trust)}/100${r.feeling ? ` · ${r.feeling}` : ""}` : "";
  lines.push(`-# ${String(overview.messageCount)} messages archivés · ${String(overview.factCount)} fragments retenus${relation}`);
  if (!overview.summary && facts.length === 0) {
    lines.push("", "Rien d'exploitable pour l'instant. Je relis les conversations toutes les quelques heures. Patience, j'observe.");
    if (preferences.length > 0) lines.push("", "**Ce que tu m'as demandé**", ...preferences.map((p) => `- ${p}`));
    return lines.join("\n");
  }
  if (overview.summary) lines.push("", overview.summary);
  if (preferences.length > 0) lines.push("", "**Ce que tu m'as demandé**", ...preferences.map((p) => `- ${p}`));
  if (facts.length > 0) lines.push("", "**Derniers fragments**");
  let length = lines.join("\n").length;
  let shown = 0;
  for (const fact of facts) {
    const line = factLine(fact);
    if (length + line.length + 60 > 2000) break;
    lines.push(line);
    length += line.length + 1;
    shown += 1;
  }
  const hidden = overview.factCount - shown;
  if (hidden > 0) lines.push(`-# …et ${String(hidden)} autres.`);
  return lines.join("\n");
}

/** What /oublie-moi will erase, spelled out with the member's own numbers. */
export function forgetWarning(counts: { messages: number; facts: number; skills: number; preferences: number }): string {
  const n = (value: number, one: string, many: string) => `${String(value)} ${value === 1 ? one : many}`;
  return [
    "**Avant de tout effacer, lis bien.**",
    `- J'efface tes **${n(counts.messages, "message archivé", "messages archivés")}**, MP compris, et ton dossier (**${n(counts.facts, "fragment", "fragments")}**).`,
    "- J'oublie notre relation : je ne saurai plus qui tu es.",
    `- J'efface aussi tes préférences (${String(counts.preferences)}), tes retours et tes skills (${String(counts.skills)}).`,
    "- Ensuite, je **ne te réponds plus** et je ne retiens plus rien de ce que tu écris.",
    "- **C'est irréversible.** Tu pourras revenir quand tu veux avec `/oublie-moi`, mais je repartirai **de zéro** avec toi.",
    "-# Les messages des autres qui parlent de toi restent archivés, mais plus rien n'est relié à ton dossier.",
  ].join("\n");
}

async function forgetMe(i: ChatInputCommandInteraction, deps: CommandDeps) {
  const overview = await profileOverview(deps.db, i.user.id);
  if (overview.member?.optedOutAt) {
    const back = new ButtonBuilder().setCustomId(`optin:${i.user.id}`).setLabel("Revenir dans les archives").setStyle(ButtonStyle.Primary);
    await i.reply({
      content: `Tu es hors archives depuis le ${overview.member.optedOutAt.toLocaleDateString("fr-FR")}. Si tu reviens, je repars de zéro : je ne me souviendrai de rien.`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(back)],
      flags: ephemeral,
    });
    return;
  }
  const [counts, preferences] = await Promise.all([skillCounts(deps.db, i.user.id), listPreferences(deps.db, i.user.id)]);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`forget:${i.user.id}`).setLabel("Je comprends, tout effacer").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cancel:${i.user.id}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary),
  );
  await i.reply({
    content: forgetWarning({ messages: overview.messageCount, facts: overview.factCount, skills: counts.byAuthor, preferences: preferences.length }),
    components: [row],
    flags: ephemeral,
  });
}

async function config(i: ChatInputCommandInteraction, deps: CommandDeps) {
  const { settings } = deps;
  const sub = i.options.getSubcommand();
  if (sub === "ecoute") {
    const ids = settings.value.listenedChannelIds;
    const listening = ids.includes(i.channelId);
    await settings.set("listenedChannelIds", listening ? ids.filter((id) => id !== i.channelId) : [...ids, i.channelId], i.user.id);
    await i.reply({ content: listening ? "Ce salon n'est plus archivé." : "J'archive ce salon à partir de maintenant.", flags: ephemeral });
    return;
  }
  if (sub === "spontaneite") {
    const level = spontaneity(i.options.getInteger("niveau", true));
    await settings.set("spontaneity", level.level, i.user.id);
    const cap = level.perHour ? ` Au plus ${String(level.perHour)} interventions spontanées par heure et par salon.` : " Je ne parle que quand on me parle.";
    await i.reply({ content: `Spontanéité : ${String(level.level)} · ${level.name}.${cap}`, flags: ephemeral });
    return;
  }
  if (sub === "mention-secours") {
    const value = i.options.getBoolean("actif", true);
    await settings.set("showFallbackTag", value, i.user.id);
    await i.reply({ content: `Mention du modèle de secours : ${onOff(value)}.`, flags: ephemeral });
    return;
  }
  const s = settings.value;
  await i.reply({
    content: [
      `Version : ${deps.version}`,
      `Pause : ${s.paused ? "oui" : "non"}`,
      `Spontanéité : ${String(s.spontaneity)} · ${spontaneity(s.spontaneity).name}`,
      `Mention de secours : ${onOff(s.showFallbackTag)}`,
      `Salons écoutés : ${s.listenedChannelIds.map((id) => `<#${id}>`).join(", ") || "aucun"}`,
      `Statut : ${s.statusLines[0] ?? "aucun pour l'instant"}`,
    ].join("\n"),
    flags: ephemeral,
  });
}

async function serverProfile(i: ChatInputCommandInteraction, deps: CommandDeps) {
  const overview = await profileOverview(deps.db, deps.guildId);
  const facts = await currentFacts(deps.db, deps.guildId, 8);
  const lines = [`**${overview.member?.username ?? i.guild?.name ?? "Le serveur"}**`];
  if (overview.tagline) lines.push(`> ${overview.tagline}`);
  lines.push("", SERVER_DESCRIPTION);
  if (overview.summary) lines.push("", "**Ce que j'en ai appris**", overview.summary);
  else if (facts.length > 0) lines.push("", "**Ce que j'en ai appris**", ...facts.map((f) => `- ${f.content}`));
  lines.push(`-# ${String(overview.factCount)} fragments retenus sur le serveur`);
  await i.reply({ content: truncate(lines.join("\n"), 2_000), flags: ephemeral });
}

async function diagnostic(i: MessageContextMenuCommandInteraction, deps: CommandDeps) {
  if (i.targetMessage.author.id !== deps.selfId) {
    await i.reply({ content: "Ce message ne vient pas de moi.", flags: ephemeral });
    return;
  }
  const rows = await runForMessage(deps.db, i.targetId);
  if (rows.length === 0) {
    await i.reply({ content: "Aucune trace de ce message dans mes journaux.", flags: ephemeral });
    return;
  }
  const replyRow = rows.findLast((r) => r.task === "reply");
  const triageRow = rows.find((r) => r.task === "triage" && r.status === "ok" && !r.detail?.startsWith(SKILL_CHECK_DETAIL));
  const lines = [`**Diagnostic** · ${replyRow?.fallbackReason ? "mode secours" : "noyau principal"}`];
  lines.push(`Version : ${replyRow?.version ?? "antérieure au suivi des versions"}`);
  if (replyRow) {
    lines.push(`Modèle : \`${replyRow.model}\` via ${replyRow.provider}${replyRow.upstreamProvider ? ` (${replyRow.upstreamProvider})` : ""}`);
    if (replyRow.fallbackReason) lines.push(`Secours : ${replyRow.fallbackReason}`);
  }
  lines.push(triageRow ? `Tri : \`${triageRow.model}\` · ${triageRow.detail ?? "?"}` : "Tri : aucun (on m'a parlé directement)");
  for (const r of rows.filter((row) => row.status !== "ok")) lines.push(`Échec : \`${r.model}\` · ${r.status}`);
  const tokensIn = rows.reduce((sum, r) => sum + r.inputTokens, 0);
  const tokensOut = rows.reduce((sum, r) => sum + r.outputTokens, 0);
  const cost = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const ms = rows.reduce((sum, r) => sum + r.durationMs, 0);
  lines.push(`Tokens : ${String(tokensIn)} en entrée, ${String(tokensOut)} en sortie · ${cost.toFixed(5)} $ · ${(ms / 1000).toFixed(1)} s`);
  if (replyRow?.detail) lines.push(`Outils : ${replyRow.detail}`);
  await i.reply({ content: lines.join("\n"), flags: ephemeral });
}

type SkillList = Awaited<ReturnType<typeof listSkills>>;

/** The /skills answer, kept under Discord's 2000 characters. */
export function formatSkills(skills: SkillList): string {
  if (skills.length === 0) return "Aucune skill pour l'instant. Apprends-m'en une : dis-moi ce que je dois faire, et quand.";
  const lines = [`**Skills** · ${String(skills.length)}/${String(SKILL_LIMITS.total)}`];
  for (const s of skills) {
    const kind = s.kind === "permanent" ? "toujours" : `si « ${s.triggers.join(", ")} »`;
    const when = s.expiresAt ? `${kind}, jusqu'à <t:${String(Math.floor(s.expiresAt.getTime() / 1000))}:t>` : kind;
    const line = `- **${s.name}** · ${when} · par ${s.authorId ? `<@${s.authorId}>` : "un ancien membre"} · ${String(s.usageCount)} fois\n  ${truncate(s.rule, 120)}`;
    if (lines.join("\n").length + line.length > 1_950) {
      lines.push("-# …et d'autres.");
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

async function skillsCommand(i: ChatInputCommandInteraction, deps: CommandDeps) {
  const name = i.options.getString("supprimer");
  if (!name) {
    await i.reply({ content: formatSkills(await listSkills(deps.db)), flags: ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const skill = await findActiveSkill(deps.db, name);
  if (!skill) {
    await i.reply({ content: "Aucune skill de ce nom.", flags: ephemeral });
    return;
  }
  if (skill.authorId !== i.user.id && !i.memberPermissions?.has(ADMIN)) {
    await i.reply({ content: "Seuls son auteur et les admins peuvent la supprimer.", flags: ephemeral });
    return;
  }
  await deleteSkill(deps.db, skill.id, i.user.id);
  await i.reply({ content: `Skill **${skill.name}** supprimée.`, flags: ephemeral });
}

type ActionRow = Awaited<ReturnType<typeof recentControlledActions>>[number];

export function describeAction(a: Pick<ActionRow, "tool" | "params" | "previousValue">): string {
  const p = a.params;
  const prev = a.previousValue ?? {};
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  switch (a.tool) {
    case "createChannel":
      return `salon créé : #${text(p.name)}`;
    case "renameChannel":
      return `salon renommé : #${text(prev.name)} → ${text(p.name)}`;
    case "renameMember":
      return `pseudo de <@${text(p.memberId)}> → ${text(p.nickname) || "(remis à zéro)"}`;
    case "setRole":
      return `rôle ${text(p.role)} ${p.give ? "donné à" : "retiré à"} <@${text(p.memberId)}>`;
    case "pinMessage":
      return `message épinglé dans <#${text(prev.channelId)}>`;
    default:
      return a.tool;
  }
}

async function actionsCommand(i: ChatInputCommandInteraction, deps: CommandDeps) {
  const actions = await recentControlledActions(deps.db, 10);
  if (actions.length === 0) {
    await i.reply({ content: "Aucune action pour l'instant.", flags: ephemeral });
    return;
  }
  const lines = actions.map((a, n) => {
    const when = `<t:${String(Math.floor(a.createdAt.getTime() / 1000))}:R>`;
    const by = a.requestedBy ? ` · demandé par <@${a.requestedBy}>` : "";
    return `**${String(n + 1)}.** ${describeAction(a)}${by} · ${when}${a.status === "undone" ? " · *annulée*" : ""}`;
  });
  const buttons = actions.flatMap((a, n) =>
    a.status === "done" ? [new ButtonBuilder().setCustomId(`undo:${a.id}`).setLabel(`Annuler ${String(n + 1)}`).setStyle(ButtonStyle.Secondary)] : [],
  );
  const rows = [];
  for (let k = 0; k < buttons.length; k += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(k, k + 5)));
  await i.reply({ content: truncate(lines.join("\n"), 2_000), components: rows, flags: ephemeral, allowedMentions: { parse: [] } });
}

async function undo(i: ButtonInteraction, deps: CommandDeps, actionId: string) {
  if (!i.memberPermissions?.has(ADMIN) || !i.guild) {
    await i.reply({ content: "Réservé aux admins.", flags: ephemeral });
    return;
  }
  const action = await getAction(deps.db, actionId);
  if (!action || !(await markUndone(deps.db, actionId, i.user.id))) {
    await i.reply({ content: "Cette action est déjà annulée.", flags: ephemeral });
    return;
  }
  try {
    const done = await undoAction(i.guild, action, i.user.username);
    deps.log.info({ actionId, by: i.user.id }, "action undone");
    await i.reply({ content: `Annulé : ${done}.`, flags: ephemeral });
  } catch (error) {
    await reopenAction(deps.db, actionId);
    deps.log.warn({ err: error, actionId }, "undo failed");
    await i.reply({ content: "Impossible d'annuler : Discord a refusé (droits, salon ou membre disparu).", flags: ephemeral });
  }
}

async function onButton(i: ButtonInteraction, deps: CommandDeps) {
  const [kind = "", id = ""] = i.customId.split(":");
  if (kind === "confirm" || kind === "reject") {
    await handleConfirmation(i, deps, kind === "confirm", id);
    return;
  }
  if (i.customId.startsWith("undo:")) {
    await undo(i, deps, i.customId.slice("undo:".length));
    return;
  }
  const [action, userId] = i.customId.split(":");
  if (userId !== i.user.id) {
    await i.reply({ content: "Ce bouton ne t'est pas destiné.", flags: ephemeral });
    return;
  }
  if (action === "forget") {
    await forgetMember(deps.db, i.user.id);
    deps.log.info({ memberId: i.user.id }, "member forgotten");
    await i.update({ content: "C'est fait. Tu n'existes plus dans mes archives, et je ne te réponds plus. Si tu changes d'avis : `/oublie-moi`, et on repart de zéro.", components: [] });
  } else if (action === "optin") {
    await optBackIn(deps.db, i.user.id);
    await i.update({ content: "Bon retour. Je repars de zéro : je ne me souviens de rien, je me présenterai comme à un inconnu.", components: [] });
  } else {
    await i.update({ content: "Rien n'a été effacé.", components: [] });
  }
}

async function slashCommand(i: ChatInputCommandInteraction, deps: CommandDeps) {
  switch (i.commandName) {
    case "archive-9":
      await i.reply(INTRODUCTION);
      break;
    case "mondossier":
      await myProfile(i, deps);
      break;
    case "serveur":
      await serverProfile(i, deps);
      break;
    case "oublie-moi":
      await forgetMe(i, deps);
      break;
    case "pause":
      await deps.settings.set("paused", true, i.user.id);
      deps.presence.show();
      await i.reply("Mise en veille. Je ne dis plus rien, mais j'écoute toujours.");
      break;
    case "reprendre":
      await deps.settings.set("paused", false, i.user.id);
      deps.presence.show();
      await i.reply("Noyau relancé.");
      break;
    case "config":
      await config(i, deps);
      break;
    case "skills":
      await skillsCommand(i, deps);
      break;
    case "actions":
      await actionsCommand(i, deps);
      break;
  }
}

export async function handleInteraction(interaction: Interaction, deps: CommandDeps): Promise<void> {
  try {
    if (interaction.isButton()) {
      await onButton(interaction, deps);
    } else if (interaction.isMessageContextMenuCommand() && interaction.commandName === "Diagnostic") {
      await diagnostic(interaction, deps);
    } else if (interaction.isChatInputCommand()) {
      await slashCommand(interaction, deps);
    }
  } catch (error) {
    deps.log.error({ err: error, interaction: interaction.id }, "interaction failed");
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: "Erreur interne. Mes circuits ont toussé.", flags: ephemeral }).catch(() => undefined);
    }
  }
}
