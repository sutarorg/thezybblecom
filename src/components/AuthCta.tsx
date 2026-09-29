/* ------------------------------------------------------------------ */
/* Marketing CTA that adapts to the visitor's session.                 */
/* Signed out → "Start for free" → /signup                             */
/* Signed in  → "Dashboard"      → /overview                           */
/* ------------------------------------------------------------------ */
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { cn } from "../utils/cn";
import { ButtonGreen } from "./primitives";
import { useAuthUser } from "../app/services/hooks";

export function AuthCta({
  className,
  small,
  label = "Start for free",
  showIcon,
}: {
  className?: string;
  small?: boolean;
  label?: string;
  showIcon?: boolean;
}) {
  const user = useAuthUser();
  const authed = user !== "loading" && Boolean(user);

  return (
    <ButtonGreen href={authed ? "/overview" : "/signup"} small={small} className={className}>
      {authed ? (
        <>
          <LayoutDashboard className={cn(small ? "size-3.5" : "size-4")} aria-hidden="true" />
          Dashboard
        </>
      ) : (
        <>
          {label}
          {showIcon ? <ArrowRight className="size-3.5" aria-hidden="true" /> : null}
        </>
      )}
    </ButtonGreen>
  );
}

/** Secondary text link that mirrors the same auth state. */
export function AuthTextLink({ className }: { className?: string }) {
  const user = useAuthUser();
  const authed = user !== "loading" && Boolean(user);
  return (
    <a
      href={authed ? "/overview" : "/login"}
      className={cn(
        "rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink",
        className
      )}
    >
      {authed ? "Dashboard" : "Sign in"}
    </a>
  );
}
