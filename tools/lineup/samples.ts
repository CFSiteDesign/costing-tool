// The three reference weeks from the Claude Design brief (Siargao normal week, Pai big band + no prices,
// and the stress test: a 6-item day and an 8-item EVERY DAY band). Used by render_samples.ts and the tests.
// @deno-types="../../supabase/functions/_shared/lineup/engine.d.ts"
import type { LineupWeek } from "../../supabase/functions/_shared/lineup/engine.js";

const it = (name: string, time: string | null, price: number | null, signature = false) => ({ name, time, price, signature, key: false });

export const SIARGAO: LineupWeek = {
  hostel: "Siargao", dates: "23-29 Nov", currency: "₱",
  everyDay: [it("The Meet Up", "7PM", 0)],
  days: [
    { day: "MON", date: "23", items: [it("Mad Monkey Adventure Land Tour", "11:45AM", 2200), it("Pub Quiz", "7PM", 0)] },
    { day: "TUE", date: "24", items: [it("Mad Monkey Adventure Land Tour", "11:45AM", 2200), it("Flip Cup", "7PM", 0)] },
    { day: "WED", date: "25", items: [it("Tri Island Party Boat Tour", "8:45AM", 2800, true), it("Challenge Night", "7PM", 0)] },
    { day: "THU", date: "26", items: [it("Mad Monkey Adventure Land Tour", "11:45AM", 2200), it("Beer Pong", "7PM", 0)] },
    { day: "FRI", date: "27", items: [it("Mad Monkey Adventure Land Tour", "11:45AM", 2200), it("Music Quiz", "7PM", 0)] },
    { day: "SAT", date: "28", items: [it("Tri Island Party Boat Tour", "8:45AM", 2800, true), it("Games Night", "7PM", 0)] },
    { day: "SUN", date: "29", items: [it("Mad Monkey Adventure Land Tour", "11:45AM", 2200), it("Killer Pool", "7PM", 0)] },
  ],
};

export const PAI: LineupWeek = {
  hostel: "Pai", dates: "23-29 Nov", currency: "฿",
  everyDay: [
    it("3 Days session muay thai Training", "10AM", null), it("Full Day Scenery Tour", "10AM", null),
    it("Lod Cave Day Tour", "12PM", null), it("Half Day Scenery Tour", "1PM", null, true),
    it("Sunset Trip", "4:30PM", null), it("Panorama Sunset", "5:30PM", null), it("The Meet Up", "7PM", null),
  ],
  days: [
    { day: "MON", date: "23", items: [it("Pub quiz", "8PM", null)] },
    { day: "TUE", date: "24", items: [it("Pai Tipsy Tubing", "1PM", null), it("Karaoke", "8PM", null)] },
    { day: "WED", date: "25", items: [it("Tipsy Bingo", "8PM", null)] },
    { day: "THU", date: "26", items: [] },
    { day: "FRI", date: "27", items: [it("Pai Tipsy Tubing", "1PM", null), it("Karaoke", "8PM", null)] },
    { day: "SAT", date: "28", items: [] },
    { day: "SUN", date: "29", items: [] },
  ],
};

export const STRESS: LineupWeek = {
  hostel: "Nacpan Beach", dates: "29 Dec-4 Jan", currency: "₱",
  everyDay: [
    it("The Meet Up", "7PM", 0), it("Sunrise Yoga On The Beach", "6:30AM", 350), it("Island Hopping Tour A", "9AM", 1800, true),
    it("Beach Volleyball", "4PM", 0), it("Sunset Session", "5:30PM", 0), it("Family Dinner", "7:30PM", 250),
    it("Beer Pong Tournament", "9PM", 0), it("Late Night Bonfire", "11PM", 0),
  ],
  days: [
    { day: "MON", date: "29", items: [
      it("Nacpan To El Nido Day Trip With Lunch Included", "8AM", 2500, true), it("Kayak Hire", "10AM", 500),
      it("Mad Monkey Adventure Land Tour", "11:45AM", 2200), it("Pub Quiz", "7PM", 0),
      it("Karaoke Night", "9PM", 0), it("Glow Party", "10PM", 300),
    ] },
    { day: "TUE", date: "30", items: [it("Flip Cup", "7PM", 0)] },
    { day: "WED", date: "31", items: [it("New Year's Eve White Party", "8PM", 1500, true), it("Countdown Fireworks", "11:45PM", 0)] },
    { day: "THU", date: "1", items: [] },
    { day: "FRI", date: "2", items: [it("Music Quiz", "7PM", 0), it("Beer Olympics", "8PM", 0), it("Killer Pool", "9PM", 0)] },
    { day: "SAT", date: "3", items: [it("Games Night", "7PM", 0)] },
    { day: "SUN", date: "4", items: [] },
  ],
};
