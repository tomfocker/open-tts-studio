import { AlertCircle, X } from "lucide-react";

export type ConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmationDialogProps = {
  request: ConfirmationRequest;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({ request, onCancel, onConfirm }: ConfirmationDialogProps) {
  const isDanger = request.tone === "danger";
  const titleId = "app-confirmation-title";
  const descriptionId = "app-confirmation-description";

  return (
    <div
      className="settingsOverlay confirmationOverlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className={isDanger ? "settingsDialog confirmationDialog danger" : "settingsDialog confirmationDialog"}>
        <header className="settingsHeader confirmationHeader">
          <div className="settingsHeaderIdentity">
            <span className="settingsHeaderIcon confirmationIcon"><AlertCircle size={20} strokeWidth={1.9} /></span>
            <div className="settingsHeaderCopy">
              <span className="settingsHeaderEyebrow">操作确认</span>
              <strong id={titleId}>{request.title}</strong>
            </div>
          </div>
          <button type="button" className="modalClose" title="取消" aria-label="取消确认" onClick={onCancel}>
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div id={descriptionId} className="confirmationBody">
          <p>{request.message}</p>
        </div>

        <footer className="settingsFooter confirmationFooter">
          <button type="button" className="secondaryAction settingsAction" onClick={onCancel}>取消</button>
          <span className="settingsFooterSpacer" />
          <button type="button" className={isDanger ? "confirmationDangerAction settingsAction" : "primaryAction settingsAction"} onClick={onConfirm}>
            {request.confirmLabel ?? "确认"}
          </button>
        </footer>
      </section>
    </div>
  );
}
