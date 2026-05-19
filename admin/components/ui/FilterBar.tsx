import type { ReactNode } from "react";

// FilterBar — flex row of inputs. State is owned by the parent (form-
// based or client-state); FilterBar just provides consistent layout +
// the "Apply / Reset" affordance area on the right.

export interface FilterBarProps {
  children: ReactNode;
  action?: ReactNode;
}

export default function FilterBar({ children, action }: FilterBarProps) {
  return (
    <div className="toolbar" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
      {children}
      {action ? <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>{action}</div> : null}
    </div>
  );
}
