"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Chain = { id: string; name: string; native: string; mark: string; colour: string };
type MediaKind = "image" | "video" | "audio" | "model" | "html" | "document" | "unknown";

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
};

type StakeAsset = WalletNft & { key: string; demo?: boolean; accent?: string };
type Position = { id: string; asset: StakeAsset; started: string; unlocks: string; earned: number; sample?: boolean };
type WalletPage = { items: StakeAsset[]; cursor: string | null; nextCursor: string | null; totalCount: number | null };

const demoAssets: StakeAsset[] = [
  { key: "demo-612", contract: null, tokenId: "612", standard: "ERC-721", balance: "1", collection: "Malware Bytes", symbol: "BYTE", network: "PulseChain", name: "Malware Byte #612", description: null, image: null, animation: null, imageKind: "unknown", animationKind: "html", demo: true, accent: "cyan" },
  { key: "demo-16", contract: null, tokenId: "16", standard: "ERC-721", balance: "1", collection: "Pulse Bytes", symbol: "PBYT", network: "PulseChain", name: "Pulse Byte #16", description: null, image: null, animation: null, imageKind: "image", animationKind: "unknown", demo: true, accent: "pink" },
  { key: "demo-10", contract: null, tokenId: "10", standard: "ERC-721", balance: "1", collection: "Mint-Ra", symbol: "MRA", network: "PulseChain", name: "Mint-Ra #10", description: null, image: null, animation: null, imageKind: "video", animationKind: "video", demo: true, accent: "violet" },
  { key: "demo-1", contract: null, tokenId: "1", standard: "ERC-721", balance: "1", collection: "Tangy Nymph", symbol: "TNYM", network: "PulseChain", name: "Tangy Nymph #1", description: null, image: null, animation: null, imageKind: "audio", animationKind: "audio", demo: true, accent: "lime" },
];

function shortAddress(value: string) {
  return value ? value.slice(0, 6) + "…" + value.slice(-4) : "";
}

function assetKey(nft: WalletNft) {
  return `${nft.contract || "metadata"}:${nft.tokenId}`;
}

function StakeMedia({ asset }: { asset: StakeAsset }) {
  if (!asset.demo) {
    const video = asset.animationKind === "video" ? asset.animation : asset.imageKind === "video" ? asset.image : null;
    const image = asset.imageKind === "image" ? asset.image : asset.animationKind === "image" ? asset.animation : null;
    if (video) return <video src={video} poster={image || undefined} autoPlay loop muted playsInline preload="metadata" />;
    if (image) return <img src={image} alt={asset.name} loading="lazy" />;
  }
  const kind = asset.animationKind !== "unknown" ? asset.animationKind : asset.imageKind;
  return <div className={`stake-demo-art ${asset.accent || "violet"}`}><span>{kind === "audio" ? "♪" : kind === "video" ? "▶" : kind === "html" ? "⌘" : "◇"}</span><i>{kind.toUpperCase()}</i></div>;
}

