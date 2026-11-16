import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { watchSystemTheme } from "./components/ThemeSwitch";
import { BoardPage } from "./pages/BoardPage";
import { DsnPage } from "./pages/DsnPage";
import { IssueByNumber, OldIssueLink } from "./pages/IssuePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OwnershipPage } from "./pages/OwnershipPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RbacPage } from "./pages/RbacPage";
import { RoutingPage } from "./pages/RoutingPage";
import { ScrubbingPage } from "./pages/ScrubbingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { SiteSettingsPage } from "./pages/SiteSettingsPage";
import "./styles.css";

watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SiteSettingsPage />} />
          <Route path="/p/:id" element={<BoardPage />} />
          <Route path="/p/:id/settings" element={<SettingsPage />} />
          <Route path="/p/:id/settings/dsn" element={<DsnPage />} />
          <Route path="/p/:id/settings/rbac" element={<RbacPage />} />
          <Route path="/p/:id/settings/notifications" element={<RoutingPage />} />
          <Route path="/p/:id/settings/code" element={<SourcesPage />} />
          <Route path="/p/:id/settings/scrubbing" element={<ScrubbingPage />} />
          <Route path="/p/:id/settings/ownership" element={<OwnershipPage />} />
          <Route path="/issues/:issueId" element={<IssueByNumber />} />
          <Route path="/p/:id/issues/:issueId" element={<OldIssueLink />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    <Toaster position="bottom-right" />
  </StrictMode>,
);
