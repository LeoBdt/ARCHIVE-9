import { createActionTools } from "./actions.ts";
import type { ToolContext } from "./context.ts";
import { createFeedbackTools } from "./feedback.ts";
import { createFreeTools } from "./free.ts";
import { createProfileTools } from "./profile.ts";
import { createSkillTools } from "./skills.ts";

export type { ToolContext } from "./context.ts";

/** Every tool beyond speaking, always given so the definitions stay identical and cached. */
export function createReplyTools(ctx: ToolContext) {
  return { ...createFreeTools(ctx), ...createProfileTools(ctx), ...createFeedbackTools(ctx), ...createSkillTools(ctx), ...createActionTools(ctx) };
}
