/* ------------------------------------------------------------------ */
/* Root error boundary — a crash must never render a blank page.       */
/* ------------------------------------------------------------------ */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { ZybbleMark } from "../../components/primitives";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced in the browser console and any Vercel log drain.
    console.error("Zybble render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-5">
        <div className="w-full max-w-md text-center">
          <a href="/" className="mx-auto mb-8 inline-flex items-center gap-2" aria-label="Zybble home">
            <ZybbleMark className="size-5" />
            <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
              Zybble
            </span>
          </a>
          <span className="mx-auto grid size-10 place-items-center rounded-lg bg-red-50 text-red-600">
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
          <h1 className="font-display mt-4 text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Something went wrong
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">
            The page failed to load. Reloading usually fixes it — if it keeps happening, the detail
            below helps us debug.
          </p>

          <details className="mt-4 rounded-lg border border-black/[0.07] bg-white px-3 py-2.5 text-left">
            <summary className="cursor-pointer text-[11.5px] font-medium text-ink-soft">
              Technical detail
            </summary>
            <pre className="thin-scroll mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-4 text-ink-mute">
              {error.message}
            </pre>
          </details>

          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-700"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reload page
            </button>
            <a
              href="/"
              className="inline-flex h-9 items-center rounded-full border border-black/[0.09] bg-white px-4 text-[13px] font-medium text-ink transition-colors hover:bg-neutral-50"
            >
              Back to home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
