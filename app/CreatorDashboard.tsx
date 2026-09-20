"use client";
import { useCallback, useEffect, useState } from "react";
import { isAddress, parseEther } from "ethers";
import type { Chain } from "../lib/chains";
import {
  contract,
  deployment,
  errorText,
  confirmed,
  short,
  amount,
} from "../lib/web3";
import TransactionNotice from "./TransactionNotice";
import type { Draft } from "./Studio";
type CollectionSummary = { minted: bigint; holders: number | null };

function CollectionCard({
  address,
  chain,
  wallet,
  standard,
  onSummary,
  onManageStaking,
}: {
  address: string;
  chain: Chain;
  wallet: string;
  standard: number;
  onSummary: (address: string, summary: CollectionSummary) => void;
  onManageStaking: () => void;
}) {
  const [data, setData] = useState<{
    name: string;
    price: bigint;
    supply: bigint;
    minted: bigint;
    revenue: bigint;
    withdrawable: bigint;
    owner: string;
    paused: boolean;
    frozen: boolean;
    revealed: boolean;
    pausable: boolean;
    count: number;
    holders: number | null;
  } | null>(null);
  const [message, setMessage] = useState(""),
    [hash, setHash] = useState(""),
    [busy, setBusy] = useState(false),
    [price, setPrice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [uri, setUri] = useState(""),
    [index, setIndex] = useState("1"),
    [manageOpen, setManageOpen] = useState(false),
    [freezeConfirmed, setFreezeConfirmed] = useState(false);
  const kind = standard === 404 ? "MintForge404" : standard === 1155 ? "MintForge1155" : "MintForge721";
  useEffect(() => {
    let active = true;
    setData(null);
    (async () => {
      const c = await contract(kind, address, chain.id);
      const [
        cfg,
        minted,
        revenue,
        withdrawable,
        owner,
        paused,
        revealed,
        count,
      ] = await Promise.all([
        c.config(),
        c.totalMinted(),
        c.totalRevenue(),
        c.proceeds(wallet),
        c.owner(),
        c.paused(),
        c.revealed(),
        c.metadataCount(),
      ]);
      if (active) {
        setData({
          name: cfg.name,
          price: cfg.price,
          supply: cfg.supply,
          minted,
          revenue,
          withdrawable,
          owner,
          paused,
          frozen: cfg.frozen,
          revealed,
          pausable: cfg.pausable,
          count: Number(count),
          holders: null,
        });
        onSummary(address, { minted, holders: null });
      }
      const response = await fetch(`/api/collection-stats?chainId=${chain.id}&address=${address}`);
      const stats = await response.json() as { holders?: number | null };
      if (active) {
        setData((current) => current ? { ...current, holders: stats.holders ?? null } : current);
        onSummary(address, { minted, holders: stats.holders ?? null });
      }
    })().catch((e) => {
      if (active) setMessage(errorText(e));
    });
    return () => {
      active = false;
    };
  }, [address, chain.id, wallet, kind, refresh, onSummary]);
  async function act(method: string, args: unknown[]) {
    setBusy(true);
    setHash("");
    try {
      const c = await contract(kind, address, chain.id, true, wallet);
      setMessage("Review the transaction in your wallet.");
      await confirmed(c[method](...args), (h) => {
        setHash(h);
        setMessage("Waiting for confirmation…");
      });
      setMessage("Confirmed on-chain.");
      setRefresh((x) => x + 1);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const owned = data?.owner.toLowerCase() === wallet.toLowerCase();
  return (
    <article className="dashboard-collection-card">
      <div className="dashboard-collection-head">
        <div>
          <b>{data?.name || "Loading collection…"}</b>
          <a
            href={chain.explorer + "/address/" + address}
            target="_blank"
            rel="noreferrer"
          >
            {short(address)} ↗
          </a>
        </div>
        <span className="choice-tag">ERC-{standard}</span>
      </div>
      {data && (
        <>
          <div className="dashboard-progress">
            <div className="dashboard-progress-track"><div style={{ width: (data.supply > 10n ** 30n ? 0 : Math.min(100, Number(data.minted * 10000n / (data.supply * BigInt(standard === 1155 ? data.count : 1) || 1n)) / 100)) + "%" }} /></div>
            <span>{String(data.minted)} minted · {data.supply > 10n ** 30n ? "Open edition" : `${String(data.supply * BigInt(standard === 1155 ? data.count : 1))} total supply`}</span>
          </div>
          <div className="dashboard-collection-stats">
            <div>
              <span>Holders · explorer</span>
              <b>{data.holders === null ? "—" : data.holders.toLocaleString()}</b>
            </div>
            <div>
              <span>Primary sales</span>
              <b>
                {amount(data.revenue)} {chain.native}
              </b>
            </div>
            <div>
              <span>Your proceeds</span>
              <b>
                {amount(data.withdrawable)} {chain.native}
              </b>
            </div>
          </div>
          <div className="dashboard-actions">
            {owned && <button type="button" onClick={onManageStaking}>Manage staking pool</button>}
            {owned && <button type="button" onClick={() => setManageOpen((open) => !open)}>Edit metadata &amp; settings</button>}
            <a
              className="mf-button"
              href={`/mint?chain=${Number(chain.id)}&collection=${address}`}
            >
              Collector mint page ↗
            </a>
            <button
              disabled={busy || data.withdrawable === 0n}
              onClick={() => act("withdraw", [wallet])}
            >
              Withdraw proceeds
            </button>
            {owned && data.pausable && (
              <button
                disabled={busy}
                onClick={() => act("setPaused", [!data.paused])}
              >
                {data.paused ? "Resume minting" : "Pause minting"}
              </button>
            )}
            {owned && !data.revealed && (
              <button disabled={busy} onClick={() => act("reveal", [])}>
                Reveal artwork
              </button>
            )}
          </div>
          {owned && (
            <details className="mf-manage" open={manageOpen} onToggle={(event) => setManageOpen(event.currentTarget.open)}>
              <summary>Manage collection</summary>
              <p>
                Current mint price: {amount(data.price)} {chain.native}. Changes
                affect future mints.
              </p>
              <div className="mf-inline">
                <label>
                  New mint price
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder={"Amount in " + chain.native}
                  />
                </label>
                <button
                  disabled={busy || !price}
                  onClick={() => {
                    try {
                      const value = parseEther(price);
                      if (value < 0n)
                        throw new Error("Price cannot be negative.");
                      void act("setPrice", [value]);
                    } catch (e) {
                      setMessage(errorText(e));
                    }
                  }}
                >
                  Update price
                </button>
              </div>
              <button
                disabled={busy}
                onClick={() => act("setAllowlistRoot", ["0x" + "0".repeat(64)])}
              >
                Open mint to everyone
              </button>
              {data.frozen ? (
                <p>Metadata is permanently frozen.</p>
              ) : (
                <>
                  <div className="mf-inline">
                    <label>
                      Artwork number
                      <input
                        type="number"
                        min="1"
                        max={data.count}
                        value={index}
                        onChange={(e) => setIndex(e.target.value)}
                      />
                    </label>
                    <label>
                      Metadata URI
                      <input
                        value={uri}
                        onChange={(e) => setUri(e.target.value)}
                        placeholder="ipfs://…"
                      />
                    </label>
                    <button
                      disabled={
                        busy ||
                        !/^ipfs:\/\//.test(uri) ||
                        Number(index) < 1 ||
                        Number(index) > data.count
                      }
                      onClick={() =>
                        act("setMetadata", [Number(index) - 1, uri])
                      }
                    >
                      Update metadata
                    </button>
                  </div>
                  <label className="mf-check">
                    <input type="checkbox" checked={freezeConfirmed} onChange={(event) => setFreezeConfirmed(event.target.checked)} /> I
                    understand freezing metadata cannot be undone.
                  </label>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (freezeConfirmed)
                        void act("freezeMetadata", []);
                      else
                        setMessage(
                          "Confirm the permanent metadata freeze first.",
                        );
                    }}
                  >
                    Freeze metadata permanently
                  </button>
                </>
              )}
            </details>
          )}
        </>
      )}
      <TransactionNotice message={message} hash={hash} chainId={chain.id} />
    </article>
  );
}
export default function CreatorDashboard({
  chain,
  wallet,
  onConnectWallet,
  onEditDraft,
  onCreateCollection,
  onManageStaking,
}: {
  chain: Chain;
  wallet: string;
  onConnectWallet: () => void;
  onEditDraft: () => void;
  onCreateCollection: () => void;
  onManageStaking: () => void;
}) {
  const [draft, setDraft] = useState<Partial<Draft> | null>(null);
  const [summaries, setSummaries] = useState<Record<string, CollectionSummary>>({});
  const onSummary = useCallback((address: string, summary: CollectionSummary) => {
    setSummaries((current) => ({ ...current, [address.toLowerCase()]: summary }));
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mintforge-draft");
      if (saved) setDraft(JSON.parse(saved));
    } catch { setDraft(null); }
  }, []);
  const [addresses, setAddresses] = useState<
      { address: string; standard: number }[]
    >([]),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(false),
    [ready, setReady] = useState<boolean | null>(null),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [refresh, setRefresh] = useState(0),
    [importAddress, setImportAddress] = useState("");
  useEffect(() => {
    let active = true;
    setAddresses([]);
    setSummaries({});
    setTotal(0);
    setReady(null);
    setMessage("");
    setLoading(true);
    (async () => {
      const d = await deployment(chain.id);
      if (active) setReady(!!d);
      if (!d || !wallet) return;
      const f = await contract("MintForgeFactory", d.factory, chain.id);
      const count = Number(await f.creatorCount(wallet));
      const list = await Promise.all(
        Array.from(
          { length: Math.max(0, Math.min(12, count - page * 12)) },
          async (_, i) => {
            const address = await f.creatorCollection(wallet, page * 12 + i);
            return { address, standard: Number(await f.standard(address)) };
          },
        ),
      );
      if (active) {
        setAddresses(list);
        setTotal(count);
      }
    })()
      .catch((e) => {
        if (active) setMessage(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chain.id, wallet, page, refresh]);
  useEffect(() => setPage(0), [chain.id, wallet]);
  async function importCollection() {
    try {
      if (!isAddress(importAddress))
        throw new Error("Enter a valid collection address.");
      const d = await deployment(chain.id);
      if (!d) throw new Error("Network not configured.");
      const f = await contract("MintForgeFactory", d.factory, chain.id);
      const standard = Number(await f.standard(importAddress));
      if (!standard)
        throw new Error(
          "This dashboard manages collections created by the configured MintForge factory.",
        );
      setAddresses((a) =>
        a.some((c) => c.address.toLowerCase() === importAddress.toLowerCase())
          ? a
          : [...a, { address: importAddress, standard }],
      );
      setMessage(
        "Collection loaded. Owner actions are available only to its current owner.",
      );
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-number">CREATOR DASHBOARD</span>
          <h1>
            Manage what you&apos;ve
            <br />
            <em>already launched.</em>
          </h1>
          <p>Track mint progress, withdraw proceeds, edit metadata and manage staking pools for your collections on {chain.name}.</p>
        </div>
        <div className="stake-hero-status"><i style={{ background: chain.colour }}>{chain.mark}</i><div><span>ACTIVE NETWORK</span><b>{chain.name}</b><small>{wallet ? short(wallet) : "Wallet not connected"}</small></div></div>
      </div>
      {ready === false && (
        <div className="interface-banner"><span>SETUP</span><div><b>{chain.name} is awaiting activation</b><p>Your saved draft is available below. Published collections and on-chain statistics appear after this network is configured.</p></div><a href="/setup">Launch setup ↗</a></div>
      )}
      {draft && (draft.name || draft.collectionName) && (
        <div className="dashboard-draft-card">
          <span>YOUR CURRENT DRAFT · SAVED LOCALLY</span>
          <h2>{draft.itemMode === "collection" ? draft.collectionName || "Untitled collection" : draft.name || draft.collectionName}</h2>
          <p>{draft.standard || "ERC-721"} · {draft.stakingEnabled ? "Staking enabled" : "No staking"} · {draft.delayedReveal ? "Delayed reveal configured" : "No reveal delay"}</p>
          <button type="button" onClick={onEditDraft}>Continue editing draft →</button>
        </div>
      )}
      <div className="dashboard-stats-row">
        <div className="metric-card"><span>COLLECTIONS</span><strong>{wallet && ready && !loading ? total : "—"}</strong><p>Created on {chain.name}</p></div>
        <div className="metric-card"><span>MINTED · THIS PAGE</span><strong>{addresses.length && addresses.every((item) => summaries[item.address.toLowerCase()]) ? String(addresses.reduce((sum, item) => sum + summaries[item.address.toLowerCase()].minted, 0n)) : wallet && ready && !loading && !total ? "0" : "—"}</strong><p>Confirmed collection mints</p></div>
        <div className="metric-card"><span>HOLDERS · THIS PAGE</span><strong>{addresses.length && addresses.every((item) => summaries[item.address.toLowerCase()]?.holders != null) ? addresses.reduce((sum, item) => sum + (summaries[item.address.toLowerCase()].holders || 0), 0).toLocaleString() : "—"}</strong><p>Sum per collection · explorer indexed</p></div>
      </div>
      <div className="mf-toolbar"><span>Your collections</span><button type="button" className="mf-button" onClick={onCreateCollection}>Upload a collection →</button></div>
      {!wallet ? (
        <div className="mf-empty">
          <h2>Connect your creator wallet</h2>
          <p>
            Your deployed collections and available proceeds will appear here.
          </p>
          <button className="mf-button" onClick={onConnectWallet}>
            Connect wallet
          </button>
        </div>
      ) : (
        ready && (
          <>
            <div className="mf-toolbar">
              <span>
                {total} collection{total === 1 ? "" : "s"} created by this
                wallet
              </span>
              <button
                onClick={() => setRefresh((x) => x + 1)}
                disabled={loading}
              >
                Refresh
              </button>
            </div>
            <div className="mf-inline">
              <label>
                Load a transferred collection
                <input
                  placeholder="0x collection address"
                  value={importAddress}
                  onChange={(e) => setImportAddress(e.target.value)}
                />
              </label>
              <button
                disabled={!isAddress(importAddress)}
                onClick={importCollection}
              >
                Load collection
              </button>
            </div>
            {loading ? (
              <p role="status">Loading on-chain collections…</p>
            ) : !addresses.length ? (
              <div className="mf-empty">
                <h2>No collections yet</h2>
                <p>Launch your first collection in the creator studio.</p>
                <button onClick={onEditDraft}>Open creator studio</button>
              </div>
            ) : (
              <div className="dashboard-collections">
                {addresses.map((c) => (
                  <CollectionCard
                    key={chain.id + c.address}
                    {...c}
                    chain={chain}
                    wallet={wallet}
                    onSummary={onSummary}
                    onManageStaking={onManageStaking}
                  />
                ))}
              </div>
            )}
            <div className="mf-toolbar">
              <button
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button
                disabled={(page + 1) * 12 >= total || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        )
      )}
      <TransactionNotice message={message} chainId={chain.id} />
    </section>
  );
}
