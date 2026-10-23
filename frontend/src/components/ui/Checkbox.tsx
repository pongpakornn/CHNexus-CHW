"use client";

import { useId } from "react";

// ☑ Checkbox แบบวาดเครื่องหมายถูก (สไตล์ .cbx ใน globals.css) - ใช้แทน <input type="checkbox">
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className={`inline-flex items-center gap-2.5 text-sm font-bold ${disabled ? "opacity-60" : ""}`}>
      <input id={id} type="checkbox" className="cbx-input sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="cbx">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M1,9 L1,3.5 C1,2 2,1 3.5,1 L14.5,1 C16,1 17,2 17,3.5 L17,14.5 C17,16 16,17 14.5,17 L3.5,17 C2,17 1,16 1,14.5 L1,9 Z" />
          <polyline points="1 9 7 14 15 4" />
        </svg>
      </label>
      {label && (
        <label htmlFor={id} className={disabled ? "cursor-not-allowed" : "cursor-pointer"}>
          {label}
        </label>
      )}
    </span>
  );
}
