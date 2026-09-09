import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import AppShell, { RequireQuoting } from "@/components/app/AppShell";
import Login from "./pages/Login";
import Experiences from "./pages/Experiences";
import ExperienceNew from "./pages/ExperienceNew";
import ExperienceDetail from "./pages/ExperienceDetail";
import MyWeek from "./pages/MyWeek";
import Transport from "./pages/Transport";
import Activity from "./pages/Activity";
import Quotes from "./pages/Quotes";
import QuoteBuilder from "./pages/QuoteBuilder";
import AutoTrip from "./pages/AutoTrip";
import GlobalEvents from "./pages/GlobalEvents";
import Approvals from "./pages/Approvals";
import Agreement from "./pages/Agreement";
import SettingsPage from "./pages/settings/SettingsPage";
import ImportsPage from "./pages/settings/ImportsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="bottom-right" />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/a/:slug" element={<Agreement />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/experiences" replace />} />
              <Route path="/experiences" element={<Experiences />} />
              <Route path="/experiences/new" element={<ExperienceNew />} />
              <Route path="/experiences/:id" element={<ExperienceDetail />} />
              <Route path="/week" element={<MyWeek />} />
              <Route path="/transport" element={<Transport />} />
              <Route path="/activity" element={<Activity />} />
              <Route element={<RequireQuoting />}>
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/quotes/auto" element={<AutoTrip />} />
                <Route path="/quotes/:id" element={<QuoteBuilder />} />
              </Route>
              <Route path="/global-events" element={<GlobalEvents />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/imports" element={<ImportsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
