"use client";

import { createElement, FormEvent, HTMLAttributes, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Chain = { id: string; name: string; mark: string; colour: string };
type MediaKind = "image" | "video" | "audio" | "model" | "html" | "document" | "unknown";

type Attribute = { trait_type: string; value: string; display_type?: string | null };

type NftData = {
  source: "contract" | "direct";
  standard: string;
  network: string | null;
  contract: string | null;
  tokenId: string | null;
  tokenUri: string;
  metadataUri: string;
  collection: string | null;
  symbol: string | null;
  owner: string | null;
  metadata: {
    name: string | null;
    description: string | null;
    image: string | null;
    animation_url: string | null;
    external_url: string | null;
    background_color: string | null;
    attributes: Attribute[];
    image_kind: MediaKind;
    animation_kind: MediaKind;
  };
  raw: Record<string, unknown>;
};

type WalletNft = {
  contract: string | null;
  tokenId: string;
  standard: string;
  balance: string;
  collection: string | null;
  symbol: string | null;
  network: string;
  name: string;
  description: string | null;
  image: string | null;
  animation: string | null;
  imageKind: MediaKind;
  animationKind: MediaKind;
  externalUrl: string | null;
  attributes: Attribute[];
};

type GalleryPage = { items: WalletNft[]; cursor: string | null; nextCursor: string | null; totalCount: number | null };

function shortened(value: string | null, start = 8, end = 6) {
  if (!value) return "—";
  return value.length > start + end + 2 ? value.slice(0, start) + "…" + value.slice(-end) : value;
}

function ModelMedia({ src, poster }: { src: string; poster?: string | null }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let current = true;
    if (customElements.get("model-viewer")) {
      setReady(true);
      return;
    }
    import("@google/model-viewer")
      .then(() => { if (current) setReady(true); })
      .catch(() => { if (current) setReady(false); });
    return () => { current = false; };
  }, []);

  if (!ready) return <div className="model-loading"><span>◇</span><b>Preparing 3D viewer…</b></div>;

  const props = {
    src,
    poster: poster || undefined,
    "camera-controls": "",
    "auto-rotate": "",
    autoplay: "",
    "shadow-intensity": "1",
    "environment-image": "neutral",
    "touch-action": "pan-y",
    alt: "Interactive 3D NFT",
    className: "model-viewer",
  } as HTMLAttributes<HTMLElement>;

  return createElement("model-viewer", props);
}

function gatewayCandidates(uri: string) {
  try {
    const parsed = new URL(uri);
    if (parsed.hostname !== "ipfs.io" || !parsed.pathname.startsWith("/ipfs/")) return [uri];
    const path = parsed.pathname.slice(6);
    const [cid, ...restParts] = path.split("/");
    if (!cid) return [uri];
    const suffix = restParts.length ? "/" + restParts.join("/") : "/";
    const candidates = [
      uri,
      "https://dweb.link/ipfs/" + path + parsed.search,
      ...(cid.toLowerCase().startsWith("b") ? ["https://" + cid + ".ipfs.dweb.link" + suffix + parsed.search] : []),
      "https://nftstorage.link/ipfs/" + path + parsed.search,
    ];
    return [...new Set(candidates)];
  } catch {
    return [uri];
  }
}

function ResilientImage({ src, alt, className, loading, fallback = null }: { src: string; alt: string; className?: string; loading?: "lazy" | "eager"; fallback?: ReactNode }) {
  const sources = useMemo(() => gatewayCandidates(src), [src]);
  const [attempt, setAttempt] = useState({ uri: src, index: 0 });
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const sourceIndex = attempt.uri === src ? attempt.index : 0;
  if (failedUri === src) return fallback;
  return <img className={className} src={sources[sourceIndex]} alt={alt} loading={loading} onError={() => {
    if (sourceIndex + 1 < sources.length) setAttempt({ uri: src, index: sourceIndex + 1 });
    else setFailedUri(src);
  }} />;
}

function ResilientVideo({ src, poster, className, fallback = null }: { src: string; poster?: string | null; className?: string; fallback?: ReactNode }) {
  const sources = useMemo(() => gatewayCandidates(src), [src]);
  const [attempt, setAttempt] = useState({ uri: src, index: 0 });
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const sourceIndex = attempt.uri === src ? attempt.index : 0;
  if (failedUri === src) return fallback;
  return <video
    className={className}
    src={sources[sourceIndex]}
    poster={poster || undefined}
    autoPlay
    loop
    muted
    playsInline
    preload="metadata"
    onError={() => {
      if (sourceIndex + 1 < sources.length) setAttempt({ uri: src, index: sourceIndex + 1 });
      else setFailedUri(src);
    }}
  />;
}

