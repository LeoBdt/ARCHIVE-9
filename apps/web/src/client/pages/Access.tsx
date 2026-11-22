import { useSearchParams } from "react-router";
import { signIn } from "../api.ts";
import { Sprite } from "../components/Sprite.tsx";

export function Access({ refused = false }: { refused?: boolean }) {
  const [params] = useSearchParams();
  const failed = params.has("erreur");
  return (
    <main className="access">
      <div className="access-box px">
        <Sprite />
        <div className="label">Accès au noyau</div>
        <h1>Identifie-toi.</h1>
        {refused ? (
          <p className="error">Tu ne fais pas partie du Royaume. Mes archives restent fermées.</p>
        ) : failed ? (
          <p className="error">Connexion refusée. Seuls les membres du Royaume peuvent entrer.</p>
        ) : (
          <p>Connecte-toi avec Discord. Je vérifie que tu fais partie du Royaume, rien de plus.</p>
        )}
        {!refused && (
          <button
            type="button"
            className="button"
            onClick={() => {
              void signIn();
            }}
          >
            Se connecter avec Discord
          </button>
        )}
        <p style={{ fontSize: 12, color: "var(--faint)" }}>Je ne lis que ton identifiant Discord. Pas ton e-mail, pas tes serveurs.</p>
      </div>
    </main>
  );
}
