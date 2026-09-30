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
import { updateProfile, updatePassword } from "../services/api";
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
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none transition-colors focus:border-brand-600/50"
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
  /* preferences */
  const [appearance, setAppearance] = useState("System");
  const [timezone, setTimezone] = useState("Central Time (US)");
  const [language, setLanguage] = useState("English");
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
      <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* tab rail */}
        <nav aria-label="Settings sections" className="lg:sticky lg:top-[60px] lg:self-start">
          <Card className="p-1.5">
            <ul className="flex gap-1 overflow-x-auto thin-scroll lg:flex-col">
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
                  <div>
                    <p className="text-xs font-medium text-ink">{name || "—"}</p>
                    <p className="mt-0.5 text-[10.5px] text-neutral-400">
                      Your initials are shown across shared workspaces.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="set-name">Full name</FieldLabel>
                    <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
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
                    <div key={label} className="flex items-center justify-between gap-4 py-3">
                      <dt className="text-[11px] text-ink-mute">{label}</dt>
                      <dd className="text-xs font-medium text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <LogOut className="size-4 text-neutral-300" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-ink">Sign out of Zybble</p>
                  <p className="text-[11px] text-ink-mute">You'll return to the login screen.</p>
                </div>
                <Btn variant="outline" size="sm" href="/login">
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
                  <div>
                    <FieldLabel htmlFor="ws-name-set">Workspace name</FieldLabel>
                    <Input id="ws-name-set" value={wsName} onChange={(e) => setWsName(e.target.value)} />
                  </div>
                  <div>
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
                    <div>
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
                    <div>
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
                  {[
                    { device: "MacBook Pro · Chrome", place: "Austin, TX", current: true },
                    { device: "iPhone 15 · Safari", place: "Austin, TX", current: false },
                  ].map((s) => (
                    <li key={s.device} className="flex items-center gap-3 border-b border-black/[0.04] py-2.5 last:border-0">
                      <span className="grid size-7 place-items-center rounded-md bg-neutral-50 text-neutral-400">
                        <Lock className="size-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink">{s.device}</p>
                        <p className="text-[10.5px] text-neutral-400">{s.place} · signed in recently</p>
                      </div>
                      {s.current ? (
                        <Badge tone="green">This device</Badge>
                      ) : (
                        <Btn variant="ghost" size="sm" onClick={() => toast("Session revoked")}>
                          Revoke
                        </Btn>
                      )}
                    </li>
                  ))}
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
                <SelectField label="Appearance" value={appearance} onChange={setAppearance} options={["System", "Light", "Dark"]} />
                <SelectField label="Timezone" value={timezone} onChange={setTimezone} options={["Central Time (US)", "Eastern Time (US)", "Pacific Time (US)", "Greenwich Mean Time"]} />
                <SelectField label="Language" value={language} onChange={setLanguage} options={["English", "Español", "Français", "Deutsch"]} />
                <SelectField label="Date format" value="MMM D, YYYY" onChange={() => {}} options={["MMM D, YYYY", "D MMM YYYY", "YYYY-MM-DD"]} />
                <div className="col-span-full flex justify-end border-t border-black/[0.05] pt-4 sm:col-span-2">
                  <Btn variant="primary" size="sm" onClick={() => save("Preferences")}>
                    Save preferences
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
                    <Globe className="size-4 text-neutral-300" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink">Export all account data</p>
                      <p className="text-[11px] leading-4.5 text-ink-mute">Download every list and lead you own before making account changes.</p>
                    </div>
                    <Btn variant="outline" size="sm" onClick={() => toast("Full account export started — check Exports", "info")}>
                      <Download className="size-3.5" aria-hidden="true" />
                      Export everything
                    </Btn>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-4">
                    <TriangleAlert className="size-4 text-red-400" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-red-700">Delete this account</p>
                      <p className="text-[11px] leading-4.5 text-red-950/60">
                        Permanently removes searches, lead lists, exports, and membership from all workspaces.
                      </p>
                    </div>
                    <Btn
                      variant="primary"
                      size="sm"
                      className="bg-red-600 hover:bg-red-700 shadow-none"
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
