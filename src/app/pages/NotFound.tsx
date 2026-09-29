import { Compass } from "lucide-react";
import { ZybbleMark } from "../../components/primitives";
import { Btn } from "../components/ui";
import { useAppSeo } from "../hooks";

export function NotFoundPage() {
  useAppSeo("Page not found — Zybble", "That page doesn't exist.", "/404");
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-5">
      <div className="w-full max-w-sm text-center">
        <a href="/" className="mx-auto mb-8 inline-flex items-center gap-2" aria-label="Zybble home">
          <ZybbleMark className="size-5" />
          <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
            Zybble
          </span>
        </a>
        <span className="mx-auto grid size-10 place-items-center rounded-lg border border-black/[0.06] bg-white text-neutral-300">
          <Compass className="size-4" aria-hidden="true" />
        </span>
        <h1 className="font-display mt-4 text-[22px] font-semibold tracking-[-0.02em] text-ink">
          Page not found
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-mute">
          The page you're looking for doesn't exist or may have moved.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Btn variant="outline" href="/">
            Back to home
          </Btn>
          <Btn variant="primary" href="/overview">
            Go to dashboard
          </Btn>
        </div>
      </div>
    </div>
  );
}
