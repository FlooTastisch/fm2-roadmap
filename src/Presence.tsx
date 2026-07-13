import { useState } from "react";
import type { OnlineUser } from "./types";
import { roleLabel } from "./types";
import { mcHeadUrl } from "./mcHead";
import { cursorColor } from "./cursorColor";

const MAX_AVATARS = 6;

/** Avatar mit Minecraft-Kopf; fällt auf den Anfangsbuchstaben zurück,
 *  wenn kein Kopf geladen werden kann (z. B. kein gültiger MC-Name).
 *  Beim Hovern erscheint sofort ein Tooltip mit Name und Rolle.
 *  Klick schaltet den Live-Cursor des Benutzers ein/aus (nicht beim eigenen). */
function Avatar({
  user,
  isSelf,
  watched,
  onToggleCursor,
}: {
  user: OnlineUser;
  isSelf: boolean;
  watched: boolean;
  onToggleCursor: (id: number) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const label = isSelf
    ? `${user.username} (du) · ${roleLabel(user.role)}`
    : `${user.username} · ${roleLabel(user.role)} · ${
        watched ? "Cursor sichtbar – klicken zum Ausblenden" : "Klicken, um Cursor anzuzeigen"
      }`;
  return (
    <button
      type="button"
      className={
        "presence-avatar" + (isSelf ? " presence-self" : "") + (watched ? " presence-watched" : "")
      }
      style={watched && !isSelf ? { borderColor: cursorColor(user.id) } : undefined}
      data-tooltip={label}
      onClick={() => {
        if (!isSelf) onToggleCursor(user.id);
      }}
    >
      {imgFailed ? (
        <span className="presence-initial">{user.username.slice(0, 1).toUpperCase()}</span>
      ) : (
        <img
          src={mcHeadUrl(user.username)}
          alt={user.username}
          loading="lazy"
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      )}
    </button>
  );
}

/** Zeigt wie bei Google Docs die Benutzer an, die die Roadmap gerade offen haben.
 *  Über Klick auf einen Avatar lässt sich dessen Live-Cursor ein-/ausblenden. */
export function Presence({
  online,
  selfId,
  watchedIds,
  onToggleCursor,
}: {
  online: OnlineUser[];
  selfId: number;
  watchedIds: Set<number>;
  onToggleCursor: (id: number) => void;
}) {
  if (online.length === 0) return null;
  // Sich selbst ans Ende – interessant sind vor allem die anderen
  const sorted = [...online].sort((a, b) => Number(a.id === selfId) - Number(b.id === selfId));
  const shown = sorted.slice(0, MAX_AVATARS);
  const overflow = sorted.slice(MAX_AVATARS);
  return (
    <div className="presence">
      {shown.map((u) => (
        <Avatar
          key={u.id}
          user={u}
          isSelf={u.id === selfId}
          watched={watchedIds.has(u.id)}
          onToggleCursor={onToggleCursor}
        />
      ))}
      {overflow.length > 0 && (
        <span
          className="presence-avatar presence-more"
          data-tooltip={overflow.map((u) => u.username).join(", ")}
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}
