export type Category = "mm_tour" | "nightly_event" | "third_party_tour" | "one_time_event" | "transport";
export type ProductStatus = "active" | "paused" | "signature" | "pending_update";
export type SeasonTier = "lean" | "mid" | "high";
export type Role = "admin" | "head_office" | "gm" | "sales";

export const CATEGORY_LABELS: Record<Category, string> = {
  mm_tour: "MM Tours",
  nightly_event: "Nightly Events",
  third_party_tour: "3rd Party Tours",
  one_time_event: "One-Time Events",
  transport: "Transport",
};

export const STATUS_LABELS: Record<ProductStatus, string> = {
  active: "Active",
  paused: "Paused",
  signature: "Signature",
  pending_update: "Pending",
};

export interface Location { id: string; name: string; country: string; timezone: string; currency: string; }
export interface RoomType { id: string; code: string; name: string; sort_order: number; is_sample: boolean; }

export interface Product {
  id: string;
  location_id: string;
  category: Category;
  title: string;
  operator_id: string | null;
  rate_usd: number | null;
  rate_raw: string | null;
  local_amount: number | null;
  local_currency: string | null;
  fx_rate_used: number | null;
  fx_as_of: string | null;
  gross_service_value: string | null;
  active_on_ground: boolean;
  bookable_on_website: boolean;
  status: ProductStatus;
  days_of_week: number[];
  availability_raw: string | null;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number | null;
  min_guests: number | null;
  max_guests_per_day: number | null;
  brief_description: string | null;
  long_description: string | null;
  meeting_point: string | null;
  inclusions: string | null;
  exclusions: string | null;
  things_to_bring: string | null;
  cancellation_policy: string | null;
  itinerary: string | null;
  travel_insurance_required: boolean;
  photo_album_url: string | null;
  remarks: string | null;
  rezdy_reference: string | null;
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  day_id: string | null;
  sort_order: number;
  kind: "accommodation" | "breakfast" | "experience" | "transport" | "custom";
  source_product_id: string | null;
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  room_type_id: string | null;
  season: SeasonTier | null;
  qty: number;
  unit_price_usd: number;
  per_person: boolean;
  pax: number | null;
  discount_pct: number | null;
  discount_amount_usd: number | null;
  is_comp: boolean;
  line_total_usd: number;
  adjustment_note: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  reference: string;
  customer_id: string | null;
  title: string;
  status: "draft" | "sent" | "accepted" | "cancelled";
  owner_id: string | null;
  pax_count: number;
  created_at: string;
}

export const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