function MediaRenderer({ uri, kind, poster, name }: { uri: string; kind: MediaKind; poster?: string | null; name: string }) {
  const sources = useMemo(() => gatewayCandidates(uri), [uri]);
  const [attempt, setAttempt] = useState({ uri, index: 0 });
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const sourceIndex = attempt.uri === uri ? attempt.index : 0;
  const activeUri = sources[sourceIndex];
  const failed = failedUri === uri;
  const handleError = () => {
    if (sourceIndex + 1 < sources.length) setAttempt({ uri, index: sourceIndex + 1 });
    else setFailedUri(uri);
  };

  if (failed) return <div className="media-fallback"><span>?</span><h3>This file needs its native viewer</h3><p>The NFT exists, but this browser could not render the media inline.</p><a href={uri} target="_blank" rel="noreferrer">Open original file ↗</a></div>;
  if (kind === "image") return <img className="universal-image" src={activeUri} alt={name} onError={handleError} />;
  if (kind === "video") return <video className="universal-video" src={activeUri} poster={poster || undefined} controls autoPlay loop muted playsInline preload="auto" onError={handleError} />;
  if (kind === "audio") return <div className="universal-audio">{poster ? <ResilientImage src={poster} alt="" /> : <span className="audio-glyph">♪</span>}<div><b>{name}</b><small>AUDIO NFT</small><audio src={activeUri} controls autoPlay loop onError={handleError} /></div></div>;
  if (kind === "model") return <ModelMedia src={uri} poster={poster} />;
  if (kind === "document") return <iframe className="universal-frame" src={uri} title={name + " document"} referrerPolicy="no-referrer" />;
  return <iframe className="universal-frame" src={uri} title={name + " interactive NFT"} sandbox="allow-scripts allow-forms allow-pointer-lock" referrerPolicy="no-referrer" />;
}

function WalletThumbnail({ nft }: { nft: WalletNft }) {
  const previewImage = nft.imageKind === "image" ? nft.image : nft.animationKind === "image" ? nft.animation : null;
  const previewVideo = nft.animationKind === "video" ? nft.animation : nft.imageKind === "video" ? nft.image : null;
  const kind = nft.animationKind !== "unknown" ? nft.animationKind : nft.imageKind;
  const placeholder = <div className="wallet-nft-placeholder"><span>{kind === "unknown" ? "NFT" : kind.toUpperCase()}</span><i>◇</i></div>;
  if (previewVideo) return <ResilientVideo src={previewVideo} poster={previewImage} className="wallet-preview-video" fallback={previewImage ? <ResilientImage src={previewImage} alt={nft.name} loading="lazy" fallback={placeholder} /> : placeholder} />;
  if (previewImage) return <ResilientImage src={previewImage} alt={nft.name} loading="lazy" fallback={placeholder} />;
  return placeholder;
}

