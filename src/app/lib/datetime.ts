export type DateFormat = "MMM D, YYYY" | "D MMM YYYY" | "YYYY-MM-DD";

export type RuntimePreferences = {
  appearance: "system" | "light" | "dark";
  timezone: string;
  language: "en" | "es" | "fr" | "de";
  date_format: DateFormat;
};

const DEFAULT_PREFS: RuntimePreferences = {
  appearance: "system",
  timezone: "UTC",
  language: "en",
  date_format: "MMM D, YYYY",
};

let prefs: RuntimePreferences = readPrefs();
const listeners = new Set<() => void>();

function readPrefs(): RuntimePreferences {
  try {
    const raw = localStorage.getItem("zybble.preferences");
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function getRuntimePreferences() {
  return prefs;
}

export function setRuntimePreferences(next: Partial<RuntimePreferences>) {
  prefs = { ...prefs, ...next };
  try {
    localStorage.setItem("zybble.preferences", JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
  applyAppearance(prefs.appearance);
  listeners.forEach((fn) => fn());
}

export function subscribePreferences(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyAppearance(appearance = prefs.appearance) {
  const root = document.documentElement;
  const dark = appearance === "dark" || (appearance === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
}

export function formatAppDate(value: string | Date, options?: { includeTime?: boolean }) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const timeZone = prefs.timezone || "UTC";
  if (prefs.date_format === "YYYY-MM-DD") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(options?.includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(d);
    return parts;
  }
  const dayFirst = prefs.date_format === "D MMM YYYY";
  const parts = new Intl.DateTimeFormat(prefs.language === "en" ? "en-US" : prefs.language, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(options?.includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).formatToParts(d).reduce((acc, part) => {
    if (part.type === "literal") return acc;
    acc[part.type] = part.value;
    return acc;
  }, {} as Record<string, string>);
  return dayFirst ? `${parts.day} ${parts.month} ${parts.year}` : `${parts.month} ${parts.day}, ${parts.year}`;
}

export function relativeAppTime(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - d.getTime();
  const mins = Math.max(1, Math.floor(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatAppDate(d);
}

export const PREF_DEFAULTS = DEFAULT_PREFS;
