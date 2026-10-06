import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import AppShell, { RequireQuoting } from "@/components/app/AppShell";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";
import Experiences from "./pages/Experiences";
import ExperienceNew from "./pages/ExperienceNew";
import ExperienceDetail from "./pages/ExperienceDetail";
import MyWeek from "./pages/MyWeek";
import WeeklyStory from "./pages/WeeklyStory";
import Transport from "./pages/Transport";
import Activity from "./pages/Activity";
import Quotes from "./pages/Quotes";
import QuoteBuilder from "./pages/QuoteBuilder";
import AutoTrip from "./pages/AutoTrip";
import GlobalEvents from "./pages/GlobalEvents";
import Approvals from "./pages/Approvals";
import Agreement from "./pages/Agreement";
import ItineraryEditor from "./pages/ItineraryEditor";
import ItineraryPublic from "./pages/ItineraryPublic";
import SettingsPage from "./pages/settings/SettingsPage";
import ImportsPage from "./pages/settings/ImportsPage";
import NotFound from "./pages/NotFound";

/* Dev-only walkthrough harness (/__dev/tour): mock role, mock data, real shell. import.meta.env.DEV is replaced with
   `false` in production builds, so these become null and Rollup drops the dynamic imports: the harness never ships. */
const HarnessRoot = import.meta.env.DEV ? lazy(() => import("./dev/harness").then((m) => ({ default: m.HarnessRoot }))) : null;
const HarnessEntry = import.meta.env.DEV ? lazy(() => import("./dev/harness").then((m) => ({ default: m.HarnessEntry }))) : null;
const harnessOn = () => {
  if (!import.meta.env.DEV) return false;
  try { return window.location.pathname.startsWith("/__dev/tour") || sessionStorage.getItem("mm.dev.harness") !== null; } catch { return false; }
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="bottom-right" />
      <BrowserRouter>
        <AuthGate>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/a/:slug" element={<Agreement />} />
            <Route path="/it/:slug" element={<ItineraryPublic />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/experiences" replace />} />
              <Route path="/experiences" element={<Experiences />} />
              <Route path="/experiences/new" element={<ExperienceNew />} />
              <Route path="/experiences/:id" element={<ExperienceDetail />} />
              <Route path="/week" element={<MyWeek />} />
              <Route path="/week/story" element={<WeeklyStory />} />
              <Route path="/transport" element={<Transport />} />
              <Route path="/activity" element={<Activity />} />
              <Route element={<RequireQuoting />}>
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/quotes/auto" element={<AutoTrip />} />
                <Route path="/quotes/:id" element={<QuoteBuilder />} />
                <Route path="/quotes/:id/itinerary" element={<ItineraryEditor />} />
              </Route>
              <Route path="/global-events" element={<GlobalEvents />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/imports" element={<ImportsPage />} />
            </Route>
            {import.meta.env.DEV && HarnessEntry && <Route path="/__dev/tour" element={<Suspense fallback={null}><HarnessEntry /></Suspense>} />}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

/** The real AuthProvider, or (local dev only, while the harness is on) the harness's mock signed-in user. */
function AuthGate({ children }: { children: React.ReactNode }) {
  if (HarnessRoot && harnessOn()) return <Suspense fallback={null}><HarnessRoot>{children}</HarnessRoot></Suspense>;
  return <AuthProvider>{children}</AuthProvider>;
}

export default App;
