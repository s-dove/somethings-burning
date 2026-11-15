import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { watchSystemTheme } from "./components/ThemeSwitch";
import { BoardPage } from "./pages/BoardPage";
import { DsnPage } from "./pages/DsnPage";
import { IssuePage } from "./pages/IssuePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RbacPage } from "./pages/RbacPage";
import { RoutingPage } from "./pages/RoutingPage";
import { SettingsPage } from "./pages/SettingsPage";
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
          <Route path="/p/:id/issues/:issueId" element={<IssuePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    <Toaster position="bottom-right" />
  </StrictMode>,
);
