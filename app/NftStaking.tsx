"use client";
import { useEffect, useState } from "react";
import { Contract, isAddress, parseUnits, ZeroAddress } from "ethers";
import type { Chain } from "../lib/chains";
import {
  amount,
  approveNft,
  confirmed,
  contract,
  deployment,
  errorText,
  rewardInfo,
  short,
  signer,
  tokenABI,
} from "../lib/web3";
import NftPicker, { PickedNft } from "./NftPicker";
import TransactionNotice from "./TransactionNotice";
type Pool = {
  id: number;
  creator: string;
  nft: string;
  reward: string;
  dailyRate: bigint;
  duration: bigint;
  earlyPenaltyBps: bigint;
  is1155: boolean;
  open: boolean;
  available: bigint;
  symbol: string;
  decimals: number;
  credit: bigint;
};
type Position = {
  id: number;
  poolId: number;
  tokenId: bigint;
  quantity: bigint;
  start: bigint;
  claimed: bigint;
  earned: bigint;
  reserved: bigint;
  active: boolean;
};
export default function NftStaking({
  chain,
  wallet,
  onConnectWallet,
}: {
  chain: Chain;
  wallet: string;
  onConnectWallet: () => void;
}) {
  const [pools, setPools] = useState<Pool[]>([]),
    [positions, setPositions] = useState<Position[]>([]),
    [poolId, setPoolId] = useState(""),
    [picked, setPicked] = useState<PickedNft | null>(null),
    [quantity, setQuantity] = useState("1"),
    [message, setMessage] = useState(""),
    [hash, setHash] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [ready, setReady] = useState<boolean | null>(null),
    [refresh, setRefresh] = useState(0),
    [limit, setLimit] = useState(20),
    [poolTotal, setPoolTotal] = useState(0),
    [positionLimit, setPositionLimit] = useState(20),
    [positionTotal, setPositionTotal] = useState(0);
  const [nft, setNft] = useState(""),
    [reward, setReward] = useState(""),
    [rate, setRate] = useState(""),
    [days, setDays] = useState("30"),
    [penalty, setPenalty] = useState("5"),
    [standard, setStandard] = useState("ERC-721"),
    [funding, setFunding] = useState("");
  useEffect(() => {
    setPoolId("");
    setPicked(null);
    setLimit(20);
    setPositionLimit(20);
    setPools([]);
    setPositions([]);
    setMessage("");
    setHash("");
  }, [chain.id, wallet]);
  useEffect(() => {
    setPicked(null);
    setQuantity("1");
    setFunding("");
  }, [poolId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const d = await deployment(chain.id);
      if (active) setReady(!!d);
      if (!d) return;
      const v = await contract("MintForgeStaking", d.staking, chain.id);
      const total = Number(await v.poolCount());
      const rows = await Promise.all(
        Array.from({ length: Math.min(total, limit) }, async (_, i) => {
          const p = await v.pools(i);
          const info = await rewardInfo(p.reward, chain.id);
          return {
            id: i,
            creator: p.creator,
            nft: p.nft,
            reward: p.reward,
            dailyRate: p.dailyRate,
            duration: p.duration,
            earlyPenaltyBps: p.earlyPenaltyBps,
            is1155: p.is1155,
            open: p.open,
            available: p.available,
            ...info,
            credit: wallet ? await v.credit(i, wallet) : 0n,
          };
        }),
      );
      let list: Position[] = [];
      let count = 0;
      if (wallet) {
        count = Number(await v.positionCount(wallet));
        list = await Promise.all(
          Array.from(
            { length: Math.min(count, positionLimit) },
            async (_, i) => {
              const id = Number(await v.holderPosition(wallet, count - 1 - i));
              const p = await v.positions(id);
              return {
                id,
                poolId: Number(p.poolId),
                tokenId: p.tokenId,
                quantity: p.quantity,
                start: p.start,
                claimed: p.claimed,
                reserved: p.reserved,
                active: p.active,
                earned: await v.earned(id),
              };
            },
          ),
        );
      }
      const missing = [...new Set(list.map((p) => p.poolId))].filter(
        (id) => !rows.some((p) => p.id === id),
      );
      for (const id of missing) {
        const p = await v.pools(id);
        const info = await rewardInfo(p.reward, chain.id);
        rows.push({
          id,
          creator: p.creator,
          nft: p.nft,
          reward: p.reward,
          dailyRate: p.dailyRate,
          duration: p.duration,
          earlyPenaltyBps: p.earlyPenaltyBps,
          is1155: p.is1155,
          open: p.open,
          available: p.available,
          ...info,
          credit: wallet ? await v.credit(id, wallet) : 0n,
        });
      }
      if (active) {
        setPools(rows);
        setPoolTotal(total);
        setPositions(list);
        setPositionTotal(count);
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
  }, [chain.id, wallet, refresh, limit, positionLimit]);
  const pool = pools.find((p) => String(p.id) === poolId);
  async function run(fn: (v: Contract) => Promise<void>) {
    if (!wallet) {
      onConnectWallet();
      return;
    }
    setBusy(true);
    setHash("");
    try {
      const d = await deployment(chain.id);
      if (!d) throw new Error("Staking is not configured for this network.");
      const v = await contract(
        "MintForgeStaking",
        d.staking,
        chain.id,
        true,
        wallet,
      );
      setMessage("Review the request in your wallet.");
      await fn(v);
      setMessage("Confirmed on-chain.");
      setRefresh((x) => x + 1);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const wait = (tx: Promise<unknown>) =>
    confirmed(tx, (h) => {
      setHash(h);
      setMessage("Waiting for confirmation…");
    });
  function createPool() {
    return run(async (v) => {
      if (!isAddress(nft) || (reward && !isAddress(reward)))
        throw new Error("Enter valid collection and reward addresses.");
      const info = await rewardInfo(reward || ZeroAddress, chain.id);
      const daily = parseUnits(rate, info.decimals);
      if (
        daily <= 0n ||
        !Number.isInteger(Number(days)) ||
        Number(days) < 1 ||
        Number(days) > 365 ||
        Number(penalty) < 0 ||
        Number(penalty) > 100
      )
        throw new Error(
          "Use a positive reward, 1–365 days and a 0–100% early reward penalty.",
        );
      await wait(
        v.createPool(
          nft,
          reward || ZeroAddress,
          daily,
          Number(days) * 86400,
          Math.round(Number(penalty) * 100),
          standard === "ERC-1155",
        ),
      );
    });
  }
  function fund() {
    if (!pool) return;
    return run(async (v) => {
      const value = parseUnits(funding, pool.decimals);
      if (value <= 0n) throw new Error("Enter a positive funding amount.");
      if (pool.reward !== ZeroAddress) {
        const token = new Contract(
          pool.reward,
          tokenABI,
          await signer(chain.id, wallet),
        );
        setMessage("Approve the exact reward amount.");
        await wait(token.approve(await v.getAddress(), value));
      }
      await wait(
        v.fund(pool.id, value, {
          value: pool.reward === ZeroAddress ? value : 0n,
        }),
      );
    });
  }
  function stake() {
    if (!pool || !picked) return;
    return run(async (v) => {
      const qty = pool.is1155 ? BigInt(quantity) : 1n;
      if (qty < 1n) throw new Error("Quantity must be positive.");
      if ((picked.standard === "ERC-1155") !== pool.is1155)
        throw new Error("NFT standard does not match this pool.");
      setMessage(
        pool.is1155
          ? "Approve the vault for this ERC-1155 collection, then stake."
          : "Approve this NFT, then stake.",
      );
      await approveNft(
        picked.contract,
        picked.tokenId,
        await v.getAddress(),
        pool.is1155,
        chain.id,
        wallet,
        setHash,
      );
      await wait(v.stake(pool.id, picked.tokenId, qty));
      setPicked(null);
    });
  }
  return (
    <section className="stake-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-number">NFT STAKING</span>
          <h1>
            Put your NFTs
            <br />
            <em>to work.</em>
          </h1>
          <p>
            Choose a funded pool on {chain.name}. Rewards accrue for the pool’s
            fixed term.
          </p>
        </div>
        {!wallet && (
          <button className="mf-button" onClick={onConnectWallet}>
            Connect wallet
          </button>
        )}
      </div>
      <TransactionNotice message={message} hash={hash} chainId={chain.id} />
      {ready === false && (
        <div className="interface-banner"><span>SETUP</span><div><b>{chain.name} is awaiting activation</b><p>Explore the staking tools and pool settings below. Deposits and rewards become available after activation.</p></div><a href="/setup">Launch setup ↗</a></div>
      )}
          <div className="mf-toolbar">
            <span>
              {ready ? poolTotal : "—"} pools on {chain.name}
            </span>
            <button
              disabled={busy || loading}
              onClick={() => setRefresh((x) => x + 1)}
            >
              Refresh
            </button>
          </div>
          <div className="mf-form-grid">
            <label>
              Choose a staking pool
              <select
                value={poolId}
                onChange={(e) => setPoolId(e.target.value)}
              >
                <option value="">Select a pool</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    Pool #{p.id} · {short(p.nft)} · {p.symbol}
                    {p.open ? "" : " · closed"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {limit < poolTotal && (
            <button onClick={() => setLimit((l) => l + 20)}>
              Load more pools
            </button>
          )}
          {loading && <p role="status">Reading staking contracts…</p>}
          {pool && (
            <div className="mf-two-col">
              <section className="settings-card">
                <h2>Select an NFT</h2>
                <p>
                  Collection{" "}
                  <a
                    href={chain.explorer + "/address/" + pool.nft}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(pool.nft)} ↗
                  </a>
                </p>
                {wallet ? (
                  <NftPicker
                    chainId={chain.id}
                    wallet={wallet}
                    collection={pool.nft}
                    onPick={setPicked}
                  />
                ) : (
                  <button onClick={onConnectWallet}>Connect wallet</button>
                )}
              </section>
              <section className="settings-card">
                <h2>Pool #{pool.id}</h2>
                <dl className="mf-details">
                  <div>
                    <dt>Reward per NFT / day</dt>
                    <dd>
                      {amount(pool.dailyRate, pool.decimals)} {pool.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Term</dt>
                    <dd>{Number(pool.duration) / 86400} days</dd>
                  </div>
                  <div>
                    <dt>Early exit</dt>
                    <dd>
                      {Number(pool.earlyPenaltyBps) / 100}% of accrued rewards
                    </dd>
                  </div>
                  <div>
                    <dt>Unreserved rewards</dt>
                    <dd>
                      {amount(pool.available, pool.decimals)} {pool.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Custody</dt>
                    <dd>Staking vault</dd>
                  </div>
                  <div>
                    <dt>Pool creator</dt>
                    <dd>{short(pool.creator)}</dd>
                  </div>
                </dl>
                <p>
                  Rewards are fully reserved when you stake. Claims unlock at
                  maturity; you may exit earlier with the stated reward penalty.
                  The NFT itself is returned in full.
                </p>
                {picked && (
                  <p>
                    Selected: {picked.name} · #{picked.tokenId}
                  </p>
                )}
                {pool.is1155 && (
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </label>
                )}
                <button
                  className="mf-button"
                  disabled={busy || !picked || !pool.open}
                  onClick={stake}
                >
                  Approve & stake
                </button>
                <div className="mf-inline">
                  <label>
                    Fund pool ({pool.symbol})
                    <input
                      value={funding}
                      onChange={(e) => setFunding(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <button disabled={busy || !funding} onClick={fund}>
                    Fund rewards
                  </button>
                </div>
                <p className="field-hint">
                  The pool creator can withdraw only unreserved funds after
                  closing deposits. Use standard, non-rebasing ERC-20 reward
                  tokens.
                </p>
                {pool.creator.toLowerCase() === wallet.toLowerCase() && (
                  <div className="dashboard-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async (v) => {
                          await wait(v.setOpen(pool.id, !pool.open));
                        })
                      }
                    >
                      {pool.open ? "Close deposits" : "Reopen deposits"}
                    </button>
                    {!pool.open && (
                      <button
                        disabled={busy || pool.available === 0n}
                        onClick={() =>
                          run(async (v) => {
                            await wait(
                              v.withdrawUnused(pool.id, pool.available, wallet),
                            );
                          })
                        }
                      >
                        Withdraw unreserved funds
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
          <section className="settings-card">
            <h2>Your staking positions</h2>
            {!wallet ? (
              <p>Connect your wallet to load positions.</p>
            ) : !positions.length ? (
              <p>No staking positions found.</p>
            ) : (
              positions.map((p) => {
                const pp = pools.find((x) => x.id === p.poolId);
                return (
                  <article className="mf-position" key={p.id}>
                    <div>
                      <b>
                        Position #{p.id} · Token #{String(p.tokenId)}
                      </b>
                      <p>
                        Pool #{p.poolId} · {String(p.quantity)} NFT(s) ·{" "}
                        {p.active ? "Active" : "Withdrawn"}
                      </p>
                      {pp && (
                        <p>
                          Earned: {amount(p.earned, pp.decimals)} {pp.symbol} ·
                          Matures{" "}
                          {new Date(
                            (Number(p.start) + Number(pp.duration)) * 1000,
                          ).toLocaleString()}
                        </p>
                      )}
                    </div>
                    {p.active && (
                      <div className="dashboard-actions">
                        <button
                          disabled={
                            busy ||
                            !pp ||
                            Date.now() / 1000 <
                              Number(p.start) + Number(pp.duration) ||
                            p.claimed === p.reserved
                          }
                          onClick={() =>
                            run(async (v) => {
                              await wait(v.claim(p.id));
                            })
                          }
                        >
                          Claim matured reward
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async (v) => {
                              const gas = await v.unstake.estimateGas(p.id, wallet);
                              await wait(v.unstake(p.id, wallet, {gasLimit: gas + 100000n}));
                            })
                          }
                        >
                          Return NFT
                        </button>
                      </div>
                    )}
                  </article>
                );
              })
            )}
            {positionLimit < positionTotal && (
              <button onClick={() => setPositionLimit((l) => l + 20)}>
                Load older positions
              </button>
            )}
            {pools
              .filter((p) => p.credit > 0n)
              .map((p) => (
                <div className="mf-position" key={p.id}>
                  <b>
                    Pool #{p.id}: {amount(p.credit, p.decimals)} {p.symbol}{" "}
                    ready to withdraw
                  </b>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async (v) => {
                        await wait(v.withdrawReward(p.id, wallet));
                      })
                    }
                  >
                    Withdraw reward
                  </button>
                </div>
              ))}
          </section>
          <details className="settings-card">
            <summary>Create a reward pool</summary>
            <p>
              Pool terms are fixed when created. Fund it before holders stake.
            </p>
            <div className="mf-form-grid">
              <label>
                NFT collection
                <input
                  value={nft}
                  onChange={(e) => setNft(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <label>
                Standard
                <select
                  value={standard}
                  onChange={(e) => setStandard(e.target.value)}
                >
                  <option>ERC-721</option>
                  <option>ERC-1155</option>
                </select>
              </label>
              <label>
                Reward token
                <input
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                  placeholder={"Blank for " + chain.native}
                />
              </label>
              <label>
                Reward per NFT per day
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                Term in days
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>
              <label>
                Early exit reward penalty (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={penalty}
                  onChange={(e) => setPenalty(e.target.value)}
                />
              </label>
            </div>
            <button className="mf-button" disabled={busy || !ready} onClick={createPool}>
              Create pool
            </button>
          </details>
    </section>
  );
}
