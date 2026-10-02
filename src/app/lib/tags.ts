export const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function normalizeTag(input: string): string {
  return input.trim().toLowerCase();
}

export function validateTag(input: string): { ok: true; tag: string } | { ok: false; error: string } {
  const tag = normalizeTag(input);
  if (!tag) return { ok: false, error: "Enter a tag." };
  if (/\s/.test(tag)) return { ok: false, error: "Tags must be one word — no spaces." };
  if (!TAG_PATTERN.test(tag)) {
    return { ok: false, error: "Tags can use lowercase letters, numbers, hyphens, and underscores only." };
  }
  return { ok: true, tag };
}

export function mergeTags(existing: string[], additions: string[]): string[] {
  const out: string[] = [];
  for (const raw of [...existing, ...additions]) {
    const checked = validateTag(raw);
    if (checked.ok && !out.includes(checked.tag)) out.push(checked.tag);
  }
  return out;
}