export default function NftStaking({ chain, wallet, onConnectWallet }: { chain: Chain; wallet: string; onConnectWallet: () => void }) {
  const [walletPages, setWalletPages] = useState<WalletPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [collection, setCollection] = useState("all");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lockDays, setLockDays] = useState("30");
  const [custody, setCustody] = useState<"vault" | "wallet">("vault");
  const [notice, setNotice] = useState("");
  const [previewTime] = useState(() => Date.now());
  const [positions, setPositions] = useState<Position[]>([
    { id: "sample-position", asset: demoAssets[0], started: "16 Aug 2026", unlocks: "15 Sep 2026", earned: 184.2, sample: true },
  ]);
  const request = useRef(0);

  const currentPage = walletPages[pageIndex] || null;
  const walletAssets = currentPage?.items || [];
  const pageTotal = currentPage?.totalCount ?? walletPages[0]?.totalCount ?? null;

  const loadWalletPage = useCallback(async (cursor: string | null, reset = false) => {
    if (!wallet) return;
    const requestId = ++request.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ wallet, chainId: chain.id });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch("/api/wallet-nfts?" + params.toString());
      const data = await response.json() as { items?: WalletNft[]; nextCursor?: string | null; totalCount?: number | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load wallet NFTs.");
      if (requestId !== request.current) return;
      const page: WalletPage = { items: (data.items || []).map((item) => ({ ...item, key: assetKey(item) })), cursor, nextCursor: data.nextCursor || null, totalCount: data.totalCount ?? null };
      if (reset) { setWalletPages([page]); setPageIndex(0); }
      else { setWalletPages((pages) => [...pages, page]); setPageIndex((index) => index + 1); }
    } catch (cause) {
      if (requestId === request.current) setError(cause instanceof Error ? cause.message : "Unable to load wallet NFTs.");
    } finally {
      if (requestId === request.current) setLoading(false);
    }
  }, [chain.id, wallet]);

  useEffect(() => {
    setSelected([]);
    setCollection("all");
    setWalletPages([]);
    setPageIndex(0);
    if (!wallet) { setError(""); return; }
    loadWalletPage(null, true);
  }, [chain.id, refreshNonce, wallet, loadWalletPage]);

  function nextAssetPage() {
    if (walletPages[pageIndex + 1]) { setPageIndex(pageIndex + 1); return; }
    if (currentPage?.nextCursor) loadWalletPage(currentPage.nextCursor);
  }

  const assets = wallet ? walletAssets : demoAssets;
  const collections = useMemo(() => [...new Set(assets.map((asset) => asset.collection || "Uncategorised"))], [assets]);
  const visibleAssets = collection === "all" ? assets : assets.filter((asset) => (asset.collection || "Uncategorised") === collection);
  const selectedAssets = assets.filter((asset) => selected.includes(asset.key));
  const dailyRate = 10;
  const dailyTotal = selectedAssets.length * dailyRate;

  function toggleAsset(key: string) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    setNotice("");
  }

  function simulateStake() {
    if (!wallet) {
      setNotice("Connect a wallet to stake owned NFTs. Demo assets are shown so you can inspect the interface.");
      return;
    }
    if (!selectedAssets.length) {
      setNotice("Select at least one eligible NFT first.");
      return;
    }
    const now = new Date();
    const unlock = new Date(now.getTime() + Number(lockDays) * 86400000);
    const additions = selectedAssets.map((asset) => ({
      id: `preview-${asset.key}`,
      asset,
      started: now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      unlocks: unlock.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      earned: 0,
    }));
    setPositions((current) => [...current.filter((position) => !position.sample), ...additions]);
    setSelected([]);
    setNotice("Staking position preview created locally. No NFT moved and no blockchain transaction was submitted.");
  }

  function previewAction(action: "claim" | "unstake", position: Position) {
    setNotice(`${action === "claim" ? "Claim" : "Unstake"} is ready for contract integration. ${position.asset.name} remains unchanged in this interface release.`);
  }

  return <div className="staking-portal">
    <section className="stake-hero">
      <div><span>HOLDER STAKING PORTAL</span><h1>Lock your NFTs.<br /><em>Earn continuously.</em></h1><p>Select eligible NFTs from your connected wallet, review the pool rules and manage every staking position from one place.</p></div>
      <div className="stake-hero-status"><i style={{ background: chain.colour }}>{chain.mark}</i><div><span>ACTIVE NETWORK</span><b>{chain.name}</b><small>{wallet ? shortAddress(wallet) : "Wallet not connected"}</small></div></div>
    </section>

    <div className="interface-banner"><span>UI</span><div><b>Interface release</b><p>Wallet discovery and position simulation are live. Approvals, staking, claims and withdrawals will activate when the audited contracts are connected.</p></div><i>CONTRACTS NEXT</i></div>
    {notice && <div className="stake-notice" role="status"><span>i</span><p>{notice}</p><button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}

    <section className="stake-metrics" aria-label="Staking overview">
      <div><span>WALLET NFTS FOUND</span><strong>{wallet ? walletAssets.length : "—"}</strong><small>{wallet ? "Eligibility activates with registry" : "Connect to verify"}</small></div>
      <div><span>CURRENT REWARD</span><strong>{dailyRate} <i>FORGE</i></strong><small>Per NFT / day</small></div>
      <div><span>YOUR ACTIVE STAKES</span><strong>{positions.filter((position) => !position.sample).length}</strong><small>{positions.some((position) => position.sample) ? "Sample position shown below" : "Live position preview"}</small></div>
      <div><span>CLAIMABLE</span><strong>{positions.filter((position) => !position.sample).reduce((sum, position) => sum + position.earned, 0).toFixed(1)} <i>FORGE</i></strong><small>Contract-calculated at launch</small></div>
    </section>

    <div className="stake-workspace-grid">
      <section className="stake-picker-panel">
        <div className="stake-panel-head"><div><span>01 · SELECT ASSETS</span><h2>NFTs in your wallet</h2><p>Only collections registered with an active MintForge staking pool will be eligible on-chain.</p></div>{wallet ? <button onClick={() => setRefreshNonce((current) => current + 1)}>Refresh wallet</button> : <button className="connect-inline" onClick={onConnectWallet}>Connect wallet</button>}</div>
        <div className="stake-filters"><label><span>COLLECTION</span><select value={collection} onChange={(event) => setCollection(event.target.value)}><option value="all">All collections</option>{collections.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><div><span>DISPLAY</span><b>{wallet ? `${visibleAssets.length} wallet NFTs` : "Demo assets"}</b></div><small><i /> Eligible pool check</small></div>

        {loading ? <div className="stake-loading"><i /><b>Scanning wallet NFTs…</b><p>Checking owned assets on {chain.name}.</p></div> : error ? <div className="stake-empty"><span>!</span><h3>Wallet scan unavailable</h3><p>{error}</p><button onClick={() => setRefreshNonce((current) => current + 1)}>Try again</button></div> : visibleAssets.length ? <>
          <div className="stake-nft-grid">
          {visibleAssets.map((asset) => {
            const checked = selected.includes(asset.key);
            return <button type="button" key={asset.key} className={checked ? "stake-nft selected" : "stake-nft"} onClick={() => toggleAsset(asset.key)} aria-pressed={checked}>
              <div className="stake-thumb"><StakeMedia asset={asset} /><span className="eligibility-dot">{asset.demo ? "ELIGIBLE DEMO" : "CHECK PENDING"}</span><i className="stake-check">{checked ? "✓" : "+"}</i></div>
              <div className="stake-asset-copy"><span>{asset.collection || asset.symbol || "NFT COLLECTION"}</span><b>{asset.name}</b><small>{asset.standard} · #{asset.tokenId}</small></div>
            </button>;
          })}
          </div>
          {wallet && (
            <div className="gallery-pagination">
              <button type="button" onClick={() => setPageIndex(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0}>← Previous 12</button>
              <span><b>{pageIndex + 1}</b><i />{pageTotal !== null ? Math.min((pageIndex + 1) * 12, pageTotal) + " of " + pageTotal : "12 per batch"}</span>
              <button type="button" onClick={nextAssetPage} disabled={!currentPage?.nextCursor && !walletPages[pageIndex + 1]}>Next 12 →</button>
            </div>
          )}
        </> : <div className="stake-empty"><span>∅</span><h3>No wallet NFTs found</h3><p>Your wallet does not currently expose any NFTs through the {chain.name} gallery index.</p></div>}
      </section>

      <aside className="stake-config-panel">
        <div className="stake-config-top"><span>02 · BUILD POSITION</span><h2>Stake configuration</h2><p>Your selected NFTs remain under your control until you approve the published contract.</p></div>
        <div className="selected-count"><div><span>SELECTED NFTS</span><strong>{selectedAssets.length}</strong></div><div><span>EST. DAILY REWARD</span><strong>{dailyTotal} <i>FORGE</i></strong></div></div>
        <div className="stake-option"><span>LOCK PERIOD</span><div className="lock-options">{["30", "90", "180"].map((days) => <button key={days} className={lockDays === days ? "active" : ""} onClick={() => setLockDays(days)}><b>{days}</b><small>days</small></button>)}</div></div>
        <div className="stake-option"><span>CUSTODY METHOD</span><div className="custody-options"><button className={custody === "vault" ? "active" : ""} onClick={() => setCustody("vault")}><i>◇</i><span><b>Vault contract</b><small>NFT held by the published pool contract</small></span></button><button className={custody === "wallet" ? "active" : ""} onClick={() => setCustody("wallet")}><i>◎</i><span><b>Wallet lock</b><small>NFT stays in your wallet while locked</small></span></button></div></div>
        <dl className="stake-terms"><div><dt>Reward token</dt><dd>FORGE</dd></div><div><dt>Reward rate</dt><dd>{dailyRate} / NFT / day</dd></div><div><dt>Unlock date</dt><dd>{new Date(previewTime + Number(lockDays) * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd></div><div><dt>Early exit</dt><dd>5% reward penalty</dd></div><div><dt>Contract</dt><dd>Published before approval</dd></div></dl>
        <button className="stake-submit" onClick={simulateStake} disabled={wallet ? !selectedAssets.length : false}>{wallet ? selectedAssets.length ? `Stake ${selectedAssets.length} NFT${selectedAssets.length > 1 ? "s" : ""}` : "Select NFTs to continue" : "Connect wallet to stake"}<span>→</span></button>
        <small className="stake-safety">No administrator wallet custody · Collection-isolated reward pool</small>
      </aside>
    </div>

    <section className="positions-panel">
      <div className="positions-head"><div><span>03 · MANAGE POSITIONS</span><h2>Active stakes</h2></div><div><span>TOTAL POSITION VALUE</span><b>{positions.length} NFT{positions.length === 1 ? "" : "s"}</b></div></div>
      <div className="position-table-head"><span>ASSET</span><span>STAKING ROUTE</span><span>STARTED</span><span>UNLOCKS</span><span>EARNED</span><span>ACTIONS</span></div>
      {positions.length ? <div className="position-list">{positions.map((position) => <article className="position-row" key={position.id}>
        <div className="position-asset"><div><StakeMedia asset={position.asset} /></div><span>{position.sample && <i>SAMPLE POSITION</i>}<b>{position.asset.name}</b><small>{position.asset.collection}</small></span></div>
        <div className="position-route"><i>{custody === "vault" ? "◇" : "◎"}</i><span><b>{custody === "vault" ? "Vault custody" : "Wallet lock"}</b><small>Shared MintForge pool</small></span></div>
        <div className="position-date"><b>{position.started}</b><small>Position opened</small></div>
        <div className="position-date"><b>{position.unlocks}</b><small>30-day minimum</small></div>
        <div className="position-earned"><b>{position.earned.toFixed(1)} FORGE</b><small>Accruing continuously</small></div>
        <div className="position-actions"><button onClick={() => previewAction("claim", position)}>Claim</button><button onClick={() => previewAction("unstake", position)}>Unstake</button></div>
      </article>)}</div> : <div className="no-positions"><span>◇</span><b>No active staking positions</b><p>Select eligible NFTs above to preview a position.</p></div>}
    </section>
  </div>;
}