// Which version of a trip's itinerary a booking follows (migration 033, Charlie 13 Nov 2026).
// '' is the current itinerary, the one the trip page shows. A trip can keep older editions, each with booked_before:
// bookings made before that moment follow it. booked_before null means the newer itinerary isn't live yet, so every
// booking still follows the older one.

export type Edition = { trip_slug: string; edition: string; booked_before: string | null };

export function editionFor(slug: string | null, bookedAt: unknown, editions: Edition[]): string {
  if (!slug) return "";
  const booked = typeof bookedAt === "string" ? Date.parse(bookedAt) : NaN;
  const older = editions
    .filter((e) => e.trip_slug === slug)
    .map((e) => ({ ...e, until: e.booked_before === null ? Infinity : Date.parse(e.booked_before) }))
    .sort((a, b) => a.until - b.until);
  for (const e of older) {
    // No booking time on record: an older edition is the safer guess for an old row.
    if (Number.isNaN(booked) || booked < e.until) return e.edition;
  }
  return "";
}
