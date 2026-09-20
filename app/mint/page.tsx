"use client";
import { useEffect, useState } from "react";
import {
  concat,
  isAddress,
  keccak256,
  solidityPackedKeccak256,
  ZeroHash,
} from "ethers";
import { getChain } from "../../lib/chains";
import {
  amount,
  confirmed,
  contract,
  deployment,
  errorText,
  ipfs,
  signer,
} from "../../lib/web3";
import TransactionNotice from "../TransactionNotice";
type Drop = {
  name: string;
  price: bigint;
  supply: bigint;
  walletLimit: bigint;
  start: number;
  end: number;
  allowlistRoot: string;
  paused: boolean;
  minted: bigint;
  count: number;
  standard: number;
};
function proofFor(list: string[], wallet: string) {
  let layer = [
    ...new Set(
      list
        .filter(isAddress)
        .map((a) => solidityPackedKeccak256(["address"], [a])),
    ),
  ].sort();
  let current = solidityPackedKeccak256(["address"], [wallet]);
  let index = layer.indexOf(current);
  if (index < 0)
    throw new Error("This wallet is not on the published allowlist.");
  const proof: string[] = [];
  while (layer.length > 1) {
    const sibling = index ^ 1;
    if (sibling < layer.length) proof.push(layer[sibling]);
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2)
      next.push(
        i + 1 < layer.length
          ? keccak256(concat([layer[i], layer[i + 1]].sort()))
          : layer[i],
      );
    index = Math.floor(index / 2);
    layer = next;
  }
  return proof;
}
export default function Mint() {
  const [chainId, setChainId] = useState(""),
    [address, setAddress] = useState(""),
    [wallet, setWallet] = useState(""),
    [drop, setDrop] = useState<Drop | null>(null),
    [metadata, setMetadata] = useState<Record<string, unknown> | null>(null),
    [quantity, setQuantity] = useState("1"),
    [tokenId, setTokenId] = useState("1"),
    [message, setMessage] = useState(""),
    [hash, setHash] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [walletMinted, setWalletMinted] = useState<bigint | null>(null);
  useEffect(() => {
    try {
      const p = new URLSearchParams(location.search);
      const c = getChain(p.get("chain") || "369");
      const a = p.get("collection") || "";
      if (!isAddress(a))
        throw new Error("The mint link is missing a valid collection address.");
      setChainId(c.id);
      setAddress(a);
    } catch (e) {
      setMessage(errorText(e));
    }
  }, []);
  useEffect(() => {
    let active = true;
    if (!chainId || !address) return;
    setMetadata(null);
    (async () => {
      const d = await deployment(chainId);
      if (!d) throw new Error("This network has not been configured.");
      const f = await contract("MintForgeFactory", d.factory, chainId);
      const standard = Number(await f.standard(address));
      if (!standard)
        throw new Error(
          "This collection is not registered with MintForge on this network.",
        );
      const c = await contract(
        standard === 404 ? "MintForge404" : standard === 1155 ? "MintForge1155" : "MintForge721",
        address,
        chainId,
      );
      const [cfg, paused, minted, count, uri] = await Promise.all([
        c.config(),
        c.paused(),
        standard === 1155 ? c.mintedById(tokenId) : c.totalMinted(),
        c.metadataCount(),
        c.previewURI(Number(tokenId) - 1),
      ]);
      if (active)
        setDrop({
          name: cfg.name,
          price: cfg.price,
          supply: cfg.supply,
          walletLimit: cfg.walletLimit,
          start: Number(cfg.start),
          end: Number(cfg.end),
          allowlistRoot: cfg.allowlistRoot,
          paused,
          minted,
          count: Number(count),
          standard,
        });
      const r = await fetch("/api/nft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri }),
      });
      const m = (await r.json()) as { raw?: Record<string, unknown> };
      if (active) setMetadata(m.raw || null);
      if (wallet) {
        const minted = await c.walletMinted(wallet);
        if (active) setWalletMinted(minted);
      }
    })().catch((e) => {
      if (active) setMessage(errorText(e));
    });
    return () => {
      active = false;
    };
  }, [chainId, address, refresh, tokenId, wallet]);
  async function connect() {
    try {
      const s = await signer(chainId);
      setWallet(await s.getAddress());
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function mint() {
    if (!wallet) {
      await connect();
      return;
    }
    if (!drop) return;
    setBusy(true);
    setHash("");
    try {
      const qty = BigInt(quantity);
      if (qty < 1n || qty > 50n)
        throw new Error("Mint between 1 and 50 at a time.");
      const c = await contract(
        drop.standard === 404 ? "MintForge404" : drop.standard === 1155 ? "MintForge1155" : "MintForge721",
        address,
        chainId,
        true,
        wallet,
      );
      const current = await c.config();
      if (current.price !== drop.price)
        throw new Error("The mint price changed. Refresh before minting.");
      let remoteAllowlist: string[] = [];
      if (typeof metadata?.mintforge_allowlist_uri === "string") {
        const response = await fetch("/api/nft",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uri:metadata.mintforge_allowlist_uri})});
        const data = await response.json() as {raw?:{addresses?: string[]}};
        if (!response.ok || !Array.isArray(data.raw?.addresses)) throw new Error("Unable to load the collection allowlist.");
        remoteAllowlist = data.raw.addresses;
      }
      const allowlist = remoteAllowlist.length ? remoteAllowlist : Array.isArray(metadata?.mintforge_allowlist)
        ? (metadata.mintforge_allowlist as string[])
        : [];
      const proof =
        drop.allowlistRoot === ZeroHash ? [] : proofFor(allowlist, wallet);
      setMessage("Review the mint and total payment in your wallet.");
      const tx =
        drop.standard === 1155
          ? c.mint(tokenId, qty, proof, { value: drop.price * qty })
          : c.mint(qty, proof, { value: drop.price * qty });
      await confirmed(tx, (h) => {
        setHash(h);
        setMessage("Waiting for mint confirmation…");
      });
      setMessage(drop.standard === 404 ? "ERC-404 mint confirmed: whole tokens and linked NFTs are in your wallet. Fractional transfers can change NFT ownership." : "Mint confirmed. Your NFT is now in your wallet.");
      setRefresh((x) => x + 1);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const chain = chainId ? getChain(chainId) : null;
  const image = typeof metadata?.image === "string" ? ipfs(metadata.image) : "";
  const animation =
    typeof metadata?.animation_url === "string"
      ? ipfs(metadata.animation_url)
      : "";
  const files = (
    metadata?.properties as { files?: { type?: string }[] } | undefined
  )?.files;
  const mime = files?.[0]?.type || "";
  const available =
    drop &&
    !drop.paused &&
    Date.now() / 1000 >= drop.start &&
    (!drop.end || Date.now() / 1000 < drop.end) &&
    drop.minted < drop.supply;
  return (
    <main className="mf-standalone">
      <a className="mf-back" href="/">
        ← MintForge
      </a>
      <span className="section-number">COLLECTOR MINT</span>
      <h1>{drop?.name || "Mint a collectible"}</h1>
      {drop?.standard === 404 && <p className="mf-warning">ERC-404 is experimental. Each whole token links to an NFT; fractional transfers can bank or restore NFT IDs. Wallet display and marketplace support vary.</p>}
      {chain && (
        <p>
          {chain.name} ·{" "}
          <a
            href={chain.explorer + "/address/" + address}
            target="_blank"
            rel="noreferrer"
          >
            {address}
          </a>
        </p>
      )}
      <TransactionNotice
        message={message}
        hash={hash}
        chainId={chainId || "0x171"}
      />
      {drop && chain && (
        <div className="mf-two-col">
          <section className="settings-card mf-mint-media">
            {animation &&
            (mime.startsWith("video/") || /\.(mp4|webm)/i.test(animation)) ? (
              <video src={animation} autoPlay muted loop controls playsInline />
            ) : animation && mime.startsWith("audio/") ? (
              <audio src={animation} controls loop />
            ) : image ? (
              <img src={image} alt={String(metadata?.name || drop.name)} />
            ) : (
              <div className="mf-media-fallback">
                {animation
                  ? "Interactive / downloadable collectible"
                  : "Loading artwork…"}
              </div>
            )}
            <h2>{String(metadata?.name || drop.name)}</h2>
            <p>{String(metadata?.description || "")}</p>
            {animation &&
              !mime.startsWith("video/") &&
              !mime.startsWith("audio/") && (
                <a href={animation} target="_blank" rel="noreferrer">
                  Open original file ↗
                </a>
              )}
          </section>
          <section className="settings-card">
            <h2>
              {amount(drop.price)} {chain.native} per NFT
            </h2>
            <p>
              {String(drop.minted)} minted
              {drop.supply < 10n ** 30n
                ? " / " + String(drop.supply)
                : " · Open edition"}
              {drop.standard === 1155 ? " of this artwork" : ""}
            </p>
            <p>
              {available
                ? "Mint is open"
                : drop.paused
                  ? "Mint paused"
                  : drop.minted >= drop.supply
                    ? "Sold out"
                    : "Outside the mint window"}
            </p>
            <p>
              Wallet limit: {String(drop.walletLimit)}
              {walletMinted !== null
                ? " · Already minted: " + String(walletMinted)
                : ""}
            </p>
            {drop.allowlistRoot !== ZeroHash && (
              <p>
                Allowlist mint. Your wallet must be in the collection’s
                published allowlist.
              </p>
            )}
            {drop.count > 1 && (
              <label>
                Artwork
                <select
                  value={tokenId}
                  onChange={(e) => setTokenId(e.target.value)}
                >
                  {Array.from({ length: drop.count }, (_, i) => (
                    <option key={i} value={i + 1}>
                      Artwork {i + 1}
                    </option>
                  ))}
                </select>
                {drop.standard === 721 && (
                  <small>
                    ERC-721 artwork is assigned sequentially when minted; this
                    selector previews the collection.
                  </small>
                )}
              </label>
            )}
            <label>
              Quantity
              <input
                type="number"
                min="1"
                max="50"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <p>
              Total:{" "}
              {/^[1-9]\d*$/.test(quantity)
                ? amount(drop.price * BigInt(quantity))
                : "—"}{" "}
              {chain.native} plus network fee.
            </p>
            <button
              className="mf-button"
              disabled={busy || !available}
              onClick={mint}
            >
              {busy
                ? "Minting…"
                : wallet
                  ? "Mint NFT"
                  : "Connect wallet to mint"}
            </button>
            <button disabled={busy} onClick={() => setRefresh((x) => x + 1)}>
              Refresh availability
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
