import type { AiTask } from "@archive-9/core";
import type { LanguageModelUsage } from "ai";
import { CooldownTracker } from "./cooldowns.ts";
import type { ModelResolver, ResolvedModel } from "./models.ts";
import type { ModelRef } from "./routes.ts";
import { usageFromError, usageFromResult, type UsageRecord } from "./usage.ts";

export type Routes = Record<AiTask, ModelRef[]>;

interface CallResult {
  totalUsage: LanguageModelUsage;
  providerMetadata?: Record<string, unknown> | undefined;
  response: { headers?: Record<string, string> | undefined };
}

export type GenerateOutcome<R> =
  | { ok: true; result: R; ref: ModelRef; isFallback: boolean; usage: UsageRecord[] }
  | { ok: false; usage: UsageRecord[] };

export interface GenerateOptions {
  /** Rough size of the request, to skip a model whose minute budget is too low. */
  estimatedTokens?: number;
  /** Returns false when the result is unusable (e.g. invalid output) to try the next model. */
  accept?: (result: CallResult) => boolean;
}

/** Runs AI tasks over their fallback chain, skipping models that are cooling down. */
export class AiRuntime {
  private readonly routes: Routes;
  private readonly resolve: ModelResolver;
  private readonly tracker: CooldownTracker;
  private readonly now: () => number;

  constructor(routes: Routes, resolve: ModelResolver, tracker = new CooldownTracker(), now: () => number = Date.now) {
    this.routes = routes;
    this.resolve = resolve;
    this.tracker = tracker;
    this.now = now;
  }

  primary(task: AiTask): ModelRef | undefined {
    return this.routes[task][0];
  }

  async generate<R extends CallResult>(
    task: AiTask,
    call: (model: ResolvedModel, ref: ModelRef) => Promise<R>,
    options: GenerateOptions = {},
  ): Promise<GenerateOutcome<R>> {
    const usage: UsageRecord[] = [];
    let firstProblem: string | null = null;

    for (const [index, ref] of this.routes[task].entries()) {
      const blocked = this.tracker.blockedReason(ref.id, options.estimatedTokens);
      if (blocked) {
        firstProblem ??= `${ref.id} ${blocked}`;
        continue;
      }

      const startedAt = this.now();
      try {
        const result = await call(this.resolve(ref), ref);
        this.tracker.recordHeaders(ref.id, result.response.headers);
        const fallbackReason = index > 0 ? firstProblem : null;
        if (options.accept && !options.accept(result)) {
          usage.push({ ...usageFromResult(task, ref, result, this.now() - startedAt, fallbackReason), status: "error", error: "rejected output" });
          firstProblem ??= `${ref.id} invalid_output`;
          continue;
        }
        usage.push(usageFromResult(task, ref, result, this.now() - startedAt, fallbackReason));
        return { ok: true, result, ref, isFallback: index > 0, usage };
      } catch (error) {
        const reason = this.tracker.recordError(ref.id, error);
        usage.push(usageFromError(task, ref, reason, error, this.now() - startedAt));
        firstProblem ??= `${ref.id} ${reason}`;
      }
    }

    return { ok: false, usage };
  }
}
