import type { ReactElement } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
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
import { useEffect } from "react";
import { ToastProvider } from "./app/components/ui";
import { CommandPalette } from "./app/components/CommandPalette";
import { navigate, useAppRoute } from "./app/hooks";
import { useAuthUser } from "./app/services/hooks";
import { BACKEND_ENABLED } from "./app/services/api";
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

/* ------------------------------------------------------------------ */
/* Landing site (unchanged)                                            */
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
/* Lead app routes (hash-based, inside the react-router hash space)    */
/* ------------------------------------------------------------------ */
const APP_ROUTES: {
  path: string;
  render: (path: string) => ReactElement;
}[] = [
  { path: "/login", render: () => <LoginPage /> },
  { path: "/signup", render: () => <SignupPage /> },
  { path: "/reset", render: () => <ResetPage /> },
  { path: "/overview", render: () => <OverviewPage /> },
  { path: "/find", render: () => <FindPage /> },
  { path: "/search-history", render: () => <SearchHistoryPage /> },
  { path: "/leads", render: () => <LeadsPage /> },
  {
    path: "/leads/",
    render: (p) => <LeadDetailPage id={p.replace("/leads/", "")} />,
  },
  { path: "/lists", render: () => <ListsPage /> },
  { path: "/lists/", render: (p) => <ListDetailPage id={p.replace("/lists/", "")} /> },
  { path: "/exports", render: () => <ExportsPage /> },
  { path: "/team", render: () => <TeamPage /> },
  { path: "/workspaces", render: () => <WorkspacesPage /> },
  {
    path: "/workspaces/",
    render: (p) => <WorkspaceDetailPage id={p.replace("/workspaces/", "")} />,
  },
  { path: "/billing", render: () => <BillingPage /> },
  { path: "/usage", render: () => <UsagePage /> },
  { path: "/settings", render: () => <SettingsPage /> },
];

function AuthSplash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper" role="status" aria-label="Loading Zybble">
      <div className="flex flex-col items-center gap-3">
        <span className="size-6 animate-spin rounded-full border-2 border-black/[0.08] border-t-brand-600" aria-hidden="true" />
        <p className="text-xs text-ink-mute">Loading your workspace…</p>
      </div>
    </div>
  );
}

const AUTH_PATHS = new Set(["/login", "/signup", "/reset"]);

function LeadApp() {
  const user = useAuthUser();
  const { path } = useAppRoute();

  useEffect(() => {
    if (!BACKEND_ENABLED) return;
    if (user === "loading") return;
    if (!user && !AUTH_PATHS.has(path)) {
      navigate("/login");
    } else if (user && AUTH_PATHS.has(path)) {
      navigate("/overview");
    }
  }, [user, path]);

  if (BACKEND_ENABLED) {
    if (user === "loading") return <AuthSplash />;
    if (!user && !AUTH_PATHS.has(path)) return <AuthSplash />;
    if (user && AUTH_PATHS.has(path)) return <AuthSplash />;
  }

  const route = APP_ROUTES.find((r) => path === r.path || path.startsWith(r.path));
  return (
    <ToastProvider>
      {route ? route.render(path) : <OverviewPage />}
      <CommandPalette />
    </ToastProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
function isLeadAppPath(pathname: string) {
  return APP_ROUTES.some(
    (r) => pathname === r.path || pathname.startsWith(r.path)
  );
}

function RoutedApp() {
  useScrollToHash();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<AppOrHome />} />
      </Routes>
    </>
  );
}

/**
 * Embeds the lead app for any `/app`-style route, falls back to Home.
 * With the single-file hash router, react-router sees these as real paths.
 */
function AppOrHome() {
  return <RoutedAppInner />;
}

function RoutedAppInner() {
  const { path } = useAppRoute();
  if (isLeadAppPath(path)) return <LeadApp />;
  return <Home />;
}

export default function App() {
  return (
    <HashRouter>
      <RoutedApp />
    </HashRouter>
  );
}