function FullscreenNft({ nft, chain, position, total, onClose, onPrevious, onNext }: { nft: WalletNft; chain: Chain; position: number; total: number; onClose: () => void; onPrevious: () => void; onNext: () => void }) {
  const mediaUri = nft.animation || nft.image;
  const mediaKind = nft.animation ? nft.animationKind : nft.imageKind;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, onNext, onPrevious]);

  return <div className="nft-fullscreen" role="dialog" aria-modal="true" aria-label={nft.name}>
    <div className="fullscreen-topbar"><div><span className="fullscreen-chain" style={{ background: chain.colour }}>{chain.mark}</span><b>{nft.collection || nft.symbol || "NFT COLLECTION"}</b><small>{position + 1} / {total}</small></div><button type="button" onClick={onClose} aria-label="Close full-screen NFT">×</button></div>
    <div className="fullscreen-body">
      <section className={"fullscreen-media kind-" + mediaKind}>
        {mediaUri ? <MediaRenderer uri={mediaUri} kind={mediaKind} poster={nft.animation ? nft.image : null} name={nft.name} /> : <div className="media-fallback"><span>∅</span><h3>Metadata-only NFT</h3><p>No displayable media URL was found.</p></div>}
        {total > 1 && <><button className="fullscreen-nav previous" type="button" onClick={onPrevious} aria-label="Previous NFT">←</button><button className="fullscreen-nav next" type="button" onClick={onNext} aria-label="Next NFT">→</button></>}
      </section>
      <aside className="fullscreen-info"><span>WALLET ASSET</span><h2>{nft.name}</h2><div className="fullscreen-badges"><b>{nft.standard}</b><b>#{nft.tokenId}</b>{nft.balance !== "1" && <b>× {nft.balance}</b>}</div>{nft.description && <p>{nft.description}</p>}<dl><div><dt>Network</dt><dd>{nft.network}</dd></div><div><dt>Contract</dt><dd title={nft.contract || ""}>{shortened(nft.contract)}</dd></div><div><dt>Collection</dt><dd>{nft.collection || "—"}</dd></div></dl>{nft.attributes.length > 0 && <div className="fullscreen-traits">{nft.attributes.slice(0, 12).map((trait, index) => <div key={trait.trait_type + index}><span>{trait.trait_type}</span><b>{trait.value}</b></div>)}</div>}{nft.externalUrl && <a href={nft.externalUrl} target="_blank" rel="noreferrer">Open creator page <span>↗</span></a>}</aside>
    </div>
  </div>;
}

