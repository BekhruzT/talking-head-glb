import { useState } from "react";
import type { HeadInfo, InstalledHead } from "talking-head-glb/heads";
import "./motion-controls.css";

interface HeadPickerProps {
  heads: HeadInfo[];
  installed: InstalledHead[];
  selected?: string;
  /** Download progress (0 to 1) or the error message, by ref. */
  downloads: Record<string, number | string>;
  onSelect: (ref: string) => void;
  onDownload: (ref: string) => void;
}

export function HeadPicker({ heads, installed, selected, downloads, onSelect, onDownload }: HeadPickerProps) {
  const [open, setOpen] = useState(false);
  const rows = [...heads, ...installed.filter((head) => !heads.some(({ ref }) => ref === head.ref))];
  const current = rows.find((head) => head.ref === selected);

  return (
    <aside className="motion-controls head-picker">
      <button
        className="motion-controls__button"
        type="button"
        aria-label={`Avatar: ${current?.label ?? "none"}`}
        aria-expanded={open}
        aria-controls="head-options"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="motion-controls__icon" aria-hidden="true">◉</span>
        {current?.label ?? "Choose an avatar"}
        <span className="head-picker__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="motion-controls__panel" id="head-options">
          <h2>Avatar</h2>
          <p>Choose who you talk to, or download another head.</p>
          {rows.map((head) => {
            const progress = downloads[head.ref];
            return installed.some(({ ref }) => ref === head.ref) ? (
              <label className="motion-controls__option" key={head.ref}>
                <span>{head.label}</span>
                <input
                  type="radio"
                  name="head"
                  value={head.ref}
                  checked={head.ref === selected}
                  onChange={() => {
                    onSelect(head.ref);
                    setOpen(false);
                  }}
                />
              </label>
            ) : (
              <div className="motion-controls__option head-picker__missing" key={head.ref}>
                <span>{head.label}</span>
                {"browser" in head && head.browser ? (
                  <button
                    className="head-picker__download"
                    type="button"
                    aria-label={`Download ${head.label}`}
                    disabled={typeof progress === "number"}
                    onClick={() => onDownload(head.ref)}
                  >
                    {typeof progress === "number" ? `${Math.round(progress * 100)}%` : "Download"}
                  </button>
                ) : (
                  <code>npm run heads -- add {head.ref}</code>
                )}
                {typeof progress === "string" && <small role="alert">{progress}</small>}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
