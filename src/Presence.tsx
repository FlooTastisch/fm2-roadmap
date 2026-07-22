import { useState } from "react";
import type { CursorDisplayMode, OnlineUser } from "./types";
import { roleLabel } from "./types";
import { mcHeadUrl } from "./mcHead";
import { cursorColor } from "./cursorColor";

const MAX_AVATARS = 6;

/** Avatar mit Minecraft-Kopf; fällt auf den Anfangsbuchstaben zurück,
 *  wenn kein Kopf geladen werden kann (z. B. kein gültiger MC-Name).
 *  Beim Hovern erscheint sofort ein Tooltip mit Name und Rolle.
 *  Klick wechselt den Cursor-Modus: aus → nur Aktionen → immer sichtbar. */
function Avatar({
  user,
  isSelf,
  mode,
  onCycleCursorMode,
}: {
  user: OnlineUser;
  isSelf: boolean;
  mode: CursorDisplayMode;
  onCycleCursorMode: (id: number) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const modeLabel =
    mode === "off"
      ? "Cursor aus – klicken: nur bei Aktionen"
      : mode === "action"
        ? "Cursor nur bei Aktionen – klicken: immer sichtbar"
        : "Cursor immer sichtbar – klicken: aus";
  const label = isSelf
    ? `${user.username} (du) · ${roleLabel(user.role)}`
    : `${user.username} · ${roleLabel(user.role)} · ${modeLabel}`;
  // Der Login-Name des Admins lautet „Floo“, der Minecraft-Skin aber „FlooTastisch“.
  const minecraftName = user.username.toLowerCase() === "floo" ? "FlooTastisch" : user.username;
  return (
    <button
      type="button"
      className={
        "presence-avatar" +
        (isSelf ? " presence-self" : "") +
        (!isSelf ? ` cursor-mode-${mode}` : "")
      }
      style={mode !== "off" && !isSelf ? { borderColor: cursorColor(user.id) } : undefined}
      data-tooltip={label}
      onClick={() => {
        if (!isSelf) onCycleCursorMode(user.id);
      }}
    >
      {imgFailed ? (
        <span className="presence-initial">{user.username.slice(0, 1).toUpperCase()}</span>
      ) : (
        <img
          src={mcHeadUrl(minecraftName)}
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
  cursorModes,
  onCycleCursorMode,
}: {
  online: OnlineUser[];
  selfId: number;
  cursorModes: Record<number, CursorDisplayMode>;
  onCycleCursorMode: (id: number) => void;
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
          mode={cursorModes[u.id] ?? "off"}
          onCycleCursorMode={onCycleCursorMode}
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
