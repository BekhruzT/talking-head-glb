import { useState } from "react";
import "./motion-controls.css";

interface HeadPickerProps {
  heads: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
}

export function HeadPicker({ heads, selected, onSelect }: HeadPickerProps) {
  const [open, setOpen] = useState(false);
  const current = heads.find((head) => head.id === selected);

  return (
    <aside className="motion-controls head-picker">
      <button
        className="motion-controls__button"
        type="button"
        aria-label={`Avatar: ${current?.label}`}
        aria-expanded={open}
        aria-controls="head-options"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="motion-controls__icon" aria-hidden="true">◉</span>
        {current?.label}
        <span className="head-picker__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="motion-controls__panel" id="head-options">
          <h2>Avatar</h2>
          <p>Choose who you talk to.</p>
          {heads.map(({ id, label }) => (
            <label className="motion-controls__option" key={id}>
              <span>{label}</span>
              <input
                type="radio"
                name="head"
                value={id}
                checked={id === selected}
                onChange={() => {
                  onSelect(id);
                  setOpen(false);
                }}
              />
            </label>
          ))}
        </div>
      )}
    </aside>
  );
}
