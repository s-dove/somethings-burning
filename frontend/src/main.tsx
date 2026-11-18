import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { ConfirmHost } from "./components/Confirm";
import { watchSystemTheme } from "./components/ThemeSwitch";
import { BoardPage } from "./pages/BoardPage";
import { DsnPage } from "./pages/DsnPage";
import { GroupingPage } from "./pages/GroupingPage";
import { IssueByNumber, OldIssueLink } from "./pages/IssuePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OwnershipPage } from "./pages/OwnershipPage";
import { ProfileNotificationsPage } from "./pages/ProfileNotificationsPage";
import { ProfileTokensPage } from "./pages/ProfileTokensPage";
import { ProfileMcpPage } from "./pages/ProfileMcpPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RbacPage } from "./pages/RbacPage";
import { ReleasesPage } from "./pages/ReleasesPage";
import { RoutingPage } from "./pages/RoutingPage";
import { ScrubbingPage } from "./pages/ScrubbingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { SiteSettingsPage } from "./pages/SiteSettingsPage";
import { SourceMapsPage } from "./pages/SourceMapsPage";
import { TokensPage } from "./pages/TokensPage";
import "./styles.css";
import { loadDictionary } from "./shared/i18n";
import { startSentry } from "./shared/sentry";

startSentry();
watchSystemTheme();

void loadDictionary().then(() => {
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/notifications" element={<ProfileNotificationsPage />} />
          <Route path="/profile/tokens" element={<ProfileTokensPage />} />
          <Route path="/profile/mcp" element={<ProfileMcpPage />} />
          <Route path="/settings" element={<SiteSettingsPage />} />
          <Route path="/p/:id" element={<BoardPage />} />
          <Route path="/p/:id/settings" element={<SettingsPage />} />
          <Route path="/p/:id/settings/dsn" element={<DsnPage />} />
          <Route path="/p/:id/settings/rbac" element={<RbacPage />} />
          <Route path="/p/:id/settings/notifications" element={<RoutingPage />} />
          <Route path="/p/:id/settings/code" element={<SourcesPage />} />
          <Route path="/p/:id/settings/sourcemaps" element={<SourceMapsPage />} />
          <Route path="/p/:id/settings/scrubbing" element={<ScrubbingPage />} />
          <Route path="/p/:id/settings/ownership" element={<OwnershipPage />} />
          <Route path="/p/:id/settings/grouping" element={<GroupingPage />} />
          <Route path="/p/:id/settings/tokens" element={<TokensPage />} />
          <Route path="/p/:id/releases" element={<ReleasesPage />} />
          <Route path="/issues/:issueId" element={<IssueByNumber />} />
          <Route path="/p/:id/issues/:issueId" element={<OldIssueLink />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    <Toaster position="bottom-right" />
    <ConfirmHost />
  </StrictMode>,
);
});
