import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import { getJson, HttpError, type Viewer } from "./api.ts";
import { Boot } from "./components/Boot.tsx";
import { startLive } from "./live.ts";
import { Header } from "./components/Header.tsx";
import { Access } from "./pages/Access.tsx";
import { Dossiers } from "./pages/Dossiers.tsx";
import { Search } from "./pages/Search.tsx";
import { System } from "./pages/System.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Dossier } from "./pages/Dossier.tsx";
import { Home } from "./pages/Home.tsx";
import { Journal } from "./pages/Journal.tsx";
import { Mind } from "./pages/Mind.tsx";
import { Relations } from "./pages/Relations.tsx";
import { Skills } from "./pages/Skills.tsx";
import { Soon } from "./pages/Soon.tsx";

const queries = new QueryClient({ defaultOptions: { queries: { retry: (count, error) => !(error instanceof HttpError) && count < 2 } } });

/** Dossiers used to live under /archives: old links still land on them. */
function OldDossierLink() {
  const { id = "" } = useParams();
  return <Navigate to={`/dossiers/${id}`} replace />;
}

function Site() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => getJson<Viewer>("/api/me") });
  if (me.isPending) return null;
  if (me.error instanceof HttpError && me.error.status === 403) return <Access refused />;
  if (!me.data) return <Navigate to="/acces" replace />;
  const viewer = me.data;
  return <SignedIn viewer={viewer} />;
}

function SignedIn({ viewer }: { viewer: Viewer }) {
  useEffect(() => startLive(queries), []);
  return (
    <>
      <Boot />
      <Header viewer={viewer} />
      <Routes>
        <Route path="/" element={<Home viewer={viewer} />} />
        <Route path="/dossiers" element={<Dossiers />} />
        <Route path="/dossiers/:id" element={<Dossier />} />
        <Route path="/archives" element={<Search />} />
        <Route path="/archives/:id" element={<OldDossierLink />} />
        <Route path="/admin" element={<Settings viewer={viewer} />} />
        <Route path="/technique" element={<Navigate to="/admin?tab=technique" replace />} />
        <Route path="/relations" element={<Relations />} />
        <Route path="/esprit" element={<Mind viewer={viewer} />} />
        <Route path="/memoire" element={<Navigate to="/esprit" replace />} />
        <Route path="/skills" element={<Skills viewer={viewer} />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/systeme" element={<System />} />
        <Route path="/coulisses" element={<Navigate to="/systeme" replace />} />
        <Route path="/reglages" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Soon />} />
      </Routes>
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queries}>
        <BrowserRouter>
          <Routes>
            <Route path="/acces" element={<Access />} />
            <Route path="*" element={<Site />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
