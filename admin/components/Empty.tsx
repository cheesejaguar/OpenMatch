export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-8 text-center text-ink-500">
      <div className="font-medium text-ink-700">{title}</div>
      {hint ? <div className="text-sm mt-1">{hint}</div> : null}
    </div>
  );
}
