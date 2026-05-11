export function SensitiveBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-warn/40 bg-warn-soft text-warn px-3 py-2 text-sm">
      <span className="font-semibold">Sensitive data.</span>{" "}
      {children ??
        "You are viewing private user information. This access is logged and reviewable."}
    </div>
  );
}
