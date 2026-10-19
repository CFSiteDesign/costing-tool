# ALL IN guest trips API

For Dhany (Loyalty app) and Ayush (main website, WhatsApp). 19 Oct 2026.

Every ALL IN booking, with its day-by-day on real dates, so a guest can see where
to be each day and nobody misses a boat or a transfer. Bookings are synced from
the ALL IN site into the Experience Database every 5 minutes; the day-by-day
comes from the ALL IN trip pages.

## Call it

```
POST https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/allin-guest-trips
x-api-key: <your key>
Content-Type: application/json
```

Each app gets its own key, made by an admin in the Experience Database under
**Settings > ALL IN guest trips**. It is shown once, so store it as a server
secret. Server to server only: never put the key in a browser or a mobile app
bundle (there are no CORS headers on purpose). A revoked key stops working
straight away.

| Body | Returns |
| --- | --- |
| `{ "email": "guest@example.com" }` | That guest's ALL IN trips, as the lead booker or a named traveller. Case-insensitive. Use this for the Loyalty account page. |
| `{ "emails": ["a@x.com", "b@y.com"] }` | The same for up to 100 guests. |
| `{ "booking_ref": "SOL-LAO-001" }` | One booking. |
| `{ "date": "2026-11-24" }` | Every confirmed guest on an ALL IN trip that day (from their arrival day to their last day), each with `on_date`: which day of the trip it is and that day's plan. Use this for the daily WhatsApp messages. |

Errors: `401` missing, wrong or revoked key; `400` bad body.

## Response

```json
{
  "count": 1,
  "bookings": [
    {
      "booking_ref": "SOL-LAO-001",
      "role": "lead",
      "status": "confirmed",
      "payment_state": "deposit_paid",
      "trip": { "slug": "laos", "name": "ALL IN · Laos Ultimate", "country": "Laos", "days": 10, "nights": 9 },
      "departure": { "date": "2026-11-22", "end_date": "2026-12-01", "status": "confirmed" },
      "arrival": { "date": "2026-11-21", "note": "Arrive the day before Day 1 and check in at the first hostel." },
      "spots": 1,
      "traveller_mode": "independent",
      "solo": true,
      "lead": { "name": "Sam Rivers", "first_name": "Sam", "last_name": "Rivers", "email": "sam@example.com", "phone": "+44 7700 900000", "country": null, "age": null },
      "whatsapp": { "opt_in": true, "opted_in_at": "2026-10-20T09:11:40Z", "scope": "trip_updates", "phone": "+44 7700 900000" },
      "travellers": [ { "spot": 1, "is_lead": true, "name": "Sam Rivers", "email": "sam@example.com", "age": null, "dietary": null } ],
      "payment": { "currency": "USD", "type": "deposit", "total": 400, "paid": 99, "balance_due": 301, "balance_due_date": "2026-11-15", "balance_status": "scheduled" },
      "codes": { "discount_code": null, "creator_code": null, "squad_code": null },
      "source": { "utm_source": "instagram", "advisor_ref": null },
      "days": [
        { "day_from": 1, "day_to": 1, "label": "Day 1", "date_from": "2026-11-22", "date_to": "2026-11-22",
          "place": "Luang Prabang", "plan": "Check in to Mad Monkey Luang Prabang, roam the Old Town...",
          "transport": null, "activities": null, "meals": null },
        { "day_from": 4, "day_to": 4, "label": "Day 4", "date_from": "2026-11-25", "date_to": "2026-11-25",
          "place": "Luang Prabang → Nong Khiaw", "plan": "Mountain camp. Road trip north...", "transport": "Minivan", "activities": null, "meals": null }
      ],
      "synced_at": "2026-10-20T09:15:00Z"
    }
  ]
}
```

(Shortened. Every booking has all its days.) A `date` lookup adds:

```json
"on_date": { "date": "2026-11-25", "day": 4, "is_arrival_day": false, "plan": { "label": "Day 4", "place": "Luang Prabang → Nong Khiaw", "...": "..." } }
```

`day` is 0 and `is_arrival_day` true on the day before Day 1.

## Fields worth knowing

| Field | What it is |
| --- | --- |
| `status` | `confirmed` or `cancelled`. Email and ref lookups include cancelled trips; date lookups don't. |
| `payment_state` | `deposit_paid`, `paid_in_full`, `balance_failed` (retrying), `balance_failed_final`, `cancelled`, `refunded`. |
| `days[]` | The day-by-day. An entry can cover several days (`day_from` to `day_to`, e.g. Indonesia's "Days 10–12"). |
| `whatsapp.opt_in` | The checkout box: "Keep me posted on WhatsApp ... Trip updates only. Opt out anytime." Trip updates, not marketing. Asked from 13 Oct 2026; earlier bookings are `false`. |
| `travellers[]` | One per spot. The main trip pages only ask for the lead booker's details, so other spots are usually empty and crew members won't match on their own email. |
| `role` | On email lookups: whether that email is the lead booker or a named traveller. |
| `synced_at` | When this booking last came over from the ALL IN site (every 5 minutes). |

## How it fits together

- ALL IN site (bookings, payments) → every 5 minutes → Experience Database
  (`allin_bookings`, next to `allin_trip_days`) → this endpoint → Loyalty app,
  main website, WhatsApp.
- The sync signs its requests to the ALL IN site with a key that never leaves
  the Experience Database; no password is shared between the two.
- Itinerary changes on the trip pages are reloaded with
  `mm-squad-trips/tools/export-itineraries.ts` (see that file).
