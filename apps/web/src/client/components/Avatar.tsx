import { useState } from "react";
import { avatarColor, avatarUrl, initials } from "../format.ts";

/** A Discord profile picture fetched tiny and drawn big, so it reads as pixel art. */
export function Avatar({ id, name, hash, size = 40 }: { id: string; name: string; hash: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const url = avatarUrl(id, hash, size >= 64 ? 32 : 16);
  if (!url || broken) {
    return (
      <span className="avatar" aria-hidden="true" style={{ width: size, height: size, background: avatarColor(id), fontSize: Math.round(size * 0.4) }}>
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className="avatar-img"
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setBroken(true);
      }}
    />
  );
}
