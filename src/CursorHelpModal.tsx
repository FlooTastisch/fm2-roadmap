interface Props {
  onClose: () => void;
  onDontShowAgain: () => void;
}

/** Hinweis zu den drei Cursor-Modi. Das X schließt nur für diese Sitzung;
 *  erst „Nicht mehr anzeigen“ speichert die Entscheidung im Browser. */
export function CursorHelpModal({ onClose, onDontShowAgain }: Props) {
  return (
    <div className="modal-backdrop cursor-help-backdrop" onClick={onClose}>
      <div
        className="modal cursor-help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cursor-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="cursor-help-close"
          aria-label="Schließen"
          title="Schließen – beim nächsten Aufruf wieder anzeigen"
          onClick={onClose}
        >
          ×
        </button>

        <h2 id="cursor-help-title">Live-Cursor anderer Nutzer</h2>
        <p>
          Klicke oben auf den Kopf eines angemeldeten Nutzers, um zwischen drei
          Anzeigearten zu wechseln:
        </p>

        <div className="cursor-help-modes">
          <div className="cursor-help-mode mode-off">
            <span className="cursor-help-icon">×</span>
            <strong>Aus</strong>
            <span>Cursor und Aktionen werden nicht angezeigt.</span>
          </div>
          <div className="cursor-help-mode mode-action">
            <span className="cursor-help-icon">▣</span>
            <strong>Nur bei Aktion</strong>
            <span>Zeigt nur, welche Aufgabe oder Zelle angeklickt wird.</span>
          </div>
          <div className="cursor-help-mode mode-always">
            <span className="cursor-help-icon">➤</span>
            <strong>Immer sichtbar</strong>
            <span>Zeigt Mauszeiger und Aktionen live an.</span>
          </div>
        </div>

        <p className="cursor-help-note">
          Cursor von Mitarbeitern werden automatisch übertragen. Nur Administratoren
          können die Übertragung ihres eigenen Cursors über „Cursor teilen“ für maximal
          60 Minuten aktivieren und jederzeit wieder beenden.
        </p>

        <div className="modal-actions cursor-help-actions">
          <button type="button" className="link-button" onClick={onDontShowAgain}>
            Nicht mehr anzeigen
          </button>
          <span className="spacer" />
          <button type="button" className="primary" onClick={onClose}>
            Verstanden
          </button>
        </div>
      </div>
    </div>
  );
}
