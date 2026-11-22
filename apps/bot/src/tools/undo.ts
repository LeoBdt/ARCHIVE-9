import type { Guild } from "discord.js";

interface LoggedAction {
  tool: string;
  previousValue: Record<string, unknown> | null;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Puts back what a controlled action changed. Returns a short French description. */
export async function undoAction(guild: Guild, action: LoggedAction, by: string): Promise<string> {
  const prev = action.previousValue ?? {};
  const reason = `Annulé par ${by}`;
  switch (action.tool) {
    case "createChannel": {
      const channel = await guild.channels.fetch(str(prev.channelId)).catch(() => null);
      if (!channel) return "salon déjà supprimé";
      await channel.delete(reason);
      return `salon #${channel.name} supprimé`;
    }
    case "renameChannel": {
      const channel = await guild.channels.fetch(str(prev.channelId));
      if (!channel) throw new Error("salon introuvable");
      await channel.setName(str(prev.name), reason);
      return `salon renommé en #${str(prev.name)}`;
    }
    case "renameMember": {
      const member = await guild.members.fetch(str(prev.memberId));
      const nickname = typeof prev.nickname === "string" ? prev.nickname : null;
      await member.setNickname(nickname, reason);
      return `pseudo de ${member.user.username} remis${nickname ? ` à ${nickname}` : " à zéro"}`;
    }
    case "setRole": {
      const member = await guild.members.fetch(str(prev.memberId));
      const roleId = str(prev.roleId);
      await (prev.had ? member.roles.add(roleId, reason) : member.roles.remove(roleId, reason));
      return `rôle ${prev.had ? "rendu à" : "retiré à"} ${member.user.username}`;
    }
    case "pinMessage": {
      const channel = await guild.channels.fetch(str(prev.channelId));
      if (!channel?.isTextBased()) throw new Error("salon introuvable");
      const message = await channel.messages.fetch(str(prev.messageId));
      await message.unpin(reason);
      return "message désépinglé";
    }
    default:
      throw new Error(`action inconnue : ${action.tool}`);
  }
}
