import Link from "next/link";

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ missing?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center bg-ink-100">
      <div className="card p-8 max-w-md text-center">
        <div className="text-3xl">403</div>
        <h1 className="text-xl font-semibold mt-2">Forbidden</h1>
        <p className="text-sm text-ink-500 mt-2">
          Your role does not include the required permission
          {sp.missing ? <code className="mx-1">{sp.missing}</code> : null}
          to access this resource. Ask a System Admin if you need elevated access.
        </p>
        <Link href="/overview" className="btn-primary mt-4 inline-flex">
          Back to overview
        </Link>
      </div>
    </main>
  );
}
