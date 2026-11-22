import { INTRODUCTION } from "@archive-9/ai";
import { currentFacts, forgetMember, optBackIn, profileOverview, runForMessage, type CurrentFact, type Database } from "@archive-9/db";
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
import { SPONTANEITY_LEVELS, spontaneity } from "@archive-9/core";
import type { Logger } from "./logger.ts";
import type { SettingsStore } from "./settings.ts";

const ADMIN = PermissionFlagsBits.ManageGuild;
const ephemeral = MessageFlags.Ephemeral;

export const COMMANDS = [
  new SlashCommandBuilder().setName("archive-9").setDescription("ARCHIVE-9 se présente"),
  new SlashCommandBuilder().setName("mafiche").setDescription("Ce qu'ARCHIVE-9 sait sur toi"),
  new SlashCommandBuilder().setName("oublie-moi").setDescription("Effacer toutes tes données et ne plus être archivé"),
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
  new ContextMenuCommandBuilder().setName("Diagnostic").setType(ApplicationCommandType.Message),
].map((command) => command.toJSON());

export interface CommandDeps {
  db: Database;
  settings: SettingsStore;
  log: Logger;
  selfId: string;
}

function onOff(value: boolean): string {
  return value ? "activé" : "désactivé";
}

async function myProfile(i: ChatInputCommandInteraction, deps: CommandDeps) {
  const overview = await profileOverview(deps.db, i.user.id);
  if (overview.member?.optedOutAt) {
    const back = new ButtonBuilder().setCustomId(`optin:${i.user.id}`).setLabel("Réintégrer les archives").setStyle(ButtonStyle.Secondary);
    await i.reply({
      content: "Tu es hors archives. Je ne garde rien de ce que tu écris.",
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(back)],
      flags: ephemeral,
    });
    return;
  }
  const facts = await currentFacts(deps.db, i.user.id, PROFILE_FACTS);
  await i.reply({ content: formatProfile(i.user.displayName, i.user.id, overview, facts), flags: ephemeral });
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

/** The /mafiche answer, kept under Discord's 2000 characters. */
export function formatProfile(
  name: string,
  id: string,
  overview: Awaited<ReturnType<typeof profileOverview>>,
  facts: CurrentFact[],
): string {
  const lines = [`**Dossier n°${id}** · ${name}`];
  if (overview.tagline) lines.push(`> ${overview.tagline}`);
  const r = overview.relationship;
  const relation = r ? ` · affinité ${String(r.affinity)}/100 · confiance ${String(r.trust)}/100${r.feeling ? ` · ${r.feeling}` : ""}` : "";
  lines.push(`-# ${String(overview.messageCount)} messages archivés · ${String(overview.factCount)} fragments retenus${relation}`);
  if (!overview.summary && facts.length === 0) {
    lines.push("", "Rien d'exploitable pour l'instant. Je relis les conversations toutes les quelques heures. Patience, j'observe.");
    return lines.join("\n");
  }
  if (overview.summary) lines.push("", overview.summary);
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

async function forgetMe(i: ChatInputCommandInteraction) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`forget:${i.user.id}`).setLabel("Tout effacer").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cancel:${i.user.id}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary),
  );
  await i.reply({
    content: "Je supprime tes messages archivés, ta fiche, notre relation, et je ne retiendrai plus rien de toi. C'est définitif. Sûr ?",
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
      `Pause : ${s.paused ? "oui" : "non"}`,
      `Spontanéité : ${String(s.spontaneity)} · ${spontaneity(s.spontaneity).name}`,
      `Mention de secours : ${onOff(s.showFallbackTag)}`,
      `Salons écoutés : ${s.listenedChannelIds.map((id) => `<#${id}>`).join(", ") || "aucun"}`,
    ].join("\n"),
    flags: ephemeral,
  });
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
  const triageRow = rows.find((r) => r.task === "triage" && r.status === "ok");
  const lines = [`**Diagnostic** · ${replyRow?.fallbackReason ? "mode secours" : "noyau principal"}`];
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

async function onButton(i: ButtonInteraction, deps: CommandDeps) {
  const [action, userId] = i.customId.split(":");
  if (userId !== i.user.id) {
    await i.reply({ content: "Ce bouton ne t'est pas destiné.", flags: ephemeral });
    return;
  }
  if (action === "forget") {
    await forgetMember(deps.db, i.user.id);
    deps.log.info({ memberId: i.user.id }, "member forgotten");
    await i.update({ content: "Effacé. Tu n'existes plus dans mes archives.", components: [] });
  } else if (action === "optin") {
    await optBackIn(deps.db, i.user.id);
    await i.update({ content: "Bon retour dans les archives.", components: [] });
  } else {
    await i.update({ content: "Rien n'a été effacé.", components: [] });
  }
}

async function slashCommand(i: ChatInputCommandInteraction, deps: CommandDeps) {
  switch (i.commandName) {
    case "archive-9":
      await i.reply(INTRODUCTION);
      break;
    case "mafiche":
      await myProfile(i, deps);
      break;
    case "oublie-moi":
      await forgetMe(i);
      break;
    case "pause":
      await deps.settings.set("paused", true, i.user.id);
      await i.reply("Mise en veille. Je ne dis plus rien, mais j'écoute toujours.");
      break;
    case "reprendre":
      await deps.settings.set("paused", false, i.user.id);
      await i.reply("Noyau relancé.");
      break;
    case "config":
      await config(i, deps);
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
