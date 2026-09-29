/* ------------------------------------------------------------------ */
/* Zybble app — authentication (login / signup / reset)                */
/* Real Supabase Auth. Split-screen landscape preserved and refined.   */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { ZybbleMark } from "../../components/primitives";
import { LANDSCAPE_ALT, LANDSCAPE_URL } from "../../lib/site";
import { navigate, useAppSeo } from "../hooks";
import {
  BACKEND_ENABLED,
  CONFIG_ERROR,
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from "../services/api";

/* ------------------------------------------------------------------ */
/* Split-screen frame                                                  */
/* ------------------------------------------------------------------ */
const HIGHLIGHTS = [
  "Describe the businesses you need in plain language",
  "Structured phone, email, website and rating data",
  "Export to CSV on every plan",
];

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-white">
      {/* ——— form column ——— */}
      <div className="flex w-full flex-col px-5 sm:px-10 lg:w-[48%] lg:min-w-[460px] lg:max-w-[620px] lg:px-16">
        <header className="flex h-[72px] shrink-0 items-center">
          <Link to="/" aria-label="Zybble home" className="flex items-center gap-2">
            <ZybbleMark className="size-5" />
            <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">Zybble</span>
          </Link>
        </header>

        <main id="main" className="flex flex-1 items-center py-8 sm:py-10">
          <div className="w-full max-w-[380px]">
            {!BACKEND_ENABLED ? (
              <div
                role="status"
                className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
              >
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                <p className="text-[11.5px] leading-4.5 text-amber-900">{CONFIG_ERROR}</p>
              </div>
            ) : null}
            {children}
          </div>
        </main>

        <footer className="pb-7">
          <p className="text-[11px] text-neutral-400">
            © {new Date().getFullYear()} Zybble ·{" "}
            <Link to="/privacy" className="transition-colors hover:text-ink-mute">
              Privacy
            </Link>{" "}
            ·{" "}
            <Link to="/terms" className="transition-colors hover:text-ink-mute">
              Terms
            </Link>
          </p>
        </footer>
      </div>

      {/* ——— landscape column ——— */}
      <div className="relative hidden overflow-hidden lg:block lg:flex-1">
        <div className="absolute inset-3 overflow-hidden rounded-[24px] ring-1 ring-black/[0.06]">
          <img
            src={LANDSCAPE_URL}
            alt={LANDSCAPE_ALT}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: "center 55%" }}
          />
          {/* readability scrim, bottom-weighted */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-ink/45 via-ink/5 to-transparent"
            aria-hidden="true"
          />

          {/* floating product card */}
          <div className="absolute inset-x-8 bottom-8 xl:inset-x-12 xl:bottom-12">
            <div className="max-w-md rounded-2xl border border-white/60 bg-white/95 p-5 shadow-[0_16px_48px_-16px_rgba(23,43,33,0.35)] backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-brand-600 text-white">
                  <Sparkles className="size-3" aria-hidden="true" />
                </span>
                <p className="font-display text-[13px] font-semibold tracking-[-0.01em] text-ink">
                  Find businesses. Understand them.
                </p>
              </div>
              <ul className="mt-3 space-y-1.5">
                {HIGHLIGHTS.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-[11.5px] leading-4.5 text-ink-soft">
                    <span className="mt-[3px] grid size-3 shrink-0 place-items-center rounded-full bg-brand-100">
                      <Check className="size-2 text-brand-700" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Field                                                               */
/* ------------------------------------------------------------------ */
function AuthField({
  id,
  label,
  icon,
  trailing,
  error,
  hint,
  type = "text",
  ...rest
}: {
  id: string;
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  error?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">{icon}</span>
        <input
          id={id}
          type={type}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            "h-10 w-full rounded-lg border bg-white pl-9 text-[13.5px] text-ink placeholder:text-neutral-400 outline-none transition-all",
            "focus:border-brand-600/60 focus:ring-[3px] focus:ring-brand-600/12",
            trailing ? "pr-10" : "pr-3",
            error ? "border-red-300 focus:border-red-400 focus:ring-red-500/10" : "border-black/[0.11]"
          )}
          {...rest}
        />
        {trailing ? <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div> : null}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-center gap-1 text-[11.5px] text-red-600">
          <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[11.5px] text-neutral-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function PwToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      className="grid size-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-black/[0.04] hover:text-ink"
    >
      {shown ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

function SubmitBtn({ children, busy, disabled }: { children: ReactNode; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="mt-1 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(11,99,67,0.25),inset_0_1px_0_rgba(255,255,255,0.12)] transition-all duration-150 hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">{title}</h1>
      <p className="mt-1.5 text-[13.5px] leading-6 text-ink-mute">{sub}</p>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-4.5 text-red-700"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/* ------------------------------------------------------------------ */
/* LOGIN                                                               */
/* ------------------------------------------------------------------ */
export function LoginPage() {
  useAppSeo("Log in — Zybble", "Sign in to your Zybble workspace.", "/login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!emailOk(email)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setFormError("");
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) {
      setFormError(error);
      return;
    }
    navigate("/overview", { replace: true });
  };

  return (
    <AuthFrame>
      <Heading title="Welcome back" sub="Sign in to continue finding leads." />
      {formError ? <FormError message={formError} /> : null}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <AuthField
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@company.com"
          icon={<Mail className="size-3.5" aria-hidden="true" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label htmlFor="login-password" className="text-[12.5px] font-medium text-ink">
              Password
            </label>
            <Link
              to="/reset"
              className="text-[11.5px] font-medium text-brand-700 transition-colors hover:text-brand-600"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
              <Lock className="size-3.5" aria-hidden="true" />
            </span>
            <input
              id="login-password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              className={cn(
                "h-10 w-full rounded-lg border bg-white pl-9 pr-10 text-[13.5px] text-ink placeholder:text-neutral-400 outline-none transition-all",
                "focus:border-brand-600/60 focus:ring-[3px] focus:ring-brand-600/12",
                errors.password ? "border-red-300" : "border-black/[0.11]"
              )}
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
              <PwToggle shown={showPw} onToggle={() => setShowPw((v) => !v)} />
            </div>
          </div>
          {errors.password ? (
            <p role="alert" className="mt-1.5 text-[11.5px] text-red-600">
              {errors.password}
            </p>
          ) : null}
        </div>
        <SubmitBtn busy={busy}>{busy ? "Signing in…" : "Log in"}</SubmitBtn>
      </form>

      <p className="mt-6 text-center text-[12.5px] text-ink-mute">
        New to Zybble?{" "}
        <Link to="/signup" className="font-medium text-ink transition-colors hover:text-brand-700">
          Create an account
        </Link>
      </p>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------ */
/* SIGNUP — short and frictionless                                     */
/* ------------------------------------------------------------------ */
const RULES = [
  { test: (p: string) => p.length >= 8, label: "8+ characters" },
  { test: (p: string) => /\d/.test(p), label: "A number" },
  { test: (p: string) => /[A-Za-z]/.test(p), label: "A letter" },
];

export function SignupPage() {
  useAppSeo("Sign up — Zybble", "Create your Zybble workspace and start finding leads.", "/signup");
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("invite") ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const strength = useMemo(() => RULES.filter((r) => r.test(password)).length, [password]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = "Enter your name.";
    if (!emailOk(email)) next.email = "Enter a valid email address.";
    if (strength < RULES.length) next.password = "Your password doesn't meet the requirements yet.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setFormError("");
    setBusy(true);
    const { error, needsConfirm } = await signUp(name.trim(), email.trim(), password);
    setBusy(false);
    if (error) {
      setFormError(error);
      return;
    }
    if (needsConfirm) {
      setSent(true);
      return;
    }
    navigate("/overview", { replace: true });
  };

  if (sent) {
    return (
      <AuthFrame>
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Mail className="size-5" aria-hidden="true" />
          </span>
          <h1 className="font-display mt-5 text-[22px] font-semibold tracking-[-0.02em] text-ink">Check your inbox</h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">
            We sent a confirmation link to <span className="font-medium text-ink">{email}</span>. Confirm your email to
            activate your workspace.
          </p>
          <Link
            to="/login"
            className="group mt-6 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700 transition-colors hover:text-brand-600"
          >
            Back to log in
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <Heading title="Create your account" sub="Start free with 50 leads a month. No card required." />
      {formError ? <FormError message={formError} /> : null}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <AuthField
          id="signup-name"
          label="Full name"
          autoComplete="name"
          autoFocus
          placeholder="Your name"
          icon={<User className="size-3.5" aria-hidden="true" />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <AuthField
          id="signup-email"
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          icon={<Mail className="size-3.5" aria-hidden="true" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <div>
          <AuthField
            id="signup-password"
            label="Password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Create a password"
            icon={<Lock className="size-3.5" aria-hidden="true" />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            trailing={<PwToggle shown={showPw} onToggle={() => setShowPw((v) => !v)} />}
          />
          {/* compact strength meter + inline rules */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {RULES.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-300",
                    strength > i ? "bg-brand-600" : "bg-black/[0.08]"
                  )}
                />
              ))}
            </div>
            <span className="text-[10.5px] text-neutral-400">
              {password ? `${strength}/${RULES.length}` : ""}
            </span>
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li
                  key={rule.label}
                  className={cn("flex items-center gap-1 text-[10.5px]", ok ? "text-brand-700" : "text-neutral-400")}
                >
                  <Check className={cn("size-2.5", ok ? "opacity-100" : "opacity-30")} strokeWidth={3} aria-hidden="true" />
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </div>
        <SubmitBtn busy={busy}>{busy ? "Creating account…" : "Create account"}</SubmitBtn>
      </form>

      <p className="mt-6 text-center text-[12.5px] text-ink-mute">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-ink transition-colors hover:text-brand-700">
          Log in
        </Link>
      </p>
      <p className="mt-6 text-center text-[11px] leading-5 text-neutral-400">
        By creating an account you agree to our{" "}
        <Link to="/terms" className="underline underline-offset-2 hover:text-ink-mute">
          Terms
        </Link>{" "}
        and{" "}
        <Link to="/privacy" className="underline underline-offset-2 hover:text-ink-mute">
          Privacy Policy
        </Link>
        .
      </p>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------ */
/* RESET                                                               */
/* ------------------------------------------------------------------ */
export function ResetPage() {
  useAppSeo("Reset password — Zybble", "Reset your Zybble account password.", "/reset");
  const [params] = useSearchParams();
  const [step, setStep] = useState<"request" | "sent" | "update" | "done">(
    params.get("step") === "update" ? "update" : "request"
  );
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /* Supabase recovery links land with a session — jump straight to update */
  useEffect(() => {
    if (params.get("step") === "update") setStep("update");
  }, [params]);

  const sendLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailOk(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setBusy(true);
    const { error: reqError } = await requestPasswordReset(email.trim());
    setBusy(false);
    if (reqError) {
      setError(reqError);
      return;
    }
    setStep("sent");
  };

  const applyPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) {
      setError("Password needs at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Those passwords don't match.");
      return;
    }
    setError("");
    setBusy(true);
    const { error: updErr } = await updatePassword(pw);
    setBusy(false);
    if (updErr) {
      setError(updErr);
      return;
    }
    setStep("done");
  };

  return (
    <AuthFrame>
      {step === "request" ? (
        <>
          <Heading title="Reset your password" sub="Enter your email and we'll send you a secure link." />
          {error ? <FormError message={error} /> : null}
          <form onSubmit={sendLink} noValidate className="space-y-4">
            <AuthField
              id="reset-email"
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              icon={<Mail className="size-3.5" aria-hidden="true" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <SubmitBtn busy={busy}>{busy ? "Sending…" : "Send reset link"}</SubmitBtn>
          </form>
          <p className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink transition-colors hover:text-brand-700"
            >
              <ArrowLeft className="size-3" aria-hidden="true" />
              Back to log in
            </Link>
          </p>
        </>
      ) : step === "sent" ? (
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Mail className="size-5" aria-hidden="true" />
          </span>
          <h1 className="font-display mt-5 text-[22px] font-semibold tracking-[-0.02em] text-ink">Check your inbox</h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">
            If an account exists for <span className="font-medium text-ink">{email}</span>, a reset link is on its way.
            Open it on this device to set a new password.
          </p>
          <p className="mt-7 text-[11.5px] text-neutral-400">
            Didn't get it?{" "}
            <button
              type="button"
              onClick={() => setStep("request")}
              className="font-medium text-ink transition-colors hover:text-brand-700"
            >
              Try another email
            </button>
          </p>
          <p className="mt-3">
            <Link to="/login" className="text-[12px] font-medium text-brand-700 hover:text-brand-600">
              Back to log in
            </Link>
          </p>
        </div>
      ) : step === "update" ? (
        <>
          <Heading title="Choose a new password" sub="Make it something you'll remember." />
          {error ? <FormError message={error} /> : null}
          <form onSubmit={applyPassword} noValidate className="space-y-4">
            <AuthField
              id="reset-pw"
              label="New password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              autoFocus
              placeholder="8+ characters"
              icon={<Lock className="size-3.5" aria-hidden="true" />}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              trailing={<PwToggle shown={showPw} onToggle={() => setShowPw((v) => !v)} />}
            />
            <AuthField
              id="reset-pw2"
              label="Confirm password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat it"
              icon={<Lock className="size-3.5" aria-hidden="true" />}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
            <SubmitBtn busy={busy}>{busy ? "Updating…" : "Update password"}</SubmitBtn>
          </form>
        </>
      ) : (
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Check className="size-5" aria-hidden="true" />
          </span>
          <h1 className="font-display mt-5 text-[22px] font-semibold tracking-[-0.02em] text-ink">Password updated</h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">
            You can now sign in with your new password.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-[13.5px] font-medium text-white transition-colors hover:bg-brand-700"
          >
            Log in
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
