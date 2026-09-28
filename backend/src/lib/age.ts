/** Calendar age in UTC; date-only birthdays do not depend on server timezone.
 * February 29 birthdays advance on March 1 in non-leap years.
 */
export function ageOnDate(dob: Date, now = new Date()): number {
  if (!Number.isFinite(dob.getTime()) || !Number.isFinite(now.getTime())) {
    throw new RangeError("invalid_date");
  }
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  return now.getUTCFullYear() - dob.getUTCFullYear() - Number(beforeBirthday);
}
