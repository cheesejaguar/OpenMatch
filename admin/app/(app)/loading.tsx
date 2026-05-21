import Skeleton from "../../components/ui/Skeleton";

// PERF-A1: route-level fallback. When a user navigates between admin
// pages, this skeleton renders inside <main> while the new route
// segment streams. Individual pages then layer their own Suspense
// boundaries on top of this for finer-grained streaming.
export default function AppLoading() {
  return (
    <div>
      <div className="page-header">
        <h2>
          <Skeleton width={160} height={24} />
        </h2>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <Skeleton height={220} />
      </div>
    </div>
  );
}
