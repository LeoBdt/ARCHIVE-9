import type { ServerContext } from "@archive-9/ai";
import { getMember, profileOverview, type Database } from "@archive-9/db";

export interface ServerSource {
  /** The guild ID, which is also the ID of the server's profile row. */
  id: string;
}

/** What prompts get about the server beyond its fixed description: its name and what was learned. */
export async function loadServerContext(db: Database, server: ServerSource): Promise<ServerContext | undefined> {
  const member = await getMember(db, server.id);
  if (!member?.isServer) return undefined;
  const { summary } = await profileOverview(db, server.id);
  return { id: server.id, name: member.username, summary };
}
