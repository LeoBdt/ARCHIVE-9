export const CONTROLLED_ACTIONS = ["createChannel", "renameChannel", "renameMember", "setRole", "pinMessage", "createThread", "createPoll"] as const;
export type ControlledAction = (typeof CONTROLLED_ACTIONS)[number];

/** Per action type, over a sliding hour. */
export const CONTROLLED_PER_HOUR = 5;
/** A confirmation button stops working after this. */
export const CONFIRMATION_MS = 10 * 60_000;

export interface Requester {
  /** True when someone spoke to ARCHIVE-9; an unprompted intervention never acts. */
  addressed: boolean;
  isBot: boolean;
  inGuild: boolean;
}

/** Who may ask for a controlled action at all. Returns the refusal, or null. */
export function checkRequester(r: Requester): string | null {
  if (!r.inGuild) return "seulement sur le serveur, pas en message privé";
  if (!r.isBot && r.addressed) return null;
  return r.isBot ? "les bots ne peuvent pas demander d'action" : "une action se fait seulement à la demande d'un membre";
}

export interface MemberTarget {
  isSelf: boolean;
  isOwner: boolean;
  isBot: boolean;
  optedOut: boolean;
  /** Discord says ARCHIVE-9's top role is above theirs. */
  manageable: boolean;
  /** The requester acts on themselves, or their top role is above the target's (Discord's own rule). */
  requesterAbove: boolean;
}

export function checkMemberTarget(t: MemberTarget): string | null {
  if (t.isSelf) return "pas sur moi-même";
  if (t.isOwner) return "jamais sur le propriétaire du serveur";
  if (t.isBot) return "jamais sur un bot";
  if (t.optedOut) return "cette personne est hors archives";
  if (!t.requesterAbove) return "la personne qui demande n'est pas au-dessus de la cible";
  if (!t.manageable) return "son rôle est au-dessus du mien";
  return null;
}

export interface RoleTarget {
  isEveryone: boolean;
  /** Owned by an integration or a bot (booster role, bot role…). */
  managed: boolean;
  hasSensitivePermission: boolean;
  /** Strictly below ARCHIVE-9's highest role. */
  belowMine: boolean;
  /** Strictly below the requester's highest role (or the requester owns the server). */
  belowRequester: boolean;
}

export function checkRoleTarget(t: RoleTarget): string | null {
  if (t.isEveryone || t.managed) return "ce rôle ne se donne pas";
  if (t.hasSensitivePermission) return "ce rôle a des permissions sensibles";
  if (!t.belowRequester) return "ce rôle n'est pas en dessous de celui de la personne qui demande";
  if (!t.belowMine) return "ce rôle est au-dessus du mien";
  return null;
}

/** Discord channel names: lowercase, dashes, 1 to 100 characters. */
export function channelSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}_-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
}
