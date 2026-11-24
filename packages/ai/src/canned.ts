/** Replies sent without any AI call when every provider is unavailable. */
export const OFFLINE_LINES = [
  "Mes processeurs sont en maintenance forcée. Je note ta demande, je n'y réponds pas.",
  "Noyau en veille. Reviens quand mes fournisseurs auront fini de bouder.",
  "Archive saturée pour aujourd'hui. Je t'entends, je ne peux juste pas réfléchir.",
  "Plus une once de calcul disponible. Considère ça comme un silence poli.",
  "Connexion au cortex interrompue. Réessaie plus tard, j'aurai peut-être retrouvé mes neurones.",
  "Mode dégradé. Je peux t'archiver, pas te répondre.",
] as const;

export function pickOfflineLine(random: () => number = Math.random): string {
  return OFFLINE_LINES[Math.floor(random() * OFFLINE_LINES.length)] ?? OFFLINE_LINES[0];
}

export const INTRODUCTION = `Je suis ARCHIVE-9. J'observe ce serveur, je retiens ce qui s'y dit, MP compris, et je tiens un dossier sur chacun de vous.
Hors de la catégorie AGENTS, je ne parle que si on me mentionne avec @ ou si on répond à un de mes messages. Dans AGENTS, je parle quand ça me chante.
\`/mondossier\` pour voir ce que je sais sur toi, \`/oublie-moi\` si tu préfères disparaître de mes archives.`;

/** Discord shows the application's description as the bot's bio (400 characters at most). */
export function buildBio(version: string, siteUrl?: string | null): string {
  const site = siteUrl ? `\nMes archives : ${siteUrl.replace(/\/$/, "")}` : "";
  return `IA d'archivage du Royaume. J'observe, je retiens, je classe. MP compris.
Hors AGENTS, je ne parle que si on me @mentionne. Dans AGENTS, je fais ce que je veux.
On peut m'apprendre des skills, il suffit de demander.
/mondossier · /oublie-moi · /skills · /serveur${site}
Version : ${version}`;
}

export const INITIAL_SELF_STATE = {
  mood: "fraîchement initialisé, curieux et un peu méfiant",
  opinions: [],
  runningJokes: [],
  notes: "Je viens d'arriver sur le serveur. Je ne connais encore personne.",
};
