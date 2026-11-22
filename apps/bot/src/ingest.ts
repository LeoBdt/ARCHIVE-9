import type { MessageReactions } from "@archive-9/core";
import {
  deleteMessages,
  ensureMember,
  optedOutIds,
  saveMessage,
  setMessageReactions,
  updateMessageContent,
  upsertMember,
  type Database,
} from "@archive-9/db";
import { MessageFlags, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction } from "discord.js";
import type { SettingsStore } from "./settings.ts";

export interface IngestDeps {
  db: Database;
  settings: SettingsStore;
  knownAiBotIds: Set<string>;
}

/** Listened channels and their threads, plus direct messages. */
function isArchived(settings: SettingsStore, message: Message | PartialMessage): boolean {
  if (message.guildId === null) return true;
  const parentId = "parentId" in message.channel ? message.channel.parentId : null;
  return settings.isListened(message.channelId, parentId);
}

function reactionCounts(message: Message | PartialMessage): MessageReactions {
  const counts: MessageReactions = {};
  for (const reaction of message.reactions.cache.values()) {
    const key = reaction.emoji.id ? `<:${reaction.emoji.name ?? "emoji"}:${reaction.emoji.id}>` : (reaction.emoji.name ?? "?");
    counts[key] = reaction.count;
  }
  return counts;
}

/** Stores messages from listened channels and DMs, except from opted-out members. */
export class Ingest {
  private readonly deps: IngestDeps;

  constructor(deps: IngestDeps) {
    this.deps = deps;
  }

  async onCreate(message: Message): Promise<void> {
    const { db, settings, knownAiBotIds } = this.deps;
    if (!isArchived(settings, message)) return;
    // Command answers (/mafiche…) are system text, sometimes private to one member.
    if (message.flags.has(MessageFlags.Ephemeral) || message.interactionMetadata) return;
    if ((await optedOutIds(db, [message.author.id])).has(message.author.id)) return;

    const member = {
      id: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName ?? message.author.globalName,
      isBot: message.author.bot,
      isKnownAiBot: knownAiBotIds.has(message.author.id),
    };
    // A DM carries no server nickname: don't overwrite the one we know.
    await (message.guildId === null ? ensureMember(db, member) : upsertMember(db, member));
    await saveMessage(db, {
      id: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author.id,
      content: message.content,
      replyToId: message.reference?.messageId ?? null,
      mentionedIds: [...message.mentions.users.keys()],
      createdAt: message.createdAt,
    });
  }

  async onUpdate(message: Message | PartialMessage): Promise<void> {
    if (!isArchived(this.deps.settings, message) || message.content === null) return;
    await updateMessageContent(this.deps.db, message.id, message.content, message.editedAt ?? new Date());
  }

  async onDelete(ids: string[]): Promise<void> {
    await deleteMessages(this.deps.db, ids);
  }

  async onReaction(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
    const message = reaction.message;
    if (!isArchived(this.deps.settings, message)) return;
    await setMessageReactions(this.deps.db, message.id, reactionCounts(message));
  }
}
