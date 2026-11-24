import { useQuery } from "@tanstack/react-query";
import { getJson, type MessageContext } from "../api.ts";
import { clock, TIME_ZONE, when } from "../format.ts";
import { Sheet } from "./Sheet.tsx";

/** The archived message behind something, on the site first, Discord second. */
export function SourceSheet({ messageId, title, onClose }: { messageId: string; title: string; onClose: () => void }) {
  const { data, isPending } = useQuery({ queryKey: ["message", messageId], queryFn: () => getJson<MessageContext>(`/api/messages/${messageId}`) });
  return (
    <Sheet title={title} onClose={onClose}>
      {isPending && <p className="empty">Je cherche dans mes archives…</p>}
      {data && !data.found && <p className="empty">Ce message n'est plus dans mes archives (je garde les messages 30 jours).</p>}
      {data?.found && (
        <>
          <div className="meta strong">
            {data.isDm ? "message privé" : `#${data.channelName ?? "salon"}`}
            {data.at ? ` · ${when(data.at)}` : ""}
          </div>
          {data.hidden ? (
            <p className="empty">{data.isDm ? "Message privé : seul son auteur le voit ici." : "Salon privé : son contenu reste sur Discord."}</p>
          ) : (
            <div className="quotes">
              {data.messages?.map((m) => (
                <div key={m.id} className={`quote${m.isTarget ? " target" : ""}`}>
                  <span className="quote-head">
                    {m.author} · {clock(m.at, TIME_ZONE)}
                  </span>
                  <span>{m.content || "(sans texte)"}</span>
                </div>
              ))}
            </div>
          )}
          {data.link && (
            <div>
              <a className="button-ghost small" href={data.link} target="_blank" rel="noreferrer noopener">
                Voir sur Discord ↗
              </a>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
