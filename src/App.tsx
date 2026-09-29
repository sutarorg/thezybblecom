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

/* app */
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

  if (user === "loading") return <Splash />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return (
    <ToastProvider>
      {children}
      <CommandPalette />
    </ToastProvider>
  );
}

/** Auth screens redirect away once a session exists. */
function PublicOnly({ children }: { children: ReactNode }) {
  const user = useAuthUser();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (user === "loading") return <Splash label="Checking your session…" />;
  if (user) return <Navigate to={from && from !== "/login" ? from : "/overview"} replace />;
  return <ToastProvider>{children}</ToastProvider>;
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

function RoutedApp() {
  useScrollToHash();
  return (
    <>
      <NavigationBridge />
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
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  );
}
