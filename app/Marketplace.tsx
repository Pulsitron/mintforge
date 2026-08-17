"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Chain = { id: string; name: string; native: string; mark: string; colour: string };
type MediaKind = "image" | "video" | "audio" | "model" | "html" | "document" | "unknown";

type WalletNft = {
  contract: string | null;
  tokenId: string;
  standard: string;
  collection: string | null;
  name: string;
  image: string | null;
  animation: string | null;
  imageKind: MediaKind;
  animationKind: MediaKind;
};

type Offer = { id: string; bidder: string; amount: string; time: string };
type WalletPage = { items: WalletNft[]; cursor: string | null; nextCursor: string | null; totalCount: number | null };

type Listing = {
  id: string;
  name: string;
  collection: string;
  chain: string;
  accent: string;
  price: string;
  currency: string;
  standard: string;
  seller: string;
  tokenId: string;
  description: string;
  traits: { trait_type: string; value: string }[];
  offers: Offer[];
  isMine?: boolean;
};

const sampleListings: Listing[] = [
  { id: "l1", name: "Genesis Collectibles #340", collection: "Genesis Collectibles", chain: "PulseChain", accent: "violet", price: "0.45", currency: "PLS", standard: "ERC-721", seller: "0x9f2c…41ab", tokenId: "340", description: "Part of the Genesis Collectibles founding series.", traits: [{ trait_type: "Background", value: "Blue" }, { trait_type: "Eyes", value: "Green" }, { trait_type: "Rarity", value: "Common" }], offers: [{ id: "o1", bidder: "0x1a4…9c", amount: "0.38", time: "2h ago" }] },
  { id: "l2", name: "Sunset Editions #12", collection: "Sunset Editions", chain: "Ethereum", accent: "pink", price: "1.2", currency: "ETH", standard: "ERC-1155", seller: "0x77bd…8e21", tokenId: "12", description: "Limited edition sunset artwork.", traits: [{ trait_type: "Palette", value: "Warm" }, { trait_type: "Edition", value: "12 / 1000" }], offers: [] },
  { id: "l3", name: "Untitled Drop #45", collection: "Untitled Drop", chain: "Base", accent: "cyan", price: "0.08", currency: "ETH", standard: "ERC-721", seller: "0xbd65…dfb9", tokenId: "45", description: "Early access piece from an emerging collection.", traits: [{ trait_type: "Type", value: "Glyph" }], offers: [{ id: "o2", bidder: "0x2f9…d1", amount: "0.06", time: "5h ago" }, { id: "o3", bidder: "0x8c1…44", amount: "0.07", time: "40m ago" }], isMine: true },
  { id: "l4", name: "Genesis Collectibles #91", collection: "Genesis Collectibles", chain: "PulseChain", accent: "lime", price: "0.6", currency: "PLS", standard: "ERC-721", seller: "0xbd65…dfb9", tokenId: "91", description: "Part of the Genesis Collectibles founding series.", traits: [{ trait_type: "Background", value: "Purple" }, { trait_type: "Eyes", value: "Silver" }, { trait_type: "Rarity", value: "Legendary" }], offers: [], isMine: true },
];

function shortened(value: string | null) {
  if (!value) return "—";
  return value.length > 14 ? value.slice(0, 6) + "…" + value.slice(-4) : value;
}

function gatewayCandidates(uri: string) {
  try {
    const parsed = new URL(uri);
    if (parsed.hostname !== "ipfs.io" || !parsed.pathname.startsWith("/ipfs/")) return [uri];
    const path = parsed.pathname.slice(6);
    const [cid, ...restParts] = path.split("/");
    if (!cid) return [uri];
    const suffix = restParts.length ? "/" + restParts.join("/") : "/";
    return [...new Set([
      uri,
      "https://dweb.link/ipfs/" + path + parsed.search,
      ...(cid.toLowerCase().startsWith("b") ? ["https://" + cid + ".ipfs.dweb.link" + suffix + parsed.search] : []),
      "https://nftstorage.link/ipfs/" + path + parsed.search,
    ])];
  } catch {
    return [uri];
  }
}

