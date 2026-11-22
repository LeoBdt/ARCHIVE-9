import { CONFIRMATION_MS, CONTROLLED_ACTIONS, CONTROLLED_PER_HOUR, type ControlledAction } from "@archive-9/core";
import { claimPending, finishAction, getAction, type Database } from "@archive-9/db";
import { MessageFlags, PermissionFlagsBits, type ButtonInteraction } from "discord.js";
import type { Logger } from "../logger.ts";
import { overHourlyLimit, reasonFor } from "./actions.ts";
import { errorText } from "./context.ts";
import { planAction } from "./plans.ts";

export interface ConfirmDeps {
  db: Database;
  log: Logger;
  selfId: string;
  agentsCategoryId: string | null;
}

const ephemeral = MessageFlags.Ephemeral;

function isControlled(tool: string): tool is ControlledAction {
  return (CONTROLLED_ACTIONS as readonly string[]).includes(tool);
}

/** The "Confirmer" / "Annuler" buttons under a pending action. */
export async function handleConfirmation(i: ButtonInteraction, deps: ConfirmDeps, confirmed: boolean, actionId: string): Promise<void> {
  const action = await getAction(deps.db, actionId);
  if (action?.status !== "pending" || !isControlled(action.tool)) {
    await i.reply({ content: "Cette demande a déjà été traitée.", flags: ephemeral });
    return;
  }
  const isRequester = i.user.id === action.requestedBy;
  if (!isRequester && !(!confirmed && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))) {
    await i.reply({ content: "Seule la personne qui a demandé peut valider.", flags: ephemeral });
    return;
  }
  const close = (line: string) => i.update({ content: `${i.message.content.split("\n")[0] ?? ""}\n${line}`, components: [], allowedMentions: { parse: [] } });

  if (!confirmed) {
    if (await claimPending(deps.db, actionId, "cancelled", "annulée")) await close("-# Annulé.");
    return;
  }
  if (Date.now() - action.createdAt.getTime() > CONFIRMATION_MS) {
    if (await claimPending(deps.db, actionId, "cancelled", "expirée")) await close("-# Expiré : redemande-moi.");
    return;
  }
  if (!i.guild) return;
  // Checked before the claim, which already counts this action as done.
  if (await overHourlyLimit(deps.db, action.tool)) {
    if (await claimPending(deps.db, actionId, "cancelled", "limite horaire")) await close(`-# Refusé : déjà ${String(CONTROLLED_PER_HOUR)} actions de ce type dans l'heure.`);
    return;
  }
  if (!(await claimPending(deps.db, actionId))) return;

  try {
    const requester = await i.guild.members.fetch(i.user.id);
    const plan = await planAction(deps, i.guild, requester, action.tool, action.params);
    if (typeof plan === "string") {
      await finishAction(deps.db, actionId, { status: "refused", refusalReason: plan });
      await close(`-# Refusé : ${plan}.`);
      return;
    }
    const { previous } = await plan.run(reasonFor(i.user.username));
    await finishAction(deps.db, actionId, { status: "done", previousValue: previous });
    deps.log.info({ tool: action.tool, params: action.params, by: i.user.id }, "controlled action");
    await close("-# ✅ Fait. Un admin peut l'annuler avec `/actions`.");
  } catch (error) {
    await finishAction(deps.db, actionId, { status: "failed", refusalReason: errorText(error) });
    await close(`-# Échec : ${errorText(error)}.`);
  }
}
