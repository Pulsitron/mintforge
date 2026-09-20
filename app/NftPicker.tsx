"use client";
import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import { errorText } from "../lib/web3";
export type PickedNft = {
  contract: string;
  tokenId: string;
  standard: string;
  name: string;
  image?: string | null;
  animation?: string | null;
  imageKind?: string;
  animationKind?: string;
  balance?: string;
};
export default function NftPicker({
  chainId,
  wallet,
  onPick,
  collection,
}: {
  chainId: string;
  wallet: string;
  onPick: (n: PickedNft) => void;
  collection?: string;
}) {
  const [assets, setAssets] = useState<PickedNft[]>([]),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [page, setPage] = useState(0),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [manual, setManual] = useState(""),
    [token, setToken] = useState(""),
    [standard, setStandard] = useState("ERC-721"),
    [selected, setSelected] = useState("");
  useEffect(() => {
    setPage(0);
    setCursors([null]);
    setAssets([]);
    setNext(null);
    setSelected("");
  }, [wallet, chainId]);
  const cursor = cursors[page];
  useEffect(() => {
    if (!wallet) return;
    const ctrl = new AbortController();
    setBusy(true);
    setError("");
    setAssets([]);
    setNext(null);
    const params = new URLSearchParams({ wallet, chainId });
    if (cursor) params.set("cursor", cursor);
    fetch("/api/wallet-nfts?" + params, { signal: ctrl.signal })
      .then(async (r) => {
        const d = (await r.json()) as {
          items?: PickedNft[];
          nextCursor?: string;
          error?: string;
        };
        if (!r.ok) throw new Error(d.error || "Wallet discovery unavailable.");
        if (!ctrl.signal.aborted) {
          setAssets(d.items || []);
          setNext(d.nextCursor || null);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBusy(false);
      });
    return () => ctrl.abort();
  }, [chainId, wallet, cursor, page]);
  function pick(n: PickedNft) {
    setSelected(n.contract + ":" + n.tokenId);
    onPick(n);
  }
  const visible = assets.filter(
    (a) =>
      a.contract &&
      (!collection || a.contract.toLowerCase() === collection.toLowerCase()),
  );
  return (
    <div className="mf-picker">
      {busy ? (
        <p role="status">Loading wallet NFTs…</p>
      ) : error ? (
        <p className="mf-warning">
          {error} You can enter a collection and token ID below.
        </p>
      ) : !visible.length ? (
        <p>No matching NFTs on this page.</p>
      ) : (
        <div className="mf-asset-grid">
          {visible.map((a) => (
            <button
              key={a.contract + ":" + a.tokenId}
              aria-pressed={selected === a.contract + ":" + a.tokenId}
              className={
                selected === a.contract + ":" + a.tokenId ? "selected" : ""
              }
              onClick={() => pick(a)}
            >
              {a.image && a.imageKind === "image" ? (
                <img src={a.image} alt="" loading="lazy" />
              ) : (
                <div className="mf-media-fallback">
                  {a.animationKind === "video"
                    ? "VIDEO"
                    : a.animationKind === "audio"
                      ? "AUDIO"
                      : "NFT"}
                </div>
              )}
              <b>{a.name || "#" + a.tokenId}</b>
              <small>
                {a.standard} · #{a.tokenId}
              </small>
            </button>
          ))}
        </div>
      )}
      <div className="mf-toolbar">
        <button
          disabled={busy || page === 0}
          onClick={() => setPage((x) => x - 1)}
        >
          Previous
        </button>
        <span>Wallet page {page + 1}</span>
        <button
          disabled={busy || !next}
          onClick={() => {
            setCursors((a) => [...a.slice(0, page + 1), next]);
            setPage((x) => x + 1);
          }}
        >
          Next
        </button>
      </div>
      <details>
        <summary>Enter an NFT manually</summary>
        <div className="mf-form-grid">
          <label>
            Collection address
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="0x…"
            />
          </label>
          <label>
            Token ID
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              inputMode="numeric"
              placeholder="0"
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
              <option>ERC-404</option>
            </select>
          </label>
          <button
            disabled={
              !isAddress(manual) ||
              !/^\d+$/.test(token) ||
              (!!collection &&
                collection.toLowerCase() !== manual.toLowerCase())
            }
            onClick={() =>
              pick({
                contract: manual,
                tokenId: token,
                standard,
                name: "NFT #" + token,
              })
            }
          >
            Select NFT
          </button>
        </div>
        <p>Ownership and approvals are checked on-chain when you submit.</p>
      </details>
    </div>
  );
}
