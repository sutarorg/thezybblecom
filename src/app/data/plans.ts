/* ------------------------------------------------------------------ */
/* Zybble — product configuration (NOT demo data).                     */
/* Plan capabilities mirror the `plans` table in Postgres, which is    */
/* the server-side source of truth for every entitlement check.        */
/* ------------------------------------------------------------------ */

export type PlanId = "free" | "growth" | "agency" | "scale";

export type PlanCapability = {
  id: PlanId;
  label: string;
  priceCents: number;
  leadAllowance: number;
  maxLists: number; // -1 = unlimited
  maxUsers: number;
  ai: boolean;
  clientWorkspaces: boolean;
  priorityProcessing: boolean;
};

export const PLAN_CATALOG: Record<PlanId, PlanCapability> = {
  free: {
    id: "free",
    label: "Free",
    priceCents: 0,
    leadAllowance: 50,
    maxLists: 1,
    maxUsers: 1,
    ai: true,
    clientWorkspaces: false,
    priorityProcessing: false,
  },
  growth: {
    id: "growth",
    label: "Growth",
    priceCents: 4900,
    leadAllowance: 5000,
    maxLists: -1,
    maxUsers: 1,
    ai: true,
    clientWorkspaces: false,
    priorityProcessing: false,
  },
  agency: {
    id: "agency",
    label: "Agency",
    priceCents: 9900,
    leadAllowance: 15000,
    maxLists: -1,
    maxUsers: 3,
    ai: true,
    clientWorkspaces: true,
    priorityProcessing: false,
  },
  scale: {
    id: "scale",
    label: "Scale",
    priceCents: 19900,
    leadAllowance: 50000,
    maxLists: -1,
    maxUsers: 5,
    ai: true,
    clientWorkspaces: true,
    priorityProcessing: true,
  },
};

export function planFromId(id: string | null | undefined): PlanCapability {
  const key = (id ?? "free").toLowerCase() as PlanId;
  return PLAN_CATALOG[key] ?? PLAN_CATALOG.free;
}

export function planLabel(id: string | null | undefined) {
  return planFromId(id).label;
}

/* ------------------------------------------------------------------ */
/* Search form configuration                                           */
/* ------------------------------------------------------------------ */
export const RATING_OPTIONS = [
  { value: "", label: "Any rating" },
  { value: "3", label: "3.0+" },
  { value: "3.5", label: "3.5+" },
  { value: "4", label: "4.0+" },
  { value: "4.5", label: "4.5+" },
];

export const PRICE_OPTIONS = [
  { value: "", label: "Any price" },
  { value: "1", label: "$" },
  { value: "2", label: "$$" },
  { value: "3", label: "$$$" },
  { value: "4", label: "$$$$" },
];

export const RADIUS_OPTIONS = [
  { value: "", label: "Default area" },
  { value: "5", label: "Within ~5 km" },
  { value: "10", label: "Within ~10 km" },
  { value: "25", label: "Within ~25 km" },
  { value: "50", label: "Within ~50 km" },
];

export const SORT_OPTIONS = [
  { value: "relevance", label: "Most relevant" },
  { value: "rating", label: "Highest rated" },
  { value: "reviews", label: "Most reviewed" },
];

export const QUANTITY_PRESETS = [25, 50, 100, 200];

/** Upper bound enforced by the search Edge Function per run. */
export const MAX_LEADS_PER_SEARCH = 240;
