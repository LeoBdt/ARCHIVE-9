import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { signOut, type Viewer } from "../api.ts";
import { avatarColor, initials } from "../format.ts";

const LINKS = [
  { to: "/", label: "Noyau" },
  { to: "/archives", label: "Archives" },
  { to: "/relations", label: "Relations" },
  { to: "/memoire", label: "Mémoire" },
  { to: "/skills", label: "Skills" },
  { to: "/journal", label: "Journal" },
];

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
        Chercher un dossier
      </label>
      <input id={id} ref={input} type="search" className="search px-dim" placeholder="Chercher un dossier…  /" style={{ width: "100%" }} />
    </form>
  );
}

export function Header({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const links = viewer.isAdmin ? [...LINKS, { to: "/coulisses", label: "Coulisses · admin" }] : LINKS;
  return (
    <>
      <header className="top">
        <NavLink to="/" className="brand">
          ARCHIVE-9
        </NavLink>
        <nav aria-label="Navigation principale" className="nav">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === "/"} className={link.to === "/coulisses" ? "admin" : undefined}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <SearchBox className="search-desktop" id="search" />
        <button
          type="button"
          className="me px-dim"
          title="Se déconnecter"
          onClick={() => {
            void signOut();
          }}
        >
          <span className="avatar" style={{ width: 28, height: 28, background: avatarColor(viewer.id), fontSize: 12 }}>
            {initials(viewer.name)}
          </span>
          {viewer.name}
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
        <NavLink to="/archives">Archives</NavLink>
        <NavLink to="/skills">Skills</NavLink>
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
