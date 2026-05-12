export default function SensitiveBanner({ reason }: { reason?: string }) {
  return (
    <div className="sensitive-banner">
      You are viewing sensitive user data. This access is logged.
      {reason ? (
        <>
          {" "}
          · Access reason: <strong>{reason}</strong>
        </>
      ) : null}
    </div>
  );
}
