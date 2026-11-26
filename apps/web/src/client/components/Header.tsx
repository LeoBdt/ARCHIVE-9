import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { signOut, type Viewer } from "../api.ts";
import { Avatar } from "./Avatar.tsx";

const LINKS = [
  { to: "/", label: "Noyau" },
  { to: "/dossiers", label: "Dossiers" },
  { to: "/archives", label: "Archives" },
  { to: "/relations", label: "Relations" },
  { to: "/esprit", label: "Esprit" },
  { to: "/skills", label: "Skills" },
  { to: "/journal", label: "Journal" },
  { to: "/systeme", label: "Système" },
];

const ADMIN_LINKS = [{ to: "/admin", label: "Admin" }];
const isAdminLink = (to: string) => ADMIN_LINKS.some((l) => l.to === to);

function SearchBox({ className, id }: { className: string; id: string }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing && input.current?.offsetParent) {
        event.preventDefault();
        input.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <form
      role="search"
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const q = input.current?.value.trim() ?? "";
        void navigate(q ? `/archives?q=${encodeURIComponent(q)}` : "/archives");
      }}
    >
      <label htmlFor={id} className="sr-only">
        Fouiller les archives
      </label>
      <input id={id} ref={input} type="search" className="search px-dim" placeholder="Fouiller les archives…  /" style={{ width: "100%" }} />
    </form>
  );
}

export function Header({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const links = viewer.isAdmin ? [...LINKS, ...ADMIN_LINKS] : LINKS;
  return (
    <>
      <header className="top">
        <NavLink to="/" className="brand">
          ARCHIVE-9
        </NavLink>
        <nav aria-label="Navigation principale" className="nav">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === "/"} className={isAdminLink(link.to) ? "admin" : undefined}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <SearchBox className="search-desktop" id="search" />
        <NavLink to={`/dossiers/${viewer.id}`} className="me px-dim" title="Ton dossier">
          <Avatar id={viewer.id} name={viewer.name} hash={viewer.avatar} size={28} />
          {viewer.name}
        </NavLink>
        <button
          type="button"
          className="signout"
          onClick={() => {
            void signOut();
          }}
        >
          Sortir
        </button>
        <button
          type="button"
          className="menu-button px-dim"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <i />
          <i />
          <i />
        </button>
      </header>
      <nav aria-label="Navigation" className="bottom-nav">
        <NavLink to="/" end>
          Noyau
        </NavLink>
        <NavLink to="/dossiers">Dossiers</NavLink>
        <NavLink to="/archives">Archives</NavLink>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          Plus
        </button>
      </nav>
      {open && (
        <nav
          aria-label="Toutes les pages"
          className="sheet"
          onClick={() => {
            setOpen(false);
          }}
        >
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === "/"}>
              {link.label}
            </NavLink>
          ))}
          <NavLink to={`/dossiers/${viewer.id}`}>Mon dossier</NavLink>
          <a
            href="/acces"
            onClick={(event) => {
              event.preventDefault();
              void signOut();
            }}
          >
            Se déconnecter
          </a>
        </nav>
      )}
    </>
  );
}

export { SearchBox };
