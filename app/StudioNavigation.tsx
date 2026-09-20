"use client";

import { studioDestinations, type StudioDestination } from "../lib/studio-navigation";

export default function StudioNavigation({ active, onNavigate }: {
  active: StudioDestination;
  onNavigate: (destination: StudioDestination) => void;
}) {
  return (
    <nav className="studio-mode-switch" aria-label="MintForge features">
      {studioDestinations.map((destination) => (
        <a
          key={destination.id}
          href={destination.href}
          className={active === destination.id ? "active" : ""}
          aria-current={active === destination.id ? "page" : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate(destination.id);
          }}
        >
          {destination.label}
        </a>
      ))}
    </nav>
  );
}
