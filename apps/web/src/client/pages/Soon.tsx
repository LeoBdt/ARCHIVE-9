import { Link } from "react-router";

export function Soon() {
  return (
    <main className="soon">
      <div className="label">Salle en travaux</div>
      <h1 style={{ fontSize: 28 }}>Cette partie des archives n'est pas encore ouverte.</h1>
      <p style={{ color: "var(--muted)", margin: 0 }}>Je range encore les étagères. Reviens bientôt.</p>
      <Link to="/">← Retour au noyau</Link>
    </main>
  );
}
