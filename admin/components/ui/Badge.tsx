import type { ReactNode } from "react";

// Badge — visual chip used for status, counts, and category tags. Wraps
// the existing `.badge` CSS class but normalizes the variant API so
// callers don't have to remember which raw class name maps to which
// color. Variants intentionally lean on Botanic palette already defined
// in globals.css.
export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  title?: string;
  className?: string;
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  default: "",
  success: "active", // moss
  warning: "under_review", // honey
  danger: "removed", // safety red
  info: "reviewing", // honey-leaning info
};

export default function Badge({ variant = "default", children, title, className }: BadgeProps) {
  const variantClass = VARIANT_CLASS[variant];
  const cls = ["badge", variantClass, className].filter(Boolean).join(" ");
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
