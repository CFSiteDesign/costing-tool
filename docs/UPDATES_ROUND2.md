# Costing Tool Updates — round 2

> Client feedback document received 27 Aug 2026. Verbatim transcription; decisions and status live in `../IMPLEMENTATION_PLAN.md`.

Admin Interface
## Quote builder
## 1. Stay has no nights option
A quote is broken down day by day, so one day is one night. Five nights in a hostel is five day rows, not a nights field on one row.
- Remove any nights input from the stay line
- Maximum one stay row per day
- Warn if a day in the middle of a stop has no stay row
## 2. Copy day button
Copies accommodation and breakfast onto the next day only. Nothing else.
- Experiences and transport do not copy. They change day to day, and copying them means deleting them again.
- Next day only. No date range.
- Date advances by one, location carries over.
- Button label says what it does: "Copy stay and breakfast to next day"
## 3. Day 1 date sets the weekday
When the date on day 1 is 09/10/2026, the experience picker opens on Friday by default. No manually working out the weekday and choosing it from a list.
Same on every following day, from that day's date.
## 4. Day 2 inherits from day 1
Next day defaults to the next date and the same location. Both stay editable.
## 5. Transport time slots
Transport is picked from available time slots, not free text. Any time can be entered at the moment.
## 6. Exit and save draft on quote creation
An exit route out of the quote builder, saving as a draft rather than losing the work.
## 7. Search on the quotes main page
Search box to find a quote.
## Currency
Products can be priced in local currency or USD. Every output is USD.
- Rate field on a product takes an amount and a currency, so a Bangkok GM enters baht OR USD
- Rate column on the experience list shows local currency with the USD figure alongside
- Quotes, totals and anything client facing are USD only
- Store the local amount and the rate used, so a price is traceable back to what the GM typed
- Set where the FX rate comes from and how often it refreshes
## Pax against capacity
- Capacity on the product: maximum pax, and minimum to run, if NA leave blank
- Warning when a quote's pax is over the capacity of any experience on it
- Warning, not a block. A group of 20 may split across two departures.
## Auto create a trip
Second way in alongside the manual builder.
Input: locations in order, and the dates in each hostel.
Output: every day generated, each with the experiences available at that property on that weekday, ordered by time, for the user to pick from.
Copy a whole trip to a new quote
Either the ability to copy a whole trip to a new quote OR the ability to save a quote as a template trip.
## Experiences, global events
Add a product at global level rather than under one property.
- Pushes to every GM dashboard as an event to accept or decline
- One view showing who accepted, who declined, who has not responded
GM interface
## 1. Day view on the experiences table
New tab called ‘’My week’’
- Left column is the day. Under each day, one row per experience.
- Each row shows experience name, time, price.
- More than one experience that day means more rows under that day.
- Sort experiences within a day by start time.
- A daily tour appears under every day it runs
- One off events+ global events  show on here too.
Clicking a row opens that product's detail page.
SIMILAR TO THIS
## 2. Product detail page is editable
The detail page holds the description and the product fields, all editable in place, with a save button.
Save shows a confirmation so the GM knows it saved. No silent saves.
## 3. Back button on add product
Add a back button to the add product flow.
If fields have been filled in, warn before leaving so nothing is lost.
Add a ‘’One time event’’ check box, if this check box is ticket add an expiry date, once product has expired it does not show as activity or on the ‘’My table’’
## 4. Active or Paused set at creation
The add product form needs an Active / Paused choice. The GM sets the state when the product is created, not afterwards on the list.
## 5. ASSET column
New column on the experience list, next to Active. One button per row.
The button deep links into STUDIO (mad-monkey-studio.vercel.app) with that row's data prefilled. No second asset generator inside the costing tool.
Fields passed through the link:
- Tour name
- Day
- Key time, where a time matters
- Price
- Short description
Nothing else from the record gets passed. STUDIO opens ready to generate, GM finishes and downloads there.
Dependency: STUDIO needs to accept these as URL parameters and prefill from them.
Finished asset saves back to the row
The asset attaches to the experience record once it is made, so the same pub crawl graphic is not rebuilt every week.
- The row shows the latest asset and the date it was created
- ASSET button reads "View" where an asset already exists, with rebuild as a second option
- Editing name, day, time or price marks the saved asset out of date, so the GM knows to rebuild that one
STUDIO posts the finished file back automatically
6. Last verified date
New column on the experience list showing the date each experience was last verified.