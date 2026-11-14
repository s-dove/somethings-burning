import { BrowserRouter, Link, Route, Routes } from "react-router";
import { IssuePage } from "./pages/Issue";
import { ProjectPage } from "./pages/Project";
import { ProjectsPage } from "./pages/Projects";

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-950 text-neutral-200">
        <header className="border-b border-neutral-800">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-4">
            <Link to="/" className="flex items-center gap-2">
              <img src="/favicon.svg" alt="" className="h-6 w-6" />
              <span className="font-semibold tracking-tight">Something's burning</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectPage />} />
            <Route path="/projects/:projectId/issues/:issueId" element={<IssuePage />} />
            <Route path="*" element={<p className="text-neutral-400">Page not found.</p>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
