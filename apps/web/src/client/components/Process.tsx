import { useQuery } from "@tanstack/react-query";
import { getJson, type RequestView } from "../api.ts";
import { clock, TIME_ZONE } from "../format.ts";
import { Typed } from "./Typed.tsx";

/** Follows one request handled by ARCHIVE-9: live updates refresh it, polling is the fallback. */
export function useRequest(id: string | null) {
  return useQuery({
    queryKey: ["request", id],
    queryFn: () => getJson<RequestView>(`/api/requests/${id ?? ""}`),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data && ["done", "failed"].includes(q.state.data.status) ? false : 2_000),
  });
}

export const isWorking = (request: RequestView | undefined, id: string | null) => id !== null && (!request || (request.status !== "done" && request.status !== "failed"));

/** Each step, as it comes, like a terminal; what it says to you stands out. */
export function Process({ request }: { request: RequestView | undefined }) {
  if (!request) return null;
  const working = request.status !== "done" && request.status !== "failed";
  return (
    <ol className="process" aria-live="polite">
      {request.steps.map((step, i) => (
        <li key={i} className={`process-${step.kind}`}>
          {step.kind !== "say" && <time dateTime={step.at}>{clock(step.at, TIME_ZONE)}</time>}
          <span className="process-dot" aria-hidden="true">
            {step.kind === "error" ? "✗" : step.kind === "say" ? "»" : "✓"}
          </span>
          <span>{step.kind === "say" ? <Typed text={`« ${step.text} »`} /> : step.text}</span>
        </li>
      ))}
      {working && (
        <li className="process-wait">
          <span />
          <span className="process-dot cursor" aria-hidden="true">
            ▌
          </span>
          <span>{request.status === "pending" ? "En attente de mon noyau…" : "Je réfléchis…"}</span>
        </li>
      )}
    </ol>
  );
}
