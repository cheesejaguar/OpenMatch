// Formats a distance in kilometers for display to other users.
//
// **This is the only sanctioned way to render distance.** Bypassing it is
// a privacy bug. See docs/privacy/principles.md §3.
//
// The function deliberately quantizes — exact distances ("0.2 miles away")
// have been used in the past to triangulate other users' locations.

export interface FormattedDistance {
  miles: number;
  text: string;
}

export function formatDistance(
  km: number,
  locale: "imperial" | "metric" = "imperial",
): FormattedDistance {
  const miles = km * 0.621371;
  if (locale === "metric") {
    const kmRounded = bucketKm(km);
    return {
      miles,
      text: kmRounded === 0 ? "Nearby" : kmRounded === 1 ? "Within 1 km" : `${kmRounded} km away`,
    };
  }
  const m = bucketMiles(miles);
  return {
    miles,
    text: m === 0 ? "Nearby" : m === 1 ? "Within 1 mile" : `${m} miles away`,
  };
}

function bucketMiles(m: number): number {
  if (m < 1) return 0;
  if (m < 2) return 1;
  if (m < 5) return Math.round(m);
  if (m < 25) return Math.round(m / 2) * 2;
  if (m < 100) return Math.round(m / 5) * 5;
  return Math.round(m / 10) * 10;
}

function bucketKm(km: number): number {
  if (km < 1) return 0;
  if (km < 2) return 1;
  if (km < 5) return Math.round(km);
  if (km < 25) return Math.round(km / 2) * 2;
  if (km < 100) return Math.round(km / 5) * 5;
  return Math.round(km / 10) * 10;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
