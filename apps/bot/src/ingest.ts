import type { MessageReactions } from "@archive-9/core";
import {
  deleteMessages,
  dmPrivateIds,
  ensureMember,
  optedOutIds,
  saveImages,
  saveMessage,
  setMessageReactions,
  type ImageInput,
  updateMessageContent,
  upsertMember,
  type Database,
} from "@archive-9/db";
import { MessageFlags, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction } from "discord.js";
import { isInAgents } from "./discord/zone.ts";
import type { SettingsStore } from "./settings.ts";

export interface IngestDeps {
  db: Database;
  settings: SettingsStore;
  knownAiBotIds: Set<string>;
  agentsCategoryId: string | null;
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

/** Pictures and GIFs of a message: attachments, and the previews Discord makes for links (Tenor, Giphy…). */
export function imagesOf(message: Message | PartialMessage): ImageInput[] {
  const images: ImageInput[] = [];
  for (const a of message.attachments.values()) {
    if (!a.contentType?.startsWith("image/")) continue;
    images.push({ id: a.id, messageId: message.id, url: a.url, kind: a.contentType === "image/gif" ? "gif" : "image", name: a.name });
  }
  message.embeds.forEach((embed, i) => {
    const url = embed.thumbnail?.proxyURL ?? embed.thumbnail?.url ?? embed.image?.proxyURL ?? embed.image?.url;
    if (!url || !["gifv", "image", "rich", "article"].includes(embed.data.type ?? "")) return;
    images.push({ id: `${message.id}:${String(i)}`, messageId: message.id, url, kind: "embed", name: embed.provider?.name ?? embed.title ?? null });
  });
  return images.slice(0, 4);
}

/** Whose DM conversation this is (the other person when ARCHIVE-9 wrote it), or null outside DMs. */
function dmOwner(message: Message | PartialMessage): string | null {
  if (message.guildId !== null) return null;
  if (message.author?.id !== message.client.user.id) return message.author?.id ?? null;
  return "recipientId" in message.channel ? message.channel.recipientId : null;
}

/** Stores messages from listened channels and DMs, except from opted-out members and private DMs. */
export class Ingest {
  private readonly deps: IngestDeps;

  constructor(deps: IngestDeps) {
    this.deps = deps;
  }

  async onCreate(message: Message): Promise<void> {
    const { db, settings, knownAiBotIds } = this.deps;
    if (!isArchived(settings, message)) return;
    // Command answers (/mondossier…) are system text, sometimes private to one member.
    if (message.flags.has(MessageFlags.Ephemeral) || message.interactionMetadata) return;
    if ((await optedOutIds(db, [message.author.id])).has(message.author.id)) return;
    const owner = dmOwner(message);
    if (owner && (await dmPrivateIds(db, [owner])).has(owner)) return;

    const member = {
      id: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName ?? message.author.globalName,
      isBot: message.author.bot,
      avatar: message.author.avatar,
      // A bot that writes in AGENTS is an AI agent from then on (see upsertMember).
      isKnownAiBot: knownAiBotIds.has(message.author.id) || (message.author.bot && isInAgents(message.channel, this.deps.agentsCategoryId)),
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
    await saveImages(db, imagesOf(message));
  }

  async onUpdate(message: Message | PartialMessage): Promise<void> {
    if (!isArchived(this.deps.settings, message) || message.content === null) return;
    await updateMessageContent(this.deps.db, message.id, message.content, message.editedAt ?? new Date());
    // Link previews arrive with an edit, a moment after the message.
    if (message.embeds.length > 0) await saveImages(this.deps.db, imagesOf(message)).catch(() => undefined);
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
