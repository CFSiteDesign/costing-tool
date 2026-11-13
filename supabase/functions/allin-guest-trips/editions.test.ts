import { assertEquals } from "jsr:@std/assert@1";
import { type Edition, editionFor } from "./editions.ts";

const OLD: Edition = { trip_slug: "cambodia", edition: "via-sihanoukville", booked_before: null };

Deno.test("no older editions: every booking follows the current itinerary", () => {
  assertEquals(editionFor("laos", "2026-11-01T00:00:00Z", [OLD]), "");
  assertEquals(editionFor(null, "2026-11-01T00:00:00Z", [OLD]), "");
});

Deno.test("new itinerary not live yet: every booking keeps the old one", () => {
  assertEquals(editionFor("cambodia", "2026-09-01T00:00:00Z", [OLD]), "via-sihanoukville");
  assertEquals(editionFor("cambodia", "2026-12-01T00:00:00Z", [OLD]), "via-sihanoukville");
});

Deno.test("once live: bookings before the switch keep the old route, later ones get the new", () => {
  const live = [{ ...OLD, booked_before: "2026-11-13T10:00:00Z" }];
  assertEquals(editionFor("cambodia", "2026-11-13T09:59:59Z", live), "via-sihanoukville");
  assertEquals(editionFor("cambodia", "2026-11-13T10:00:00Z", live), "");
  assertEquals(editionFor("cambodia", "2026-11-20T00:00:00Z", live), "");
});

Deno.test("no booking time on record: the older edition", () => {
  const live = [{ ...OLD, booked_before: "2026-11-13T10:00:00Z" }];
  assertEquals(editionFor("cambodia", undefined, live), "via-sihanoukville");
  assertEquals(editionFor("cambodia", "not a date", live), "via-sihanoukville");
});

Deno.test("several older editions: the earliest one the booking fits", () => {
  const eds: Edition[] = [
    { trip_slug: "cambodia", edition: "second", booked_before: "2027-03-01T00:00:00Z" },
    { trip_slug: "cambodia", edition: "first", booked_before: "2026-11-13T00:00:00Z" },
  ];
  assertEquals(editionFor("cambodia", "2026-10-01T00:00:00Z", eds), "first");
  assertEquals(editionFor("cambodia", "2027-01-01T00:00:00Z", eds), "second");
  assertEquals(editionFor("cambodia", "2027-04-01T00:00:00Z", eds), "");
});
