import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { watchSystemTheme } from "./components/ThemeSwitch";
import { BoardPage } from "./pages/BoardPage";
import { IssuePage } from "./pages/IssuePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SettingsPage } from "./pages/SettingsPage";
import "./styles.css";

watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/p/:id" element={<BoardPage />} />
          <Route path="/p/:id/settings" element={<SettingsPage />} />
          <Route path="/p/:id/issues/:issueId" element={<IssuePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    <Toaster position="bottom-right" />
  </StrictMode>,
);
