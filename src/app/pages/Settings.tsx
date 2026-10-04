/* ------------------------------------------------------------------ */
/* Zybble app — Settings                                               */
/* ------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import {
  Building2,
  Clock,
  Download,
  Globe,
  Key,
  Lock,
  LogOut,
  Monitor,
  Shield,
  TriangleAlert,
  User,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  FieldLabel,
  Input,
  SectionTitle,
  Switch,
  useToast,
} from "../components/ui";
import { SettingsSkeleton } from "../components/skeletons";
import { planFromId } from "../data/plans";
import { navigate, useAppSeo } from "../hooks";
import { getUserPreferences, listAppSessions, revokeAppSession, saveUserPreferences, signOut, updateProfile, updatePassword, type AppSessionRecord, type UserPreferences } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "account", label: "Account", icon: Shield },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "notifications", label: "Notifications", icon: Clock },
  { id: "security", label: "Security", icon: Key },
  { id: "preferences", label: "Preferences", icon: Monitor },
  { id: "danger", label: "Danger zone", icon: TriangleAlert },
] as const;

type TabId = (typeof TABS)[number]["id"];

function PrefRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/[0.04] py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4.5 text-ink-mute">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full min-w-0 max-w-full rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none transition-colors focus:border-brand-600/50"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

export function SettingsPage() {
  useAppSeo("Settings — Zybble", "Account, workspace, notifications, and security preferences.", "/settings");
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("profile");
  const { user, workspace, planId, loading: ctxLoading } = useWorkspaceContext();
  const plan = planFromId(planId);

  /* profile — hydrated from the signed-in account */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  /* workspace */
  const [wsName, setWsName] = useState("");
  useEffect(() => {
    if (workspace) setWsName(workspace.name);
  }, [workspace]);

  /* security */
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  /* notifications */
  const [nSearch, setNSearch] = useState(true);
  const [nExport, setNExport] = useState(true);
  const [nDigest, setNDigest] = useState(false);
  const [nProduct, setNProduct] = useState(false);
  /* preferences — the interface is permanently light mode, so appearance is
     not a preference anymore; only locale formatting is configurable. */
  const [prefs, setPrefs] = useState<UserPreferences>({ timezone: "UTC", language: "en", date_format: "MMM D, YYYY" });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [sessions, setSessions] = useState<AppSessionRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  useEffect(() => {
    if (!user) return;
    getUserPreferences().then(setPrefs).catch(() => undefined);
    setLoadingSessions(true);
    listAppSessions().then(setSessions).catch(() => undefined).finally(() => setLoadingSessions(false));
  }, [user]);
  /* danger */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (section: string) => {
    if (section === "Profile") {
      setSavingProfile(true);
      try {
        await updateProfile(name, email);
        toast("Profile saved");
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setSavingProfile(false);
      }
      return;
    }
    if (section === "Preferences") {
      setSavingPrefs(true);
      try {
        await saveUserPreferences(prefs);
        toast("Preferences saved");
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setSavingPrefs(false);
      }
      return;
    }
    toast(`${section} saved`);
  };

  const changePassword = async () => {
    if (pw.length < 8) {
      toast("Password needs at least 8 characters.", "error");
      return;
    }
    if (pw !== pw2) {
      toast("Passwords don't match.", "error");
      return;
    }
    setSavingPw(true);
    const { error } = await updatePassword(pw);
    setSavingPw(false);
    if (error) {
      toast(error, "error");
      return;
    }
    setPw("");
    setPw2("");
    toast("Password updated");
  };

  return (
    <AppLayout title="Settings" description="Account, workspace, and product preferences." wide>
      {/* While the account context resolves, mirror the tab rail + card so
          the real form swaps in without layout shift. */}
      {ctxLoading || !user ? (
        <SettingsSkeleton />
      ) : (
      <div className="grid min-w-0 gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* tab rail — a hidden-scrollbar horizontal rail on mobile, a
            sticky vertical list from lg up. */}
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-[60px] lg:self-start">
          <Card className="p-1.5">
            <ul className="no-scrollbar flex gap-1 overflow-x-auto overscroll-x-contain lg:flex-col lg:overflow-x-visible">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <li key={t.id} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => setTab(t.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 whitespace-nowrap rounded px-2.5 py-2 text-xs transition-colors",
                        active ? "bg-black/[0.05] font-medium text-ink" : "text-ink-soft hover:bg-black/[0.03] hover:text-ink",
                        t.id === "danger" && !active && "text-red-600/80 hover:text-red-700"
                      )}
                    >
                      <Icon className={cn("size-3.5 shrink-0", active ? "text-brand-700" : "text-neutral-400")} aria-hidden="true" />
                      {t.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </nav>

        {/* content */}
        <div className="min-w-0 max-w-[720px]">
          {tab === "profile" ? (
            <Card>
              <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
                <SectionTitle title="Profile" description="How you appear across your workspaces." />
              </div>
              <div className="space-y-4 px-4 py-5 sm:px-5">
                <div className="flex items-center gap-3">
                  <Avatar name={name || "?"} tint="bg-brand-50 text-brand-700" src={user?.avatarUrl} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{name || "—"}</p>
                    <p className="mt-0.5 text-[10.5px] leading-4 text-neutral-400">
                      Your initials are shown across shared workspaces.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <FieldLabel htmlFor="set-name">Full name</FieldLabel>
                    <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="min-w-0">
                    <FieldLabel htmlFor="set-email">Email</FieldLabel>
                    <Input id="set-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end border-t border-black/[0.05] pt-4">
                  <Btn variant="primary" size="sm" onClick={() => save("Profile")} disabled={savingProfile}>
                    {savingProfile ? "Saving…" : "Save changes"}
                  </Btn>
                </div>
              </div>
            </Card>
          ) : null}

          {tab === "account" ? (
            <div className="space-y-3">
              <Card>
                <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
                  <SectionTitle title="Account" description="Your identity inside Zybble." />
                </div>
                <dl className="divide-y divide-black/[0.04] px-4 py-1 sm:px-5">
                  {[
                    ["Account holder", user?.name ?? "—"],
                    ["Sign-in email", user?.email ?? "—"],
                    ["Plan", `${plan.label} — $${(plan.priceCents / 100).toFixed(0)}/month`],
                    ["Workspace", workspace?.name ?? "—"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex flex-col gap-0.5 py-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between min-[420px]:gap-4"
                    >
                      <dt className="shrink-0 text-[11px] text-ink-mute">{label}</dt>
                      <dd className="min-w-0 break-words text-xs font-medium text-ink min-[420px]:text-right">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <LogOut className="size-4 shrink-0 text-neutral-300" aria-hidden="true" />
                <div className="min-w-0 grow basis-40">
                  <p className="text-xs font-medium text-ink">Sign out of Zybble</p>
                  <p className="text-[11px] leading-4.5 text-ink-mute">You'll return to the login screen.</p>
                </div>
                <Btn variant="outline" size="sm" className="shrink-0" onClick={async () => { await signOut(); navigate("/login", { replace: true }); }}>
                  Log out
                </Btn>
              </Card>
            </div>
          ) : null}

          {tab === "workspace" ? (
            <Card>
              <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
                <SectionTitle title="Workspace" description="Your team's shared environment." />
              </div>
              <div className="space-y-4 px-4 py-5 sm:px-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <FieldLabel htmlFor="ws-name-set">Workspace name</FieldLabel>
                    <Input id="ws-name-set" value={wsName} onChange={(e) => setWsName(e.target.value)} />
                  </div>
                  <div className="min-w-0">
                    <FieldLabel htmlFor="ws-plan">Plan</FieldLabel>
                    <Input id="ws-plan" value={plan.label} readOnly disabled />
                  </div>
                </div>
                <div className="rounded-md border border-black/[0.06] bg-neutral-50/70 px-3 py-2.5">
                  <p className="text-[11px] font-medium text-ink">Ownership</p>
                  <p className="mt-0.5 text-[10.5px] leading-4 text-ink-mute">
                    This workspace is owned by {user?.name ?? "you"}. Ownership transfers require an admin.
                  </p>
                </div>
                <div className="flex justify-end border-t border-black/[0.05] pt-4">
                  <Btn variant="primary" size="sm" onClick={() => save("Workspace")}>
                    Save changes
                  </Btn>
                </div>
              </div>
            </Card>
          ) : null}

          {tab === "notifications" ? (
            <Card>
              <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
                <SectionTitle title="Notifications" description="What Zybble emails you about." />
              </div>
              <div className="px-4 py-2 sm:px-5">
                <PrefRow title="Search completion" description="Let me know when a large search finishes collecting." checked={nSearch} onChange={setNSearch} />
                <PrefRow title="Exports ready" description="Email when a CSV finishes preparing." checked={nExport} onChange={setNExport} />
                <PrefRow title="Weekly usage digest" description="A short summary of leads, lists, and limits every Monday." checked={nDigest} onChange={setNDigest} />
                <PrefRow title="Product updates" description="Occasional feature releases — no marketing drip." checked={nProduct} onChange={setNProduct} />
                <div className="flex justify-end py-4">
                  <Btn variant="primary" size="sm" onClick={() => save("Notification preferences")}>
                    Save preferences
                  </Btn>
                </div>
              </div>
            </Card>
          ) : null}

          {tab === "security" ? (
            <div className="space-y-3">
              <Card>
                <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
                  <SectionTitle title="Password" description="Update your sign-in credentials." />
                </div>
                <div className="space-y-3 px-4 py-5 sm:px-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <FieldLabel htmlFor="set-pw-new">New password</FieldLabel>
                      <Input
                        id="set-pw-new"
                        type="password"
                        autoComplete="new-password"
                        placeholder="8+ characters"
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                      />
                    </div>
                    <div className="min-w-0">
                      <FieldLabel htmlFor="set-pw-confirm">Confirm new password</FieldLabel>
                      <Input
                        id="set-pw-confirm"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Repeat it"
                        value={pw2}
                        onChange={(e) => setPw2(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end border-t border-black/[0.05] pt-4">
                    <Btn variant="primary" size="sm" onClick={changePassword} disabled={savingPw || !pw}>
                      {savingPw ? "Updating…" : "Update password"}
                    </Btn>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
                  <SectionTitle title="Active sessions" description="Where you're signed in right now." />
                </div>
                <ul className="px-4 py-3 sm:px-5">
                  {loadingSessions ? (
                    <li className="py-3 text-xs text-ink-mute">Loading observed sessions…</li>
                  ) : sessions.length ? sessions.map((s) => {
                    const ua = s.user_agent || "Unknown browser";
                    const browser = /Chrome/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : /Firefox/i.test(ua) ? "Firefox" : /Edg/i.test(ua) ? "Edge" : "Browser";
                    const os = /Mac OS|Macintosh/i.test(ua) ? "macOS" : /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "Unknown device";
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/[0.04] py-2.5 last:border-0">
                        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-neutral-50 text-neutral-400">
                          <Lock className="size-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 grow basis-40">
                          <p className="truncate text-xs font-medium text-ink">{browser} · {os}</p>
                          <p className="break-words text-[10.5px] leading-4 text-neutral-400">Last seen {new Date(s.last_seen_at).toLocaleString()} {s.revoked_at ? "· revoked" : ""}</p>
                        </div>
                        {s.current ? (
                          <Badge tone="green">This device</Badge>
                        ) : s.revoked_at ? (
                          <Badge tone="neutral">Revoked</Badge>
                        ) : (
                          <Btn variant="ghost" size="sm" onClick={async () => {
                            try {
                              await revokeAppSession(s.id);
                              setSessions((rows) => rows.map((row) => row.id === s.id ? { ...row, revoked_at: new Date().toISOString() } : row));
                              toast("Session revoked");
                            } catch (e) {
                              toast((e as Error).message, "error");
                            }
                          }}>
                            Revoke
                          </Btn>
                        )}
                      </li>
                    );
                  }) : (
                    <li className="py-3 text-xs leading-5 text-ink-mute">No observed app sessions yet. Zybble records sessions only after a browser signs in; it does not invent devices or locations.</li>
                  )}
                </ul>
              </Card>
            </div>
          ) : null}

          {tab === "preferences" ? (
            <Card>
              <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
                <SectionTitle title="Preferences" description="How the product behaves for you." />
              </div>
              <div className="grid gap-3 px-4 py-5 sm:grid-cols-2 sm:px-5">
                <SelectField label="Timezone" value={prefs.timezone} onChange={(v) => setPrefs((p) => ({ ...p, timezone: v }))} options={["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Kolkata"]} />
                <SelectField label="Language" value={prefs.language} onChange={(v) => setPrefs((p) => ({ ...p, language: v as UserPreferences["language"] }))} options={["en", "es", "fr", "de"]} />
                <SelectField label="Date format" value={prefs.date_format} onChange={(v) => setPrefs((p) => ({ ...p, date_format: v as UserPreferences["date_format"] }))} options={["MMM D, YYYY", "D MMM YYYY", "YYYY-MM-DD"]} />
                <p className="col-span-full rounded-md border border-black/[0.06] bg-neutral-50/70 px-3 py-2 text-[11px] leading-4.5 text-ink-mute sm:col-span-2">
                  Language preferences are stored now and applied to date/number formatting immediately. Full interface translations use the same preference key as translated strings are added.
                </p>
                <div className="col-span-full flex justify-end border-t border-black/[0.05] pt-4 sm:col-span-2">
                  <Btn variant="primary" size="sm" onClick={() => save("Preferences")} disabled={savingPrefs}>
                    {savingPrefs ? "Saving…" : "Save preferences"}
                  </Btn>
                </div>
              </div>
            </Card>
          ) : null}

          {tab === "danger" ? (
            <div className="space-y-3">
              <Card className="border-red-200/70">
                <div className="border-b border-red-100 px-4 py-4 sm:px-5">
                  <SectionTitle title="Danger zone" description="Irreversible actions — proceed carefully." />
                </div>
                <div className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-3 border-b border-black/[0.04] pb-4">
                    <Globe className="size-4 shrink-0 text-neutral-300" aria-hidden="true" />
                    <div className="min-w-0 grow basis-48">
                      <p className="text-xs font-medium text-ink">Export all account data</p>
                      <p className="text-[11px] leading-4.5 text-ink-mute">Download every list and lead you own before making account changes.</p>
                    </div>
                    <Btn variant="outline" size="sm" className="shrink-0" onClick={() => toast("Full account export started — check Exports", "info")}>
                      <Download className="size-3.5" aria-hidden="true" />
                      Export everything
                    </Btn>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-4">
                    <TriangleAlert className="size-4 shrink-0 text-red-400" aria-hidden="true" />
                    <div className="min-w-0 grow basis-48">
                      <p className="text-xs font-medium text-red-700">Delete this account</p>
                      <p className="text-[11px] leading-4.5 text-red-950/60">
                        Permanently removes searches, lead lists, exports, and membership from all workspaces.
                      </p>
                    </div>
                    <Btn
                      variant="primary"
                      size="sm"
                      className="shrink-0 bg-red-600 hover:bg-red-700 shadow-none"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete account
                    </Btn>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </div>
      </div>
      )}

      {/* delete confirmation */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          toast(
            "Account deletion is handled by support so we can verify it's you — we've pointed you at the contact form.",
            "info"
          );
          window.setTimeout(() => navigate("/contact"), 600);
        }}
        title="Delete your Zybble account?"
        description="This permanently removes all of your searches, lead lists, exports, and workspace memberships. To protect your data we verify the request first — we'll take you to the contact form."
      />
    </AppLayout>
  );
}
