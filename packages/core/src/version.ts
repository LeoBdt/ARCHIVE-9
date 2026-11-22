// Starts end on a vowel, middles are consonant + vowel, ends start on a consonant:
// two vowels never meet, so every name reads easily.
const STARTS = ["No", "Ori", "Sy", "Mi", "Ka", "Ve", "Tha", "Isa", "Que", "Zé", "Lu", "Ae", "Ny", "Eli", "Sa", "Io"];
const MIDDLES = ["va", "ra", "lè", "ru", "li", "ly", "na", "ma", "no", "phi", "se", "ta", "vo", "ri", "ze", "mé"];
const ENDS = ["he", "ne", "re", "lo", "ro", "ris", "lis", "nor", "rys", "vane", "dren", "vel", "rum", "xa", "nix", "thée"];

/** An invented word for a deployment (« Novahe »), always the same for a given commit. */
export function versionName(sha: string): string | null {
  if (!/^[0-9a-f]{8,40}$/i.test(sha)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = [0, 2, 4, 6].map((i) => parseInt(sha.slice(i, i + 2), 16));
  return `${STARTS[a % 16] ?? ""}${d % 2 === 0 ? (MIDDLES[b % 16] ?? "") : ""}${ENDS[c % 16] ?? ""}`;
}

/** « Novahe (a1b2c3d) », or « dev » for a local run without a commit. */
export function versionLabel(sha: string | undefined): string {
  const name = sha ? versionName(sha) : null;
  return name && sha ? `${name} (${sha.slice(0, 7)})` : "dev";
}
