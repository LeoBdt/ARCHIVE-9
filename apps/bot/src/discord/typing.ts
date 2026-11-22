import type { SendableChannels } from "discord.js";

/** Shows "ARCHIVE-9 is typing…" until the returned function is called. Discord drops it after ~10 s. */
export function keepTyping(channel: SendableChannels, intervalMs = 8_000): () => void {
  const ping = () => void channel.sendTyping().catch(() => undefined);
  ping();
  const timer = setInterval(ping, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
