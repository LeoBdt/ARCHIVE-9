import { useEffect, useState } from "react";

const LINES = ["connexion au noyau", "lecture des archives", "chargement des dossiers", "vérification de ton identité"];
const KEY = "a9-boot";
const STEP_MS = 320;

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** Short start-up sequence, once per session; a click or a key skips it. */
export function Boot() {
  const [shown, setShown] = useState(() => !alreadySeen());
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!shown) return;
    const done = () => {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        // Private mode: the sequence just plays again next time.
      }
      setShown(false);
    };
    const timer = setInterval(() => {
      setStep((s) => {
        if (s >= LINES.length) {
          clearInterval(timer);
          setTimeout(done, 200);
        }
        return s + 1;
      });
    }, STEP_MS);
    window.addEventListener("keydown", done);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", done);
    };
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      className="boot"
      role="status"
      onClick={() => {
        try {
          sessionStorage.setItem(KEY, "1");
        } catch {
          // ignored
        }
        setShown(false);
      }}
    >
      <pre>
        {LINES.slice(0, step).map((line) => (
          <div key={line}>
            {"> "}
            {line}… <span className="ok">ok</span>
          </div>
        ))}
        <span className="cursor">▌</span>
      </pre>
      <small>Clique ou appuie sur une touche pour passer</small>
    </div>
  );
}
