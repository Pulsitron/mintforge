export type StudioMode = "create" | "viewer" | "stake" | "dashboard" | "market";
export type StudioDestination = StudioMode | "collection";

export const studioDestinations: { id: StudioDestination; label: string; href: string }[] = [
  { id: "create", label: "Create NFT", href: "/create" },
  { id: "collection", label: "Collection upload", href: "/collections/upload" },
  { id: "viewer", label: "View NFT", href: "/viewer" },
  { id: "stake", label: "Stake NFTs", href: "/staking" },
  { id: "dashboard", label: "Dashboard", href: "/dashboard" },
  { id: "market", label: "Marketplace", href: "/marketplace" },
];

export function destinationFromLocation(pathname: string, hash: string): StudioDestination {
  const legacy = hash.slice(1);
  if (studioDestinations.some((item) => item.id === legacy)) return legacy as StudioDestination;
  const path = pathname.replace(/\/$/, "") || "/";
  return studioDestinations.find((item) => item.href === path)?.id || "create";
}

export function destinationHref(destination: StudioDestination) {
  return studioDestinations.find((item) => item.id === destination)!.href;
}
