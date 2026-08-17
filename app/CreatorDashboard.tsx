"use client";

import { useEffect, useState } from "react";

type Chain = { id: string; name: string; native: string; mark: string; colour: string };

type DraftSummary = {
  name?: string;
  collectionName?: string;
  standard?: string;
  itemMode?: "single" | "collection";
  stakingEnabled?: boolean;
  delayedReveal?: boolean;
};

type SampleCollection = {
  id: string;
  name: string;
  chain: string;
  standard: string;
  minted: number;
  supply: number;
  revenue: string;
  currency: string;
  holders: number;
  stakingEnabled: boolean;
  revealPending: boolean;
};

const sampleCollections: SampleCollection[] = [
  { id: "s1", name: "Genesis Collectibles", chain: "PulseChain", standard: "ERC-721", minted: 340, supply: 500, revenue: "34.0", currency: "PLS", holders: 212, stakingEnabled: true, revealPending: false },
  { id: "s2", name: "Sunset Editions", chain: "Ethereum", standard: "ERC-1155", minted: 1000, supply: 1000, revenue: "12.4", currency: "ETH", holders: 640, stakingEnabled: false, revealPending: true },
  { id: "s3", name: "Untitled Drop", chain: "Base", standard: "ERC-721", minted: 45, supply: 200, revenue: "0.9", currency: "ETH", holders: 38, stakingEnabled: true, revealPending: false },
];

export default function CreatorDashboard({ chain, wallet, onConnectWallet, onEditDraft }: { chain: Chain; wallet: string; onConnectWallet: () => void; onEditDraft: () => void }) {
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("mintforge-draft");
      if (saved) setDraft(JSON.parse(saved) as DraftSummary);
    } catch {
      setDraft(null);
    }
  }, []);

  function previewAction(action: string, collectionName: string) {
    setNotice(`${action} is ready for contract integration. ${collectionName} remains unchanged in this interface release.`);
  }

  const totalMinted = sampleCollections.reduce((sum, c) => sum + c.minted, 0);
  const totalHolders = sampleCollections.reduce((sum, c) => sum + c.holders, 0);

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div><span className="section-number">CREATOR DASHBOARD</span><h1>Manage what you've<br /><em>already launched.</em></h1><p>Track mint progress, withdraw proceeds, and manage live staking pools across every collection you've deployed.</p></div>
        <div className="stake-hero-status"><i style={{ background: chain.colour }}>{chain.mark}</i><div><span>ACTIVE NETWORK</span><b>{chain.name}</b><small>{wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "Wallet not connected"}</small></div></div>
      </div>

      <div className="interface-banner"><span>UI</span><div><b>Interface release</b><p>The collections below are sample data illustrating the dashboard layout. Live mint stats, withdrawals and pool controls activate once your audited contracts are deployed.</p></div><i>CONTRACTS NEXT</i></div>

      {!wallet && <div className="dashboard-connect-prompt"><p>Connect a wallet to see which of your deployed collections this dashboard will manage.</p><button type="button" onClick={onConnectWallet}>Connect wallet <span>→</span></button></div>}

      {draft && (draft.name || draft.collectionName) && (
        <div className="dashboard-draft-card">
          <span>YOUR CURRENT DRAFT · SAVED LOCALLY</span>
          <h2>{draft.itemMode === "collection" ? (draft.collectionName || "Untitled collection") : (draft.name || draft.collectionName || "Untitled NFT")}</h2>
          <p>{draft.standard || "ERC-721"} · {draft.stakingEnabled ? "Staking enabled" : "No staking"} · {draft.delayedReveal ? "Delayed reveal configured" : "No reveal delay"}</p>
          <button type="button" onClick={onEditDraft}>Continue editing draft <span>→</span></button>
        </div>
      )}

      <div className="dashboard-stats-row">
        <div className="metric-card"><span>COLLECTIONS</span><strong>{sampleCollections.length}</strong><p>Sample data</p></div>
        <div className="metric-card"><span>TOTAL MINTED</span><strong>{totalMinted}</strong><p>Across all collections</p></div>
        <div className="metric-card"><span>TOTAL HOLDERS</span><strong>{totalHolders}</strong><p>Unique wallets</p></div>
      </div>

      <div className="dashboard-collections">
        {sampleCollections.map((c) => (
          <div className="dashboard-collection-card" key={c.id}>
            <div className="dashboard-collection-head">
              <div><b>{c.name}</b><small>{c.chain} · {c.standard}</small></div>
              <span className="choice-tag">SAMPLE</span>
            </div>
            <div className="dashboard-progress">
              <div className="dashboard-progress-track"><div style={{ width: Math.min(100, (c.minted / c.supply) * 100) + "%" }} /></div>
              <span>{c.minted} / {c.supply} minted</span>
            </div>
            <div className="dashboard-collection-stats">
              <div><span>Revenue collected</span><b>{c.revenue} {c.currency}</b></div>
              <div><span>Holders</span><b>{c.holders}</b></div>
            </div>
            <div className="dashboard-actions">
              <button type="button" className="secondary-action" onClick={() => previewAction("Withdraw funds", c.name)}>Withdraw funds</button>
              {c.stakingEnabled && <button type="button" className="secondary-action" onClick={() => previewAction("Staking pool management", c.name)}>Manage staking pool</button>}
              {c.revealPending && <button type="button" className="secondary-action" onClick={() => previewAction("Reveal trigger", c.name)}>Trigger reveal</button>}
              <button type="button" className="secondary-action" onClick={() => previewAction("Metadata editing", c.name)}>Edit metadata</button>
            </div>
          </div>
        ))}
      </div>

      {notice && <div className="dashboard-notice"><p>{notice}</p><button type="button" onClick={() => setNotice("")}>×</button></div>}
    </section>
  );
}