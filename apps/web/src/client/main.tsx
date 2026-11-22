import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { getJson, HttpError, type Viewer } from "./api.ts";
import { Boot } from "./components/Boot.tsx";
import { Header } from "./components/Header.tsx";
import { Access } from "./pages/Access.tsx";
import { Archives } from "./pages/Archives.tsx";
import { Dossier } from "./pages/Dossier.tsx";
import { Home } from "./pages/Home.tsx";
import { Journal } from "./pages/Journal.tsx";
import { Memory } from "./pages/Memory.tsx";
import { Relations } from "./pages/Relations.tsx";
import { Skills } from "./pages/Skills.tsx";
import { Soon } from "./pages/Soon.tsx";

const queries = new QueryClient({ defaultOptions: { queries: { retry: (count, error) => !(error instanceof HttpError) && count < 2 } } });

function Site() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => getJson<Viewer>("/api/me") });
  if (me.isPending) return null;
  if (me.error instanceof HttpError && me.error.status === 403) return <Access refused />;
  if (!me.data) return <Navigate to="/acces" replace />;
  const viewer = me.data;
  return (
    <>
      <Boot />
      <Header viewer={viewer} />
      <Routes>
        <Route path="/" element={<Home viewer={viewer} />} />
        <Route path="/archives" element={<Archives />} />
        <Route path="/archives/:id" element={<Dossier />} />
        <Route path="/relations" element={<Relations />} />
        <Route path="/memoire" element={<Memory />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/journal" element={<Journal />} />
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
