/* ------------------------------------------------------------------ */
/* Zybble app — domain types (frontend-only, API-ready shapes)         */
/* ------------------------------------------------------------------ */

export type OpenState = "open" | "closed" | "unknown";

export interface Lead {
  id: string;
  business_id: string;
  place_id: string;
  name: string;
  title: string;
  category: string;
  categories: string[];
  types: string[];
  description: string | null;
  rating: number;
  reviews: number;
  price: string | null;
  price_level: number | null;
  business_size: "unknown" | "small" | "medium" | "enterprise";
  employee_count: number | null;
  business_size_source: "unknown" | "provider" | "website";
  business_size_confidence: number;
  popular_times: unknown;
  phone: string;
  phone_normalized: string;
  email: string | null;
  emails: string[];
  website: string | null;
  website_domain: string | null;
  address: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  plus_code: string;
  hours: Record<string, string>;
  open_state: OpenState;
  hours_display: string;
  services: string[];
  service_options: string[];
  amenities: string[];
  attributes: string[];
  photos: number;
  thumbnail: string | null;
  logo: string | null;
  maps_url: string;
  google_maps_url: string;
  source: string;
  source_url: string;
  data_id: string;
  data_cid: string;
  kgmid: string;
  owner: string | null;
  owner_name: string | null;
  owner_link: string | null;
  booking_links: string[];
  menu_links: string[];
  social_links: string[];
  search_query: string;
  search_location: string;
  collected_at: string;
  updated_at: string;
  status: LeadStatus;
  tags: string[];
  notes: Note[];
  list_ids: string[];
}

export type LeadStatus = "new" | "contacted";

export interface Note {
  id: string;
  author: string;
  body: string;
  at: string;
}

export interface LeadList {
  id: string;
  name: string;
  description: string;
  color: string;
  lead_count: number;
  owner: string;
  created_at: string;
  updated_at: string;
  workspace_id: string;
}

export interface SearchRecord {
  id: string;
  query: string;
  location: string;
  results: number;
  status: "completed" | "partial" | "failed";
  list_id: string | null;
  saved: boolean;
  at: string;
}

export interface ExportRecord {
  id: string;
  file_name: string;
  source: string;
  leads: number;
  format: "CSV";
  status: "preparing" | "processing" | "completed" | "failed";
  created_at: string;
  completed_at: string | null;
}

export type Role = "owner" | "admin" | "member";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspace: string;
  status: "active" | "invited";
  joined_at: string;
  initials: string;
  tint: string;
}

export interface Workspace {
  id: string;
  name: string;
  owner: string;
  plan: string;
  members: number;
  leads_used: number;
  leads_limit: number;
  searches: number;
  lists: number;
  created_at: string;
}

export interface Invoice {
  id: string;
  date: string;
  description: string;
  amount: string;
  status: "paid" | "failed" | "upcoming";
}

export interface ActivityItem {
  id: string;
  kind:
    | "search"
    | "save"
    | "export"
    | "ai"
    | "invite"
    | "list"
    | "workspace";
  text: string;
  at: string;
}
