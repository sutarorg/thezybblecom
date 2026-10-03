import { useEffect, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
/* Vercel Web Analytics — this app is a Vite + react-router SPA (not
   Next.js), so the React entry point is the correct official integration:
   the /next entry imports next/navigation and cannot build here. Rendered
   exactly once at the application root; on Vercel it auto-reports page
   views (incl. client-side route changes) and Web Vitals. */
import { Analytics } from "@vercel/analytics/react";

/* marketing */
import { Navbar } from "./sections/Navbar";
import { Hero } from "./sections/Hero";
import { Steps } from "./sections/Steps";
import { Features } from "./sections/Features";
import { Capabilities } from "./sections/Capabilities";
import { Pricing } from "./sections/Pricing";
import { Faq } from "./sections/Faq";
import { FinalCta, Footer } from "./sections/Closing";
import ContactPage from "./pages/Contact";
import { PrivacyPage, TermsPage } from "./pages/Legal";
import { Assistant } from "./assistant/Assistant";
import { usePageSeo, useScrollToHash } from "./lib/hooks";
import { legacyHashRouteToPath } from "./lib/legacy-route";

/* app */
import { TriangleAlert } from "lucide-react";
import { ZybbleMark } from "./components/primitives";
import { ErrorBoundary } from "./app/components/ErrorBoundary";
import { BACKEND_ENABLED } from "./app/services/api";
import { ToastProvider } from "./app/components/ui";
import { CommandPalette } from "./app/components/CommandPalette";
import { registerNavigate } from "./app/hooks";
import { useAuthUser } from "./app/services/hooks";
import { LoginPage, ResetPage, SignupPage } from "./app/pages/Auth";
import { OverviewPage } from "./app/pages/Overview";
import { FindPage } from "./app/pages/Find";
import { SearchHistoryPage } from "./app/pages/SearchHistory";
import { LeadsPage } from "./app/pages/Leads";
import { LeadDetailPage } from "./app/pages/LeadDetail";
import { ListsPage } from "./app/pages/Lists";
import { ListDetailPage } from "./app/pages/ListDetail";
import { ExportsPage } from "./app/pages/Exports";
import { TeamPage } from "./app/pages/Team";
import { WorkspacesPage } from "./app/pages/Workspaces";
import { WorkspaceDetailPage } from "./app/pages/WorkspaceDetail";
import { BillingPage } from "./app/pages/Billing";
import { UsagePage } from "./app/pages/Usage";
import { SettingsPage } from "./app/pages/Settings";
import { NotFoundPage } from "./app/pages/NotFound";

/* ------------------------------------------------------------------ */
/* Marketing home                                                      */
/* ------------------------------------------------------------------ */
function Home() {
  usePageSeo({
    title:
      "Zybble — Find the businesses you need. Turn them into usable leads.",
    description:
      "Zybble turns one plain-language request into an organized business lead list. Describe the businesses you want, get structured lead data, analyze it with AI, and export it as CSV.",
    path: "/",
  });

  return (
    <>
      <Navbar />
      <main id="main">
        <Hero />
        <Steps />
        <Features />
        <Capabilities />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <Assistant />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Auth gates                                                          */
/* ------------------------------------------------------------------ */
function Splash({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <span
          className="size-6 animate-spin rounded-full border-2 border-black/[0.08] border-t-brand-600"
          aria-hidden="true"
        />
        <p className="text-xs text-ink-mute">{label}</p>
      </div>
    </div>
  );
}

/** Wraps every authenticated route. */
function Protected({ children }: { children: ReactNode }) {
  const user = useAuthUser();
  const location = useLocation();

  if (!BACKEND_ENABLED) return <BackendMissing />;
  if (user === "loading") return <Splash />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return (
    <ErrorBoundary>
      <ToastProvider>
        {children}
        <CommandPalette />
      </ToastProvider>
    </ErrorBoundary>
  );
}

/**
 * Explicit, debuggable state when the deployment has no Supabase
 * credentials — far better than an empty screen.
 */
function BackendMissing() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-5">
      <div className="w-full max-w-md text-center">
        <a href="/" className="mx-auto mb-8 inline-flex items-center gap-2" aria-label="Zybble home">
          <ZybbleMark className="size-5" />
          <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">Zybble</span>
        </a>
        <span className="mx-auto grid size-10 place-items-center rounded-lg bg-amber-50 text-amber-600">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        <h1 className="font-display mt-4 text-[20px] font-semibold tracking-[-0.02em] text-ink">
          Backend not configured
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-mute">
          This deployment is missing its Supabase credentials, so the application can't sign you in
          or load your workspace.
        </p>
        <div className="mt-4 rounded-lg border border-black/[0.07] bg-white px-3 py-2.5 text-left">
          <p className="text-[11px] font-medium text-ink">Set these in your host's environment:</p>
          <pre className="mt-1.5 font-mono text-[10.5px] leading-4 text-ink-mute">
{`VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY`}
          </pre>
          <p className="mt-2 text-[10.5px] leading-4 text-neutral-400">
            Then redeploy — Vite reads these at build time, so a rebuild is required.
          </p>
        </div>
        <a
          href="/"
          className="mt-5 inline-flex h-9 items-center rounded-full border border-black/[0.09] bg-white px-4 text-[13px] font-medium text-ink transition-colors hover:bg-neutral-50"
        >
          Back to home
        </a>
      </div>
    </div>
  );
}

/** Auth screens redirect away once a session exists. */
function PublicOnly({ children }: { children: ReactNode }) {
  const user = useAuthUser();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (user === "loading" && BACKEND_ENABLED) return <Splash label="Checking your session…" />;
  if (user) return <Navigate to={from && from !== "/login" ? from : "/overview"} replace />;
  return (
    <ErrorBoundary>
      <ToastProvider>{children}</ToastProvider>
    </ErrorBoundary>
  );
}

/* param-aware detail wrappers */
function LeadDetailRoute() {
  const { id = "" } = useParams();
  return <LeadDetailPage id={id} />;
}
function ListDetailRoute() {
  const { id = "" } = useParams();
  return <ListDetailPage id={id} />;
}
function WorkspaceDetailRoute() {
  const { id = "" } = useParams();
  return <WorkspaceDetailPage id={id} />;
}

/* ------------------------------------------------------------------ */
/* Bridge: lets non-hook modules push real paths                       */
/* ------------------------------------------------------------------ */
function NavigationBridge() {
  const nav = useNavigate();
  useEffect(() => {
    registerNavigate((to, opts) => nav(to, { replace: opts?.replace }));
  }, [nav]);
  return null;
}

/**
 * Hash routes were used by an earlier app shell. Keep old bookmarks working,
 * but immediately replace them with clean paths on every page.
 */
function LegacyHashRouteRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const redirect = () => {
      const path = legacyHashRouteToPath(window.location.hash);
      if (path) navigate(path, { replace: true });
    };

    redirect();
    window.addEventListener("hashchange", redirect);
    return () => window.removeEventListener("hashchange", redirect);
  }, [navigate]);

  return null;
}