function AssetThumb({ asset }: { asset: WalletNft }) {
  const previewImage = asset.imageKind === "image" ? asset.image : asset.animationKind === "image" ? asset.animation : null;
  const previewVideo = asset.animationKind === "video" ? asset.animation : asset.imageKind === "video" ? asset.image : null;
  const source = previewVideo || previewImage;
  const sources = useMemo(() => (source ? gatewayCandidates(source) : []), [source]);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!source || failed || attemptIndex >= sources.length) {
    return <div className="collection-item-fallback">{asset.standard || "NFT"}</div>;
  }
  const activeUri = sources[attemptIndex];
  const handleError = () => {
    if (attemptIndex + 1 < sources.length) setAttemptIndex(attemptIndex + 1);
    else setFailed(true);
  };
  if (previewVideo) return <video src={activeUri} muted loop playsInline preload="metadata" onError={handleError} />;
  return <img src={activeUri} alt={asset.name} loading="lazy" onError={handleError} />;
}

function ListingThumb({ listing }: { listing: Listing }) {
  return <div className={`listing-thumb accent-${listing.accent}`}><span>{listing.collection.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase()}</span></div>;
}

export default function Marketplace({ chain, wallet, onConnectWallet }: { chain: Chain; wallet: string; onConnectWallet: () => void }) {
  const [view, setView] = useState<"browse" | "listing" | "mine" | "list-new">("browse");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offerAmount, setOfferAmount] = useState("");
  const [notice, setNotice] = useState("");

  const [walletPages, setWalletPages] = useState<WalletPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetsError, setAssetsError] = useState("");
  const [pickedAsset, setPickedAsset] = useState<string | null>(null);
  const [listPrice, setListPrice] = useState("");
  const [listType, setListType] = useState<"fixed" | "offers">("fixed");
  const assetRequest = useRef(0);

  const currentPage = walletPages[pageIndex] || null;
  const walletAssets = currentPage?.items || [];
  const pageTotal = currentPage?.totalCount ?? walletPages[0]?.totalCount ?? null;

  const loadWalletPage = useCallback(async (cursor: string | null, reset = false) => {
    if (!wallet) return;
    const requestId = ++assetRequest.current;
    setLoadingAssets(true);
    setAssetsError("");
    try {
      const params = new URLSearchParams({ wallet, chainId: chain.id });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch("/api/wallet-nfts?" + params.toString());
      const data = await response.json() as { items?: WalletNft[]; nextCursor?: string | null; totalCount?: number | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load wallet NFTs.");
      if (requestId !== assetRequest.current) return;
      const page: WalletPage = { items: data.items || [], cursor, nextCursor: data.nextCursor || null, totalCount: data.totalCount ?? null };
      if (reset) { setWalletPages([page]); setPageIndex(0); }
      else { setWalletPages((pages) => [...pages, page]); setPageIndex((index) => index + 1); }
    } catch (cause) {
      if (requestId === assetRequest.current) setAssetsError(cause instanceof Error ? cause.message : "Unable to load wallet NFTs.");
    } finally {
      if (requestId === assetRequest.current) setLoadingAssets(false);
    }
  }, [chain.id, wallet]);

  useEffect(() => {
    if (view !== "list-new" || !wallet) return;
    setWalletPages([]);
    setPageIndex(0);
    loadWalletPage(null, true);
  }, [view, wallet, chain.id, loadWalletPage]);

  function nextAssetPage() {
    if (walletPages[pageIndex + 1]) { setPageIndex(pageIndex + 1); return; }
    if (currentPage?.nextCursor) loadWalletPage(currentPage.nextCursor);
  }

  const selected = sampleListings.find((l) => l.id === selectedId) || null;
  const myListings = useMemo(() => sampleListings.filter((l) => l.isMine), []);

  function openListing(id: string) {
    setSelectedId(id);
    setOfferAmount("");
    setView("listing");
  }

  function previewAction(message: string) {
    setNotice(message);
  }

  return (
    <section className="market-page">
      <div className="dashboard-heading">
        <div><span className="section-number">SECONDARY MARKET</span><h1>Buy, sell and<br /><em>trade freely.</em></h1><p>Browse listings, place offers, or list your own NFTs for sale — all in one place.</p></div>
        <div className="stake-hero-status"><i style={{ background: chain.colour }}>{chain.mark}</i><div><span>ACTIVE NETWORK</span><b>{chain.name}</b><small>{wallet ? shortened(wallet) : "Wallet not connected"}</small></div></div>
      </div>

      <div className="interface-banner"><span>UI</span><div><b>Interface release</b><p>Listings shown are sample data. Buying, offers and cancellations activate once your audited marketplace contract is deployed.</p></div><i>CONTRACTS NEXT</i></div>

      <div className="market-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "browse"} className={view === "browse" ? "active" : ""} onClick={() => setView("browse")}>Browse</button>
        <button type="button" role="tab" aria-selected={view === "mine"} className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>My listings &amp; offers</button>
        <button type="button" role="tab" aria-selected={view === "list-new"} className={view === "list-new" ? "active" : ""} onClick={() => setView("list-new")}>List an NFT</button>
      </div>

      {view === "browse" && (
        <div className="market-grid">
          {sampleListings.map((listing) => (
            <button type="button" className="market-card" key={listing.id} onClick={() => openListing(listing.id)}>
              <ListingThumb listing={listing} />
              <div className="market-card-body">
                <span>{listing.collection}</span>
                <b>{listing.name}</b>
                <div className="market-card-price"><strong>{listing.price} {listing.currency}</strong>{listing.offers.length > 0 && <small>{listing.offers.length} offer{listing.offers.length === 1 ? "" : "s"}</small>}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {view === "listing" && selected && (
        <div className="market-detail">
          <button type="button" className="secondary-action market-back" onClick={() => setView("browse")}>← Back to browse</button>
          <div className="market-detail-grid">
            <div className="market-detail-media"><ListingThumb listing={selected} /></div>
            <div className="market-detail-info">
              <span>{selected.collection}</span>
              <h2>{selected.name}</h2>
              <p>{selected.description}</p>
              <div className="market-detail-price-row">
                <div><span>PRICE</span><strong>{selected.price} {selected.currency}</strong></div>
                <button type="button" className="dashboard-connect-prompt-btn" onClick={() => wallet ? previewAction(`Buy now is ready for contract integration. ${selected.name} remains unchanged in this interface release.`) : onConnectWallet()}>{wallet ? "Buy now" : "Connect wallet to buy"}</button>
              </div>
              <div className="market-offer-form">
                <label><span>PLACE AN OFFER</span><div className="input-prefix"><i>{selected.currency}</i><input type="number" min="0" step="0.001" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} placeholder="0.00" /></div></label>
                <button type="button" className="secondary-action" onClick={() => wallet ? previewAction(`Offer of ${offerAmount || "0"} ${selected.currency} is ready for contract integration. No offer was actually submitted.`) : onConnectWallet()}>{wallet ? "Submit offer" : "Connect wallet"}</button>
              </div>
              {selected.traits.length > 0 && (
                <div className="market-traits"><span className="field-label-standalone">TRAITS</span><div className="trait-grid">{selected.traits.map((t, i) => <div key={i}><span>{t.trait_type}</span><b>{t.value}</b></div>)}</div></div>
              )}
              {selected.offers.length > 0 && (
                <div className="market-offers-list">
                  <span className="field-label-standalone">OFFERS RECEIVED</span>
                  {selected.offers.map((o) => <div className="market-offer-row" key={o.id}><span>{shortened(o.bidder)}</span><b>{o.amount} {selected.currency}</b><small>{o.time}</small></div>)}
                </div>
              )}
              <div className="market-provenance"><span>Seller</span><b>{shortened(selected.seller)}</b><span>Token ID</span><b>#{selected.tokenId}</b><span>Standard</span><b>{selected.standard}</b></div>
            </div>
          </div>
        </div>
      )}

      {view === "mine" && (
        <div className="market-mine">
          {myListings.length === 0 && <p className="field-hint">You have no active listings in this sample set.</p>}
          {myListings.map((listing) => (
            <div className="dashboard-collection-card" key={listing.id}>
              <div className="dashboard-collection-head">
                <div><b>{listing.name}</b><small>{listing.collection} · {listing.chain}</small></div>
                <span className="choice-tag">SAMPLE</span>
              </div>
              <div className="dashboard-collection-stats">
                <div><span>Listed price</span><b>{listing.price} {listing.currency}</b></div>
                <div><span>Offers received</span><b>{listing.offers.length}</b></div>
              </div>
              {listing.offers.length > 0 && (
                <div className="market-offers-list">
                  {listing.offers.map((o) => (
                    <div className="market-offer-row" key={o.id}>
                      <span>{shortened(o.bidder)}</span><b>{o.amount} {listing.currency}</b><small>{o.time}</small>
                      <button type="button" className="secondary-action" onClick={() => previewAction(`Accepting ${o.amount} ${listing.currency} is ready for contract integration. ${listing.name} remains unchanged.`)}>Accept</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="dashboard-actions">
                <button type="button" className="secondary-action" onClick={() => previewAction(`Price update is ready for contract integration. ${listing.name} remains unchanged.`)}>Update price</button>
                <button type="button" className="secondary-action" onClick={() => previewAction(`Cancel listing is ready for contract integration. ${listing.name} remains listed in this interface release.`)}>Cancel listing</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "list-new" && (
        <div className="market-list-new">
          {!wallet && <div className="dashboard-connect-prompt"><p>Connect a wallet to see which NFTs you own and can list for sale.</p><button type="button" onClick={onConnectWallet}>Connect wallet <span>→</span></button></div>}
          {wallet && loadingAssets && <div className="wallet-gallery-loading">{Array.from({ length: 4 }, (_, i) => <div key={i}><i /><span /><b /></div>)}</div>}
          {wallet && assetsError && <div className="viewer-error" role="alert"><span>!</span><div><b>Couldn't load your NFTs</b><p>{assetsError}</p></div></div>}
          {wallet && !loadingAssets && !assetsError && walletAssets.length === 0 && <p className="field-hint">No indexed NFTs found in this wallet on {chain.name}.</p>}
          {wallet && !loadingAssets && walletAssets.length > 0 && (
            <>
              <div className="market-pick-grid">
                {walletAssets.map((asset) => {
                  const key = `${asset.contract || "x"}:${asset.tokenId}`;
                  return (
                    <button type="button" key={key} className={pickedAsset === key ? "market-pick-card selected" : "market-pick-card"} onClick={() => setPickedAsset(key)}>
                      <div className="market-pick-media"><AssetThumb asset={asset} /></div>
                      <b>{asset.name}</b><small>#{asset.tokenId}</small>
                    </button>
                  );
                })}
              </div>
              <div className="gallery-pagination">
                <button type="button" onClick={() => setPageIndex(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0}>← Previous 12</button>
                <span><b>{pageIndex + 1}</b><i />{pageTotal !== null ? Math.min((pageIndex + 1) * 12, pageTotal) + " of " + pageTotal : "12 per batch"}</span>
                <button type="button" onClick={nextAssetPage} disabled={!currentPage?.nextCursor && !walletPages[pageIndex + 1]}>Next 12 →</button>
              </div>
              {pickedAsset && (
                <div className="market-list-form">
                  <div className="segmented"><button type="button" className={listType === "fixed" ? "active" : ""} onClick={() => setListType("fixed")}>Fixed price</button><button type="button" className={listType === "offers" ? "active" : ""} onClick={() => setListType("offers")}>Accept offers only</button></div>
                  {listType === "fixed" && <label className="field top-gap"><span>LISTING PRICE</span><div className="input-prefix"><i>{chain.native}</i><input type="number" min="0" step="0.001" value={listPrice} onChange={(e) => setListPrice(e.target.value)} placeholder="0.00" /></div></label>}
                  <button type="button" className="dashboard-connect-prompt-btn top-gap" onClick={() => previewAction("Listing is ready for contract integration. No NFT was transferred or listed in this interface release.")}>List for sale</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {notice && <div className="dashboard-notice"><p>{notice}</p><button type="button" onClick={() => setNotice("")}>×</button></div>}
    </section>
  );
}