import type { SqlClient } from "./client.ts";

/** The site's own Postgres user: reads everything, writes only its own tables. */
export const WEB_DB_ROLE = "archive9_web";

const WRITABLE = ["web_user", "web_session", "web_account", "web_verification", "site_admins"];
/**
 * What the site changes for members and admins: their own facts, the settings, a rollback of
 * the self state, the requests ARCHIVE-9 handles, and closing a skill.
 */
const APPENDABLE = ["profile_facts", "fact_corrections", "settings", "self_state_versions", "site_requests", "skills"];

/**
 * Creates or updates the site's user. Run by the bot after its migrations, so new tables
 * are readable by the site on the next start.
 */
export async function ensureWebRole(sql: SqlClient, password: string): Promise<void> {
  if (!/^[A-Za-z0-9]{16,}$/.test(password)) throw new Error("WEB_DB_PASSWORD: 16+ letters and digits");
  await sql.unsafe(`do $$ begin
    if not exists (select from pg_roles where rolname = '${WEB_DB_ROLE}') then create role ${WEB_DB_ROLE} login; end if;
  end $$`);
  await sql.unsafe(`alter role ${WEB_DB_ROLE} login password '${password}'`);
  const [db] = await sql<{ name: string }[]>`select current_database() as name`;
  await sql.unsafe(`grant connect on database "${db?.name ?? ""}" to ${WEB_DB_ROLE}`);
  await sql.unsafe(`grant usage on schema public to ${WEB_DB_ROLE}`);
  await sql.unsafe(`grant select on all tables in schema public to ${WEB_DB_ROLE}`);
  await sql.unsafe(`grant insert, update, delete on ${WRITABLE.join(", ")} to ${WEB_DB_ROLE}`);
  await sql.unsafe(`grant insert, update on ${APPENDABLE.join(", ")} to ${WEB_DB_ROLE}`);
  await sql.unsafe(`grant usage on all sequences in schema public to ${WEB_DB_ROLE}`);
}