function RoutedApp() {
  useScrollToHash();
  return (
    <>
      <NavigationBridge />
      <LegacyHashRouteRedirect />
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.scrollIntoView({ block: "start" });
          document.getElementById("main")?.focus?.();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[90] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <Routes>
        {/* marketing */}
        <Route path="/" element={<Home />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />

        {/* auth */}
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
        <Route path="/reset" element={<PublicOnly><ResetPage /></PublicOnly>} />

        {/* application */}
        <Route path="/overview" element={<Protected><OverviewPage /></Protected>} />
        <Route path="/find" element={<Protected><FindPage /></Protected>} />
        <Route path="/search-history" element={<Protected><SearchHistoryPage /></Protected>} />
        <Route path="/leads" element={<Protected><LeadsPage /></Protected>} />
        <Route path="/leads/:id" element={<Protected><LeadDetailRoute /></Protected>} />
        <Route path="/lists" element={<Protected><ListsPage /></Protected>} />
        <Route path="/lists/:id" element={<Protected><ListDetailRoute /></Protected>} />
        <Route path="/exports" element={<Protected><ExportsPage /></Protected>} />
        <Route path="/team" element={<Protected><TeamPage /></Protected>} />
        <Route path="/workspaces" element={<Protected><WorkspacesPage /></Protected>} />
        <Route path="/workspaces/:id" element={<Protected><WorkspaceDetailRoute /></Protected>} />
        <Route path="/billing" element={<Protected><BillingPage /></Protected>} />
        <Route path="/usage" element={<Protected><UsagePage /></Protected>} />
        <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <RoutedApp />
        {/* Vercel Analytics — mounted once for the whole application. */}
        <Analytics />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