export default function NftViewer({ chain, wallet, onConnectWallet }: { chain: Chain; wallet: string; onConnectWallet: () => void }) {
  const [sourceMode, setSourceMode] = useState<"wallet" | "contract" | "uri">("wallet");
  const [contract, setContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [uri, setUri] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<NftData | null>(null);
  const [activeMedia, setActiveMedia] = useState<"image" | "animation">("image");
  const [showAllTraits, setShowAllTraits] = useState(false);
  const [galleryPages, setGalleryPages] = useState<GalleryPage[]>([]);
  const [galleryPageIndex, setGalleryPageIndex] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState("");
  const [galleryView, setGalleryView] = useState<"grid" | "list">("grid");
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const galleryRequest = useRef(0);

  const currentGalleryPage = galleryPages[galleryPageIndex] || null;
  const walletItems = currentGalleryPage?.items || [];
  const batchStart = walletItems.length > 0
    ? galleryPages.slice(0, galleryPageIndex).reduce((total, page) => total + page.items.length, 0) + 1
    : 0;
  const batchEnd = batchStart > 0 ? batchStart + walletItems.length - 1 : 0;
  const galleryTotal = currentGalleryPage?.totalCount ?? galleryPages[0]?.totalCount ?? null;

  const loadWalletPage = useCallback(async (cursor: string | null, reset = false) => {
    if (!wallet) return;
    const requestId = ++galleryRequest.current;
    setGalleryLoading(true);
    setGalleryError("");
    try {
      const params = new URLSearchParams({ wallet, chainId: chain.id });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch("/api/wallet-nfts?" + params.toString());
      const data = await response.json() as { items?: WalletNft[]; nextCursor?: string | null; totalCount?: number | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load wallet NFTs.");
      if (requestId !== galleryRequest.current) return;
      const page = { items: data.items || [], cursor, nextCursor: data.nextCursor || null, totalCount: data.totalCount ?? null };
      if (reset) {
        setGalleryPages([page]);
        setGalleryPageIndex(0);
      } else {
        setGalleryPages((pages) => [...pages, page]);
        setGalleryPageIndex((index) => index + 1);
      }
    } catch (cause) {
      if (requestId === galleryRequest.current) setGalleryError(cause instanceof Error ? cause.message : "Unable to load wallet NFTs.");
    } finally {
      if (requestId === galleryRequest.current) setGalleryLoading(false);
    }
  }, [chain.id, wallet]);

  useEffect(() => {
    galleryRequest.current += 1;
    setGalleryPages([]);
    setGalleryPageIndex(0);
    setFullscreenIndex(null);
    setGalleryError("");
    if (wallet) loadWalletPage(null, true);
  }, [chain.id, loadWalletPage, wallet]);

  useEffect(() => {
    setResult(null);
    setError("");
  }, [chain.id]);

  const candidates = useMemo(() => {
    if (!result) return [];
    const items: Array<{ id: "image" | "animation"; label: string; uri: string; kind: MediaKind }> = [];
    if (result.metadata.image) items.push({ id: "image", label: "Artwork", uri: result.metadata.image, kind: result.metadata.image_kind });
    if (result.metadata.animation_url) items.push({ id: "animation", label: result.metadata.animation_kind === "model" ? "3D model" : "Animation", uri: result.metadata.animation_url, kind: result.metadata.animation_kind });
    return items;
  }, [result]);

  const currentMedia = candidates.find((item) => item.id === activeMedia) || candidates[0] || null;
  const visibleTraits = result?.metadata.attributes.slice(0, showAllTraits ? 100 : 8) || [];

  async function loadNft(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const payload = sourceMode === "contract" ? { chainId: chain.id, contract: contract.trim(), tokenId: tokenId.trim() } : { uri: uri.trim() };
      const response = await fetch("/api/nft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as NftData & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load this NFT.");
      setResult(data);
      setActiveMedia(data.metadata.animation_url ? "animation" : "image");
      setShowAllTraits(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load this NFT.");
    } finally {
      setLoading(false);
    }
  }

  function nextGalleryPage() {
    if (galleryPages[galleryPageIndex + 1]) {
      setGalleryPageIndex(galleryPageIndex + 1);
      return;
    }
    if (currentGalleryPage?.nextCursor) loadWalletPage(currentGalleryPage.nextCursor);
  }

  const fullscreenNft = fullscreenIndex === null ? null : walletItems[fullscreenIndex] || null;
  const previousFullscreen = useCallback(() => setFullscreenIndex((index) => index === null ? null : (index - 1 + walletItems.length) % walletItems.length), [walletItems.length]);
  const nextFullscreen = useCallback(() => setFullscreenIndex((index) => index === null ? null : (index + 1) % walletItems.length), [walletItems.length]);
  const closeFullscreen = useCallback(() => setFullscreenIndex(null), []);

  return <section className="viewer-page">
    <div className="viewer-heading"><div><span className="section-number">CONNECTED WALLET GALLERY</span><h1>Your wallet. Every <em>NFT.</em></h1><p>Browse owned ERC-721 and ERC-1155 assets in manageable batches, then open any NFT full screen.</p></div><div className="viewer-format-strip" aria-label="Supported NFT formats"><span>IMAGE</span><span>VIDEO</span><span>AUDIO</span><span>3D</span><span>HTML</span><span>SVG</span></div></div>

    <div className="viewer-search">
      <div className="viewer-search-top"><div><span>VIEW SOURCE</span><div className="viewer-source-tabs"><button type="button" className={sourceMode === "wallet" ? "active" : ""} onClick={() => setSourceMode("wallet")}>Connected wallet</button><button type="button" className={sourceMode === "contract" ? "active" : ""} onClick={() => setSourceMode("contract")}>Contract + token ID</button><button type="button" className={sourceMode === "uri" ? "active" : ""} onClick={() => setSourceMode("uri")}>Direct URI</button></div></div><div className="viewer-network"><span style={{ background: chain.colour }}>{chain.mark}</span><div><small>VIEWING NETWORK</small><b>{chain.name}</b></div></div></div>
      {sourceMode === "wallet" ? <div className="wallet-lookup-row"><div><span className={wallet ? "wallet-live-dot online" : "wallet-live-dot"} /><small>{wallet ? "CONNECTED WALLET" : "WALLET REQUIRED"}</small><b>{wallet ? shortened(wallet, 10, 8) : "Connect to reveal your collection"}</b></div>{wallet ? <button type="button" onClick={() => loadWalletPage(null, true)} disabled={galleryLoading}>{galleryLoading ? "Syncing…" : "Refresh gallery"}<span>↻</span></button> : <button type="button" onClick={onConnectWallet}>Connect wallet <span>→</span></button>}</div> : <form onSubmit={loadNft}>{sourceMode === "contract" ? <div className="viewer-input-row"><label><span>NFT CONTRACT ADDRESS</span><input value={contract} onChange={(event) => setContract(event.target.value)} placeholder="0x…" spellCheck={false} required /></label><label><span>TOKEN ID</span><input value={tokenId} onChange={(event) => setTokenId(event.target.value)} placeholder="e.g. 1" spellCheck={false} required /></label><button type="submit" disabled={loading}>{loading ? "Loading…" : "View NFT"}<span>→</span></button></div> : <div className="viewer-input-row direct"><label><span>IPFS, ARWEAVE, HTTPS OR ON-CHAIN DATA URI</span><input value={uri} onChange={(event) => setUri(event.target.value)} placeholder="ipfs://… or data:application/json,…" spellCheck={false} required /></label><button type="submit" disabled={loading}>{loading ? "Loading…" : "Open asset"}<span>→</span></button></div>}</form>}
      <p className="viewer-hint"><i /> Read-only viewer. No approvals, signatures or blockchain transactions.</p>
    </div>

    {sourceMode === "wallet" && <>
      {galleryError && <div className="viewer-error" role="alert"><span>!</span><div><b>Wallet gallery unavailable</b><p>{galleryError}</p></div><button onClick={() => setGalleryError("")} type="button">×</button></div>}
      {galleryLoading && <div className="wallet-gallery-loading">{Array.from({ length: 8 }, (_, index) => <div key={index}><i /><span /><b /></div>)}</div>}
      {!wallet && !galleryLoading && <div className="wallet-connect-empty"><div className="wallet-orb"><span>◇</span><i /></div><div><span>AUTOMATIC DISCOVERY</span><h2>Connect. Curate. Explore.</h2><p>Your public wallet address is used to find NFTs on the selected network. Nothing is signed and no transaction is created.</p><button type="button" onClick={onConnectWallet}>Connect wallet <span>→</span></button></div></div>}
      {wallet && !galleryLoading && !galleryError && walletItems.length === 0 && <div className="wallet-empty-state"><span>0 NFTs</span><h2>No indexed NFTs found on {chain.name}.</h2><p>Try another network, refresh the gallery, or use manual contract lookup for a newly minted token.</p></div>}
      {wallet && !galleryLoading && walletItems.length > 0 && <><div className="gallery-toolbar"><div><span>BATCH {String(galleryPageIndex + 1).padStart(2, "0")}</span><b>{galleryTotal !== null ? batchStart + "–" + batchEnd + " of " + galleryTotal + " NFTs" : walletItems.length + " NFTs loaded"}</b><small>{chain.name} · {shortened(wallet, 8, 6)}</small></div><div className="gallery-view-toggle" role="group" aria-label="Gallery layout"><button type="button" className={galleryView === "grid" ? "active" : ""} onClick={() => setGalleryView("grid")} aria-label="Grid view"><i className="grid-icon" /> Grid</button><button type="button" className={galleryView === "list" ? "active" : ""} onClick={() => setGalleryView("list")} aria-label="List view"><i className="list-icon" /> List</button></div></div>
        <div className={galleryView === "grid" ? "wallet-gallery grid" : "wallet-gallery list"}>{walletItems.map((nft, index) => <article className="wallet-nft-card" key={(nft.contract || "unknown") + ":" + nft.tokenId}><button className="wallet-nft-media" type="button" onClick={() => setFullscreenIndex(index)} aria-label={"Open " + nft.name + " full screen"}><WalletThumbnail nft={nft} /><span className="fullscreen-glyph">⛶</span><b>{nft.standard}</b></button><div className="wallet-nft-copy"><span>{nft.collection || nft.symbol || "UNNAMED COLLECTION"}</span><h3>{nft.name}</h3><div><b>#{nft.tokenId}</b>{nft.balance !== "1" && <small>× {nft.balance}</small>}<button type="button" onClick={() => setFullscreenIndex(index)}>Full screen ↗</button></div></div></article>)}</div>
        <div className="gallery-pagination"><button type="button" onClick={() => setGalleryPageIndex(Math.max(0, galleryPageIndex - 1))} disabled={galleryPageIndex === 0}>← Previous 12</button><span><b>{galleryPageIndex + 1}</b><i />{galleryTotal !== null ? batchEnd + " of " + galleryTotal : "12 per batch"}</span><button type="button" onClick={nextGalleryPage} disabled={!currentGalleryPage?.nextCursor && !galleryPages[galleryPageIndex + 1]}>{galleryTotal !== null && batchEnd < galleryTotal ? "Next " + Math.min(12, galleryTotal - batchEnd) + " →" : "Next 12 →"}</button></div></>}
    </>}

    {sourceMode !== "wallet" && error && <div className="viewer-error" role="alert"><span>!</span><div><b>We couldn’t display that NFT</b><p>{error}</p></div><button onClick={() => setError("")} type="button">×</button></div>}
    {sourceMode !== "wallet" && loading && <div className="viewer-loading"><div className="loading-canvas"><i /><i /><i /></div><div><span /><span /><span /><span /></div></div>}
    {sourceMode !== "wallet" && !loading && !result && <div className="viewer-empty"><div className="viewer-orbit"><span className="orbit-core">NFT</span><i className="orbit-one">IMG</i><i className="orbit-two">3D</i><i className="orbit-three">MP4</i><i className="orbit-four">♪</i></div><div><span>ONE VIEWER · EVERY FORMAT</span><h2>Bring any NFT into focus.</h2><p>Mint Forge resolves on-chain metadata, IPFS and Arweave links, then selects the right viewer for the asset.</p><div className="support-grid"><div><b>ERC-721</b><small>Unique tokens</small></div><div><b>ERC-1155</b><small>Editions</small></div><div><b>ON-CHAIN</b><small>SVG + data URIs</small></div><div><b>INTERACTIVE</b><small>HTML + 3D</small></div></div></div></div>}

    {sourceMode !== "wallet" && !loading && result && <div className="viewer-result"><section className="universal-stage"><div className="stage-toolbar"><div className="asset-tabs">{candidates.map((candidate) => <button key={candidate.id} type="button" className={currentMedia?.id === candidate.id ? "active" : ""} onClick={() => setActiveMedia(candidate.id)}>{candidate.label}</button>)}</div>{currentMedia && <a href={currentMedia.uri} target="_blank" rel="noreferrer">Open original ↗</a>}</div><div className={"stage-media kind-" + (currentMedia?.kind || "unknown")} style={result.metadata.background_color ? { backgroundColor: "#" + result.metadata.background_color } : undefined}>{currentMedia ? <MediaRenderer uri={currentMedia.uri} kind={currentMedia.kind} poster={currentMedia.id === "animation" ? result.metadata.image : null} name={result.metadata.name || "NFT"} /> : <div className="media-fallback"><span>∅</span><h3>No media URL found</h3><p>The metadata loaded, but it does not contain an image or animation field.</p></div>}<span className="stage-chain" style={{ background: chain.colour }}>{chain.mark}</span></div><div className="stage-foot"><span>{currentMedia?.kind.toUpperCase() || "METADATA ONLY"}</span><b>{result.standard}</b><small>{result.source === "contract" ? "On-chain lookup" : "Direct URI"}</small></div></section><aside className="viewer-metadata"><div className="metadata-title"><span>{result.collection || result.symbol || "NFT ASSET"}</span><h2>{result.metadata.name || "Untitled NFT"}</h2><div><b>{result.standard}</b>{result.network && <b>{result.network}</b>}{result.tokenId && <b>#{result.tokenId}</b>}</div></div>{result.metadata.description && <div className="metadata-description"><span>DESCRIPTION</span><p>{result.metadata.description}</p></div>}{visibleTraits.length > 0 && <div className="trait-section"><div className="metadata-section-title"><span>ATTRIBUTES</span><b>{result.metadata.attributes.length}</b></div><div className="trait-grid">{visibleTraits.map((attribute, index) => <div key={attribute.trait_type + index}><span>{attribute.trait_type}</span><b>{attribute.value}</b></div>)}</div>{result.metadata.attributes.length > 8 && <button type="button" onClick={() => setShowAllTraits(!showAllTraits)}>{showAllTraits ? "Show fewer" : "Show all " + result.metadata.attributes.length}</button>}</div>}<div className="provenance"><div className="metadata-section-title"><span>PROVENANCE</span></div>{result.contract && <div><span>Contract</span><b title={result.contract}>{shortened(result.contract)}</b></div>}{result.owner && <div><span>Owner</span><b title={result.owner}>{shortened(result.owner)}</b></div>}<div><span>Token URI</span><a href={result.metadataUri} target="_blank" rel="noreferrer" title={result.tokenUri}>{shortened(result.tokenUri, 14, 9)} ↗</a></div></div><details className="raw-metadata"><summary>Raw metadata <span>JSON</span></summary><pre>{JSON.stringify(result.raw, null, 2)}</pre></details>{result.metadata.external_url && <a className="creator-link" href={result.metadata.external_url} target="_blank" rel="noreferrer">Visit creator page <span>↗</span></a>}</aside></div>}

    {fullscreenNft && <FullscreenNft nft={fullscreenNft} chain={chain} position={fullscreenIndex || 0} total={walletItems.length} onClose={closeFullscreen} onPrevious={previousFullscreen} onNext={nextFullscreen} />}
  </section>;
}
