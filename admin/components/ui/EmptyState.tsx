import type { ReactNode } from "react";

// EmptyState — centered placeholder for "no data" or "endpoint not
// deployed" cases. Includes a Botanic two-leaves SVG mark to keep the
// page from feeling broken when there's nothing to show.

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  cta?: ReactNode;
  tone?: "info" | "warning" | "danger";
}

const TONE_COLOR: Record<NonNullable<EmptyStateProps["tone"]>, string> = {
  info: "var(--accent)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export default function EmptyState({ title, description, cta, tone = "info" }: EmptyStateProps) {
  const color = TONE_COLOR[tone];
  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        textAlign: "center",
        gap: 12,
      }}
    >
      {/* Two leaves placeholder — kept inline so we don't ship an asset */}
      <svg
        width="72"
        height="72"
        viewBox="0 0 72 72"
        aria-hidden="true"
        style={{ marginBottom: 4 }}
      >
        <title>Botanic leaves placeholder</title>
        <path
          d="M22 46 C 18 30, 30 20, 44 22 C 42 36, 32 46, 22 46 Z"
          fill={color}
          fillOpacity="0.16"
          stroke={color}
          strokeWidth="1.4"
        />
        <path
          d="M44 22 C 30 26, 22 36, 22 46"
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          strokeOpacity="0.7"
        />
        <path
          d="M48 48 C 44 38, 50 30, 60 30 C 60 40, 56 48, 48 48 Z"
          fill={color}
          fillOpacity="0.10"
          stroke={color}
          strokeWidth="1.2"
        />
      </svg>
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontWeight: 600,
          color: "var(--fg)",
        }}
      >
        {title}
      </h3>
      {description ? (
        <div style={{ color: "var(--fg-muted)", maxWidth: 480, fontSize: 13 }}>{description}</div>
      ) : null}
      {cta ? <div style={{ marginTop: 6 }}>{cta}</div> : null}
    </div>
  );
}
