"use client";
import { useEffect, useState } from "react";
import { Contract, parseEther } from "ethers";
import type { Chain } from "../lib/chains";
import {
  amount,
  approveNft,
  confirmed,
  contract,
  deployment,
  errorText,
  short,
} from "../lib/web3";
import NftPicker, { PickedNft } from "./NftPicker";
import TransactionNotice from "./TransactionNotice";
type Listing = {
  id: number;
  seller: string;
  nft: string;
  tokenId: bigint;
  quantity: bigint;
  price: bigint;
  expiry: bigint;
  is1155: boolean;
  active: boolean;
  available: boolean;
};
type Offer = {
  id: number;
  bidder: string;
  listingId: bigint;
  amount: bigint;
  expiry: bigint;
  active: boolean;
};
type Metadata = {
  name?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  animation_kind?: string;
  image_kind?: string;
  attributes?: { trait_type: string; value: string }[];
};
function Media({ listing, chainId }: { listing: Listing; chainId: string }) {
  const [data, setData] = useState<Metadata | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    fetch("/api/nft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId,
        contract: listing.nft,
        tokenId: String(listing.tokenId),
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json() as Promise<{ metadata?: Metadata }>)
      .then((d) => {
        if (!ctrl.signal.aborted) setData(d.metadata || null);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [listing.nft, listing.tokenId, chainId]);
  return (
    <>
      <div className="mf-market-media">
        {data?.animation_kind === "video" && data.animation_url ? (
          <video
            src={data.animation_url}
            autoPlay
            muted
            loop
            controls
            playsInline
          />
        ) : data?.animation_kind === "audio" && data.animation_url ? (
          <audio src={data.animation_url} controls loop />
        ) : data?.image && data.image_kind === "image" ? (
          <img src={data.image} alt={data.name || "NFT"} loading="lazy" />
        ) : (
          <div className="mf-media-fallback">
            NFT #{String(listing.tokenId)}
          </div>
        )}
      </div>
      <h3>{data?.name || "Token #" + listing.tokenId}</h3>
      {data?.description && <p>{data.description.slice(0, 300)}</p>}
      {!!data?.attributes?.length && (
        <div className="mf-traits">
          {data.attributes.slice(0, 8).map((a, i) => (
            <span key={i}>
              {a.trait_type}: <b>{String(a.value)}</b>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
export default function Marketplace({
  chain,
  wallet,
  onConnectWallet,
}: {
  chain: Chain;
  wallet: string;
  onConnectWallet: () => void;
}) {
  const [view, setView] = useState<"browse" | "mine" | "offers" | "sell">(
      "browse",
    ),
    [rows, setRows] = useState<Listing[]>([]),
    [offers, setOffers] = useState<Offer[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [listingOffers, setListingOffers] = useState<Offer[]>([]),
    [offerPage, setOfferPage] = useState(0),
    [offerCount, setOfferCount] = useState(0),
    [offerValue, setOfferValue] = useState("");
  const [listType, setListType] = useState<"fixed" | "offers">("fixed"),
    [editPrice, setEditPrice] = useState("");
  const [picked, setPicked] = useState<PickedNft | null>(null),
    [price, setPrice] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [days, setDays] = useState("7"),
    [message, setMessage] = useState(""),
    [hash, setHash] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [ready, setReady] = useState<boolean | null>(null),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [balance, setBalance] = useState(0n);
  useEffect(() => {
    setPage(0);
    setSelected(null);
    setPicked(null);
    setRows([]);
    setOffers([]);
    setBalance(0n);
    setMessage("");
    setHash("");
  }, [chain.id, wallet, view]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReady(null);
    setTotal(0);
    setRows([]);
    setOffers([]);
    (async () => {
      const d = await deployment(chain.id);
      if (active) setReady(!!d);
      if (!d) return;
      const m = await contract("MintForgeMarket", d.market, chain.id);
      const money = wallet ? await m.proceeds(wallet) : 0n;
      if (view === "sell") {
        if (active) setBalance(money);
        return;
      }
      const count = Number(
        view === "offers"
          ? wallet
            ? await m.userOfferCount(wallet)
            : 0
          : view === "mine"
            ? wallet
              ? await m.userListingCount(wallet)
              : 0
            : await m.listingCount(),
      );
      const indexes = Array.from(
        { length: Math.max(0, Math.min(12, count - page * 12)) },
        (_, i) => count - 1 - page * 12 - i,
      );
      if (view === "offers") {
        const data = await Promise.all(
          indexes.map(async (i) => {
            const id = Number(await m.userOffer(wallet, i));
            const o = await m.offers(id);
            return {
              id,
              bidder: o.bidder,
              listingId: o.listingId,
              amount: o.amount,
              expiry: o.expiry,
              active: o.active,
            };
          }),
        );
        if (active) setOffers(data);
      } else {
        const data = await Promise.all(
          indexes.map(async (i) => {
            const id =
              view === "mine" ? Number(await m.userListing(wallet, i)) : i;
            const l = await m.listings(id);
            return {
              id,
              seller: l.seller,
              nft: l.nft,
              tokenId: l.tokenId,
              quantity: l.quantity,
              price: l.price,
              expiry: l.expiry,
              is1155: l.is1155,
              active: l.active,
              available: await m.isAvailable(id),
            };
          }),
        );
        if (active) setRows(data);
      }
      if (active) {
        setBalance(money);
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
  }, [chain.id, wallet, view, refresh, page]);
  useEffect(() => {
    setOfferPage(0);
    setOfferValue("");
    setEditPrice("");
  }, [selected]);
  useEffect(() => {
    let active = true;
    setListingOffers([]);
    setOfferCount(0);
    if (selected === null) return;
    (async () => {
      const d = await deployment(chain.id);
      if (!d) return;
      const m = await contract("MintForgeMarket", d.market, chain.id);
      const count = Number(await m.offerCount(selected));
      const data = await Promise.all(
        Array.from(
          { length: Math.max(0, Math.min(10, count - offerPage * 10)) },
          async (_, i) => {
            const id = Number(
              await m.listingOffer(selected, count - 1 - offerPage * 10 - i),
            );
            const o = await m.offers(id);
            return {
              id,
              bidder: o.bidder,
              listingId: o.listingId,
              amount: o.amount,
              expiry: o.expiry,
              active: o.active,
            };
          },
        ),
      );
      if (active) {
        setOfferCount(count);
        setListingOffers(data);
      }
    })().catch((e) => {
      if (active) setMessage(errorText(e));
    });
    return () => {
      active = false;
    };
  }, [selected, chain.id, refresh, offerPage]);
  async function run(fn: (m: Contract) => Promise<void>) {
    if (!wallet) {
      onConnectWallet();
      return;
    }
    setBusy(true);
    setHash("");
    try {
      const d = await deployment(chain.id);
      if (!d) throw new Error("Marketplace not configured.");
      const m = await contract(
        "MintForgeMarket",
        d.market,
        chain.id,
        true,
        wallet,
      );
      setMessage("Review the request in your wallet.");
      await fn(m);
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
  function list() {
    if (!picked) return;
    return run(async (m) => {
      const value = listType === "offers" ? 0n : parseEther(price),
        qty = picked.standard === "ERC-1155" ? BigInt(quantity) : 1n;
      const daysNum = Number(days);
      if (
        (listType === "fixed" && value <= 0n) ||
        qty < 1n ||
        !Number.isInteger(daysNum) ||
        daysNum < 1 ||
        daysNum > 365
      )
        throw new Error(
          "Use a positive total price and quantity, and 1–365 days.",
        );
      setMessage(
        picked.standard === "ERC-1155"
          ? "Approve this ERC-1155 collection for the marketplace, then confirm the listing."
          : "Approve this NFT for the marketplace, then confirm the listing.",
      );
      await approveNft(
        picked.contract,
        picked.tokenId,
        await m.getAddress(),
        picked.standard === "ERC-1155",
        chain.id,
        wallet,
        setHash,
      );
      await wait(
        m.list(
          picked.contract,
          picked.tokenId,
          qty,
          value,
          Math.floor(Date.now() / 1000) + daysNum * 86400,
          picked.standard === "ERC-1155",
        ),
      );
      setView("mine");
      setPicked(null);
    });
  }
  const detail = rows.find((l) => l.id === selected);
  return (
    <section className="market-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-number">MARKETPLACE</span>
          <h1>
            Buy, sell and
            <br />
            <em>trade freely.</em>
          </h1>
          <p>
            Browse listings, place offers or list your own NFTs for sale on {chain.name}. Your NFT stays in your wallet until it sells.
          </p>
        </div>
        {wallet ? (
          <div className="mf-proceeds">
            <small>Your marketplace proceeds</small>
            <b>
              {amount(balance)} {chain.native}
            </b>
            <button
              disabled={busy || balance === 0n}
              onClick={() =>
                run(async (m) => {
                  await wait(m.withdraw(wallet));
                })
              }
            >
              Withdraw
            </button>
          </div>
        ) : (
          <button className="mf-button" onClick={onConnectWallet}>
            Connect wallet
          </button>
        )}
      </div>
      <TransactionNotice message={message} hash={hash} chainId={chain.id} />
      {ready === false && (
        <div className="interface-banner"><span>SETUP</span><div><b>{chain.name} is awaiting activation</b><p>Browse the marketplace tools and prepare a listing. Trading opens when this network is configured.</p></div><a href="/setup">Launch setup ↗</a></div>
      )}
      <div className="market-tabs" role="tablist" aria-label="Marketplace sections">
        <button type="button" role="tab" aria-selected={view === "browse"} className={view === "browse" ? "active" : ""} onClick={() => setView("browse")}>Browse</button>
        <button type="button" role="tab" aria-selected={view === "mine" || view === "offers"} className={view === "mine" || view === "offers" ? "active" : ""} onClick={() => setView("mine")}>My listings &amp; offers</button>
        <button type="button" role="tab" aria-selected={view === "sell"} className={view === "sell" ? "active" : ""} onClick={() => setView("sell")}>List an NFT</button>
      </div>
      {(view === "mine" || view === "offers") && <div className="segmented market-account-tabs"><button type="button" className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>My listings</button><button type="button" className={view === "offers" ? "active" : ""} onClick={() => setView("offers")}>Offers I made</button></div>}
      {(view === "mine" || view === "offers") && !wallet && <div className="dashboard-connect-prompt"><p>Connect your wallet to manage your listings, offers and refunds.</p><button type="button" onClick={onConnectWallet}>Connect wallet →</button></div>}
          {view === "sell" ? (
            <div className="mf-two-col">
              <section className="settings-card">
                <h2>Select from your wallet</h2>
                {wallet ? (
                  <NftPicker
                    chainId={chain.id}
                    wallet={wallet}
                    onPick={setPicked}
                  />
                ) : (
                  <button onClick={onConnectWallet}>Connect wallet</button>
                )}
              </section>
              <section className="settings-card">
                <h2>Set your listing</h2>
                <p>
                  {picked
                    ? picked.name + " · #" + picked.tokenId
                    : "Choose an NFT first."}
                </p>
                <div className="segmented"><button type="button" className={listType === "fixed" ? "active" : ""} onClick={() => setListType("fixed")}>Fixed price</button><button type="button" className={listType === "offers" ? "active" : ""} onClick={() => setListType("offers")}>Accept offers only</button></div>
                <div className="mf-form-grid">
                  {listType === "fixed" && <label>
                    Total price ({chain.native})
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>}
                  <label>
                    Expires in days
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  </label>
                  {picked?.standard === "ERC-1155" && (
                    <label>
                      Quantity
                      <input
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <p>
                  Offers are funded in {chain.native}. Creator royalties and the
                  marketplace fee are deducted from your sale proceeds.
                </p>
                <button
                  className="mf-button"
                  disabled={busy || !ready || !picked || (listType === "fixed" && !price)}
                  onClick={list}
                >
                  {listType === "offers" ? "Approve & accept offers" : "Approve & list NFT"}
                </button>
              </section>
            </div>
          ) : loading ? (
            <p role="status">Reading marketplace activity…</p>
          ) : view === "offers" ? (
            offers.length ? (
              <div className="settings-card">
                {offers.map((o) => (
                  <article className="mf-position" key={o.id}>
                    <div>
                      <b>
                        Offer #{o.id} · Listing #{String(o.listingId)}
                      </b>
                      <p>
                        {amount(o.amount)} {chain.native} ·{" "}
                        {o.active ? "Escrowed" : "Closed"} · Expires{" "}
                        {new Date(Number(o.expiry) * 1000).toLocaleString()}
                      </p>
                    </div>
                    {o.active && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async (m) => {
                            await wait(m.cancelOffer(o.id));
                          })
                        }
                      >
                        Cancel & credit refund
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="mf-empty">
                <h2>No offers yet</h2>
                <p>Your offers and refundable balances will appear here.</p>
              </div>
            )
          ) : detail ? (
            <section className="settings-card">
              <button onClick={() => setSelected(null)}>
                ← Back to listings
              </button>
              <div className="mf-two-col">
                <div>
                  <Media listing={detail} chainId={chain.id} />
                </div>
                <div>
                  <h2>{detail.price === 0n ? "Accepting offers" : `${amount(detail.price)} ${chain.native}`}</h2>
                  <p>
                    {String(detail.quantity)} NFT(s) · Seller{" "}
                    {short(detail.seller)}
                  </p>
                  <p>
                    Collection{" "}
                    <a
                      href={chain.explorer + "/address/" + detail.nft}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(detail.nft)} ↗
                    </a>
                  </p>
                  <p>
                    {detail.available
                      ? "Available"
                      : "Unavailable, expired or sold"}{" "}
                    · Expires{" "}
                    {new Date(Number(detail.expiry) * 1000).toLocaleString()}
                  </p>
                  {detail.seller.toLowerCase() === wallet.toLowerCase() ? (
                    <>
                    <div className="mf-inline">
                      <label>New listing price ({chain.native})<input value={editPrice} onChange={(event) => setEditPrice(event.target.value)} inputMode="decimal" placeholder={amount(detail.price)} /></label>
                      <button type="button" disabled={busy || !detail.active || editPrice === ""} onClick={() => run(async (m) => {
                        const value = parseEther(editPrice);
                        if (value < 0n) throw new Error("Price cannot be negative.");
                        await wait(m.updatePrice(detail.id, value));
                        setEditPrice("");
                      })}>Update price</button>
                    </div>
                    <p className="field-hint">Set a positive price for Buy now, or 0 to accept offers only. Existing offers remain available.</p>
                    <button
                      className="mf-button"
                      disabled={busy || !detail.active}
                      onClick={() =>
                        run(async (m) => {
                          await wait(m.cancel(detail.id));
                        })
                      }
                    >
                      Cancel listing
                    </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="mf-button"
                        disabled={busy || !detail.available || detail.price === 0n}
                        onClick={() =>
                          run(async (m) => {
                            await wait(
                              m.buy(detail.id, detail.price, {
                                value: detail.price,
                              }),
                            );
                          })
                        }
                      >
                        {detail.price === 0n ? "Offers only" : wallet ? `Buy for ${amount(detail.price)} ${chain.native}` : "Connect wallet to buy"}
                      </button>
                      <div className="mf-inline">
                        <label>
                          Funded offer ({chain.native})
                          <input
                            value={offerValue}
                            onChange={(e) => setOfferValue(e.target.value)}
                            inputMode="decimal"
                          />
                        </label>
                        <button
                          disabled={busy || !detail.available || !offerValue}
                          onClick={() =>
                            run(async (m) => {
                              const value = parseEther(offerValue);
                              if (value <= 0n)
                                throw new Error("Offer must be positive.");
                              await wait(
                                m.makeOffer(detail.id, detail.expiry, {
                                  value,
                                }),
                              );
                            })
                          }
                        >
                          Place offer
                        </button>
                      </div>
                      <p className="field-hint">
                        The offered amount is deposited in the marketplace.
                        Cancel an unaccepted offer to credit a refund, then
                        withdraw it.
                      </p>
                    </>
                  )}
                  <h3>Offers</h3>
                  {listingOffers.length ? (
                    listingOffers.map((o) => (
                      <div className="mf-position" key={o.id}>
                        <span>
                          {short(o.bidder)} · {amount(o.amount)} {chain.native}{" "}
                          · {o.active ? "Open" : "Closed"}
                        </span>
                        {detail.seller.toLowerCase() === wallet.toLowerCase() &&
                          o.active &&
                          detail.available &&
                          Number(o.expiry) > Date.now() / 1000 && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(async (m) => {
                                  await wait(m.acceptOffer(o.id));
                                })
                              }
                            >
                              Accept offer
                            </button>
                          )}
                      </div>
                    ))
                  ) : (
                    <p>No offers on this listing.</p>
                  )}
                  <div className="mf-toolbar">
                    <button
                      disabled={offerPage === 0}
                      onClick={() => setOfferPage((x) => x - 1)}
                    >
                      Previous offers
                    </button>
                    <button
                      disabled={(offerPage + 1) * 10 >= offerCount}
                      onClick={() => setOfferPage((x) => x + 1)}
                    >
                      Next offers
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : rows.length ? (
            <div className="mf-listing-grid">
              {rows.map((l) => (
                <article className="settings-card" key={l.id}>
                  <Media listing={l} chainId={chain.id} />
                  <div className="mf-toolbar">
                    <b>
                      {l.price === 0n ? "Accepting offers" : `${amount(l.price)} ${chain.native}`}
                    </b>
                    <small>{l.available ? "Available" : "Inactive"}</small>
                  </div>
                  <small>
                    Listing #{l.id} · {short(l.nft)} ·{" "}
                    {l.is1155 ? "ERC-1155" : "ERC-721"}
                  </small>
                  <button
                    className="mf-button"
                    onClick={() => setSelected(l.id)}
                  >
                    View listing
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="mf-empty">
              <h2>
                {view === "mine"
                  ? "No listings from this wallet"
                  : "No listings yet"}
              </h2>
              <p>{ready === false ? "Listings will appear here after activation. You can explore the listing form now." : "List an NFT to start trading on this network."}</p>
              <button onClick={() => setView("sell")}>List an NFT</button>
            </div>
          )}
          {view !== "sell" && selected === null && (
            <div className="mf-toolbar">
              <button
                disabled={busy || loading || page === 0}
                onClick={() => setPage((x) => x - 1)}
              >
                Previous
              </button>
              <span>
                Page {page + 1} · {total} records
              </span>
              <button
                disabled={busy || loading || (page + 1) * 12 >= total}
                onClick={() => setPage((x) => x + 1)}
              >
                Next
              </button>
              <button
                disabled={busy || loading}
                onClick={() => setRefresh((x) => x + 1)}
              >
                Refresh
              </button>
            </div>
          )}
    </section>
  );
}
