import { useState } from "react";
import { MotionSettings } from "./avatar/motion-settings";
import "./motion-controls.css";

type MotionKey = keyof MotionSettings;

const options: { key: MotionKey; label: string }[] = [
  { key: "headMovementEnabled", label: "Head & neck" },
  { key: "gazeEnabled", label: "Eye gaze" },
  { key: "expressionsEnabled", label: "Facial expressions" },
  { key: "blinkingEnabled", label: "Blinking" },
];

interface MotionControlsProps {
  settings: MotionSettings;
  onChange: (key: MotionKey, enabled: boolean) => void;
}

export function MotionControls({ settings, onChange }: MotionControlsProps) {
  const [open, setOpen] = useState(false);

  return (
    <aside className="motion-controls">
      <button
        className="motion-controls__button"
        type="button"
        aria-expanded={open}
        aria-controls="motion-options"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="motion-controls__icon" aria-hidden="true">✦</span>
        Motion
      </button>
      {open && (
        <div className="motion-controls__panel" id="motion-options">
          <h2>Avatar motion</h2>
          <p>Choose how Ava moves.</p>
          {options.map(({ key, label }) => (
            <label className="motion-controls__option" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(event) => onChange(key, event.target.checked)}
              />
            </label>
          ))}
        </div>
      )}
    </aside>
  );
}
