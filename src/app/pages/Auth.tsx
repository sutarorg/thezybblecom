/* ------------------------------------------------------------------ */
/* Zybble app — auth screens (frontend-only, simulated states)         */
/* ------------------------------------------------------------------ */
import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleSlash,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { ZybbleMark } from "../../components/primitives";
import { LANDSCAPE_ALT, LANDSCAPE_URL } from "../../lib/site";
import { navigate, useAppSeo } from "../hooks";
import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from "../services/api";

/* ------------------------------------------------------------------ */
/* Split-screen frame                                                  */
/* ------------------------------------------------------------------ */
function AuthFrame({ children, visualClass }: { children: ReactNode; visualClass?: string }) {
  return (
    <div className="flex min-h-dvh bg-white">
      {/* form column */}
      <div className="flex w-full flex-col px-5 sm:px-10 lg:w-[46%] lg:min-w-[480px] lg:px-14">
        <div className="flex h-16 items-center">
          <a href="#/" aria-label="Zybble home" className="flex items-center gap-2">
            <ZybbleMark className="size-5" />
            <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
              Zybble
            </span>
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">{children}</div>
        </div>
        <p className="pb-6 text-center text-[11px] text-neutral-400">
          Secure sign-in · your workspace stays private
        </p>
      </div>

      {/* visual column */}
      <div className={cn("relative hidden overflow-hidden border-l border-black/[0.06] lg:block lg:flex-1", visualClass)}>
        <img
          src={LANDSCAPE_URL}
          alt={LANDSCAPE_ALT}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: "center 52%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-white/[0.08] via-transparent to-white/[0.04]" aria-hidden="true" />
        {/* quiet floating quote card */}
        <div className="absolute bottom-10 left-10 right-10 max-w-sm">
          <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-ui-sm">
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-md bg-brand-50 text-brand-700">
                <User className="size-3" aria-hidden="true" />
              </span>
              <p className="text-xs font-semibold text-ink">Find businesses. Understand them.</p>
            </div>
            <p className="mt-2 text-xs leading-5.5 text-ink-mute">
              One sentence becomes a structured lead list — discover, enrich,
              analyze, and export from one workspace.
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              <span className="h-1 w-10 rounded-full bg-brand-600/70" />
              <span className="h-1 w-6 rounded-full bg-black/[0.08]" />
              <span className="h-1 w-6 rounded-full bg-black/[0.08]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Auth field                                                          */
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
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-300">{icon}</span>
        <input
          id={id}
          type={type}
          aria-invalid={Boolean(error)}
          className={cn(
            "h-9 w-full rounded-md border bg-white pl-9 pr-9 text-[13px] text-ink placeholder:text-neutral-400 outline-none transition-colors focus:border-brand-600/60 focus:ring-2 focus:ring-brand-600/15",
            error ? "border-red-300" : "border-black/[0.09]"
          )}
          {...rest}
        />
        {trailing ? <div className="absolute right-2.5 top-1/2 -translate-y-1/2">{trailing}</div> : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[11px] text-neutral-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function AuthButton({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-1 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(11,99,67,0.25),inset_0_1px_0_rgba(255,255,255,0.12)] transition-all duration-150 hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
    >
      {busy ? (
        <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}

function AuthHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      <p className="mt-1 text-[13px] leading-6 text-ink-mute">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LOGIN                                                               */
/* ------------------------------------------------------------------ */
export function LoginPage() {
  useAppSeo("Log in — Zybble", "Sign in to your Zybble lead-discovery workspace.", "/login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email address.";
    if (password.length < 6) next.password = "Your password is at least 6 characters.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setFormError("");
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      setFormError(error === "Invalid login credentials" ? "Wrong email or password." : error);
      return;
    }
    navigate("/overview");
  };

  return (
    <AuthFrame>
      <AuthHeading title="Welcome back" sub="Sign in to continue finding leads." />
      {formError ? (
        <p role="alert" className="mb-4 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          <CircleSlash className="size-3.5 shrink-0" aria-hidden="true" />
          {formError}
        </p>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <AuthField
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          icon={<Mail className="size-3.5" aria-hidden="true" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <AuthField
          id="login-password"
          label="Password"
          type={showPw ? "text" : "password"}
          autoComplete="current-password"
          placeholder="••••••••"
          icon={<Lock className="size-3.5" aria-hidden="true" />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          trailing={
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="grid size-6 place-items-center rounded text-neutral-400 hover:text-ink"
            >
              {showPw ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
            </button>
          }
        />
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-xs text-ink-mute" />
          <a href="#/reset" className="text-xs font-medium text-brand-700 transition-colors hover:text-brand-600">
            Forgot password?
          </a>
        </div>
        <AuthButton busy={busy}>Log in</AuthButton>
      </form>
      <p className="mt-6 text-center text-xs text-ink-mute">
        New to Zybble?{" "}
        <a href="#/signup" className="font-medium text-ink transition-colors hover:text-brand-700">
          Create an account
        </a>
      </p>
      <p className="mt-8 text-center text-[11px] leading-5 text-neutral-400">
        By continuing you agree to our{" "}
        <a href="#/terms" className="underline underline-offset-2 hover:text-ink-mute">Terms</a> and{" "}
        <a href="#/privacy" className="underline underline-offset-2 hover:text-ink-mute">Privacy Policy</a>.
      </p>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------ */
/* SIGNUP                                                              */
/* ------------------------------------------------------------------ */
const RULES = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /\d/.test(p), label: "Contains a number" },
  { test: (p: string) => /[A-Z]/.test(p), label: "Contains an uppercase letter" },
];

export function SignupPage() {
  useAppSeo("Sign up — Zybble", "Create your Zybble workspace and start finding leads.", "/signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [needsConfirm, setNeedsConfirm] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email address.";
    if (!RULES.every((r) => r.test(password))) next.password = "Your password doesn't meet the requirements.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const { error, needsConfirm } = await signUp(name, email, password);
    setBusy(false);
    if (error) {
      setErrors({ email: error });
      return;
    }
    if (needsConfirm) {
      setNeedsConfirm(true);
      return;
    }
    navigate("/overview");
  };

  if (needsConfirm) {
    return (
      <AuthFrame>
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Mail className="size-5" aria-hidden="true" />
          </span>
          <h1 className="font-display mt-5 text-[22px] font-semibold tracking-[-0.02em] text-ink">Check your inbox</h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">
            We sent a confirmation link to <span className="font-medium text-ink">{email}</span>.
            Confirm your email to activate your workspace.
          </p>
          <a href="#/login" className="group mt-6 inline-flex items-center gap-1 text-xs font-medium text-brand-700 transition-colors hover:text-brand-600">
            Back to log in
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthHeading title="Create your account" sub="Start with 50 leads a month — free." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <AuthField
          id="signup-name"
          label="Full name"
          autoComplete="name"
          placeholder="Avery Chen"
          icon={<User className="size-3.5" aria-hidden="true" />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <AuthField
          id="signup-email"
          label="Email"
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
            placeholder="Create a strong password"
            icon={<Lock className="size-3.5" aria-hidden="true" />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            trailing={
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="grid size-6 place-items-center rounded text-neutral-400 hover:text-ink"
              >
                {showPw ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
              </button>
            }
          />
          <ul className="mt-2 space-y-1">
            {RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.label} className={cn("flex items-center gap-1.5 text-[11px]", ok ? "text-brand-700" : "text-neutral-400")}>
                  <span className={cn("grid size-3 place-items-center rounded-full", ok ? "bg-brand-100" : "bg-black/[0.06]")}>
                    <Check className="size-2" strokeWidth={3} aria-hidden="true" />
                  </span>
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </div>
        <AuthButton busy={busy}>Create account</AuthButton>
      </form>
      <p className="mt-6 text-center text-xs text-ink-mute">
        Already have an account?{" "}
        <a href="#/login" className="font-medium text-ink transition-colors hover:text-brand-700">
          Log in
        </a>
      </p>
      <p className="mt-8 text-center text-[11px] leading-5 text-neutral-400">
        By creating an account you agree to our{" "}
        <a href="#/terms" className="underline underline-offset-2 hover:text-ink-mute">Terms of Service</a> and{" "}
        <a href="#/privacy" className="underline underline-offset-2 hover:text-ink-mute">Privacy Policy</a>.
      </p>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------ */
/* RESET — 4 simulated states                                          */
/* ------------------------------------------------------------------ */
export function ResetPage() {
  useAppSeo("Reset password — Zybble", "Reset your Zybble account password.", "/reset");
  const [step, setStep] = useState<"request" | "sent" | "reset" | "success">(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    return params.get("step") === "update" ? "reset" : "request";
  });
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (step === "request") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError("Enter a valid email address.");
        return;
      }
      setBusy(true);
      const { error } = await requestPasswordReset(email);
      setBusy(false);
      if (error) {
        setError(error);
        return;
      }
      setStep("sent");
    }
  };

  return (
    <AuthFrame>
      {step === "request" ? (
        <>
          <AuthHeading title="Reset your password" sub="Enter your email and we'll send you a reset link." />
          <form onSubmit={submit} noValidate className="space-y-4">
            <AuthField
              id="reset-email"
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              icon={<Mail className="size-3.5" aria-hidden="true" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
            />
            <AuthButton busy={busy}>Send reset link</AuthButton>
          </form>
          <p className="mt-6 text-center">
            <a href="#/login" className="inline-flex items-center gap-1 text-xs font-medium text-ink transition-colors hover:text-brand-700">
              <ArrowLeft className="size-3" aria-hidden="true" />
              Back to log in
            </a>
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
          </p>
          <button
            type="button"
            onClick={() => setStep("reset")}
            className="group mt-6 inline-flex items-center gap-1 text-xs font-medium text-brand-700 transition-colors hover:text-brand-600"
          >
            Continue to set a new password
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
          <p className="mt-8 text-[11px] text-neutral-400">
            Didn't get the email?{" "}
            <button type="button" onClick={() => setStep("request")} className="font-medium text-ink hover:text-brand-700">
              Try again
            </button>
          </p>
        </div>
      ) : step === "reset" ? (
        <>
          <AuthHeading title="Choose a new password" sub={`For ${email || "your account"}.`} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (pw.length < 8) {
                setError("Password needs at least 8 characters.");
                return;
              }
              if (pw !== pw2) {
                setError("Passwords don't match.");
                return;
              }
              setError("");
              setBusy(true);
              const { error } = await updatePassword(pw);
              setBusy(false);
              if (error) {
                setError(error);
                return;
              }
              setStep("success");
            }}
            noValidate
            className="space-y-4"
          >
            <AuthField id="reset-pw" label="New password" type="password" autoComplete="new-password" placeholder="••••••••" icon={<Lock className="size-3.5" aria-hidden="true" />} value={pw} onChange={(e) => setPw(e.target.value)} />
            <AuthField id="reset-pw2" label="Confirm password" type="password" autoComplete="new-password" placeholder="••••••••" icon={<Lock className="size-3.5" aria-hidden="true" />} value={pw2} onChange={(e) => setPw2(e.target.value)} error={error} />
            <AuthButton busy={busy}>Update password</AuthButton>
          </form>
        </>
      ) : (
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Check className="size-5" aria-hidden="true" />
          </span>
          <h1 className="font-display mt-5 text-[22px] font-semibold tracking-[-0.02em] text-ink">Password updated</h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">
            Your password has been changed. You can log in with your new password.
          </p>
          <a
            href="#/login"
            className="mt-6 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 text-[13px] font-medium text-white transition-colors hover:bg-brand-700"
          >
            Log in
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
    </AuthFrame>
  );
}
