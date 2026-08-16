"use client";

import { ChangeEvent, createElement, DragEvent, HTMLAttributes, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import NftViewer from "./NftViewer";
import NftStaking from "./NftStaking";

const chains = [
  { id: "0x171", name: "PulseChain", native: "PLS", mark: "P", colour: "#18d99b" },
  { id: "0x1", name: "Ethereum", native: "ETH", mark: "E", colour: "#8b7cff" },
  { id: "0x2105", name: "Base", native: "ETH", mark: "B", colour: "#3f7cff" },
  { id: "0x89", name: "Polygon", native: "POL", mark: "M", colour: "#a66cff" },
  { id: "0xa4b1", name: "Arbitrum", native: "ETH", mark: "A", colour: "#4da4ef" },
  { id: "0x38", name: "BNB Chain", native: "BNB", mark: "N", colour: "#f3ba2f" },
];

const steps = [
  ["01", "Artwork"],
  ["02", "Collection"],
  ["03", "Mint settings"],
  ["04", "Revenue"],
  ["05", "Utility"],
  ["06", "Review"],
];

const headings = [
  { number: "01 / 06", title: <>Upload the <em>impossible.</em></>, copy: "Turn any file—art, audio, 3D, code, documents or something entirely new—into an on-chain collectible." },
  { number: "02 / 06", title: <>Choose where it <em>lives.</em></>, copy: "Mint through the platform or launch a collection contract you own." },
  { number: "03 / 06", title: <>Engineer the <em>drop.</em></>, copy: "Set supply, price, timing and who gets first access." },
  { number: "04 / 06", title: <>Program the <em>revenue.</em></>, copy: "Configure primary splits and creator royalties with full transparency." },
  { number: "05 / 06", title: <>Activate real <em>utility.</em></>, copy: "Turn your NFT into a stakeable, burnable or access-gated asset." },
  { number: "06 / 06", title: <>Review the <em>protocol.</em></>, copy: "Check every module before this build moves into smart-contract production." },
];

type FileKind = "image" | "video" | "audio" | "interactive" | "model" | "document" | "code" | "archive" | "file";
type UploadedArtwork = { name: string; size: string; type: string; extension: string; kind: FileKind; url: string; previewText: string | null };

type Draft = {
  name: string;
  description: string;
  externalUrl: string;
  collectionMode: "shared" | "owned";
  collectionName: string;
  symbol: string;
  standard: "ERC-721" | "ERC-1155";
  collectionDescription: string;
  mintType: "unique" | "fixed" | "open";
  supply: string;
  price: string;
  maxPerWallet: string;
  saleTiming: "now" | "scheduled";
  saleStart: string;
  saleEnd: string;
  allowlist: boolean;
  delayedReveal: boolean;
  royaltyEnabled: boolean;
  royaltyPercent: number;
  royaltyReceiver: string;
  primarySplitEnabled: boolean;
  collaboratorAddress: string;
  collaboratorPercent: number;
  stakingEnabled: boolean;
  stakeVaultMode: "shared" | "creator";
  stakeCustody: "vault" | "wallet";
  stakeRewardType: "native" | "erc20";
  rewardToken: string;
  rewardRate: string;
  minimumLock: string;
  exitPenalty: string;
  burningEnabled: boolean;
  burnOutcome: "redeem" | "evolve" | "access";
  burnQuantity: string;
  burnReward: string;
  unlockableEnabled: boolean;
  soulbound: boolean;
  pausable: boolean;
  freezeMetadata: boolean;
};

const initialDraft: Draft = {
  name: "",
  description: "",
  externalUrl: "",
  collectionMode: "shared",
  collectionName: "Untitled Collection",
  symbol: "",
  standard: "ERC-721",
  collectionDescription: "",
  mintType: "unique",
  supply: "1",
  price: "0.10",
  maxPerWallet: "1",
  saleTiming: "now",
  saleStart: "",
  saleEnd: "",
  allowlist: false,
  delayedReveal: false,
  royaltyEnabled: true,
  royaltyPercent: 5,
  royaltyReceiver: "",
  primarySplitEnabled: false,
  collaboratorAddress: "",
  collaboratorPercent: 20,
  stakingEnabled: false,
  stakeVaultMode: "shared",
  stakeCustody: "vault",
  stakeRewardType: "erc20",
  rewardToken: "",
  rewardRate: "10",
  minimumLock: "30",
  exitPenalty: "5",
  burningEnabled: false,
  burnOutcome: "evolve",
  burnQuantity: "1",
  burnReward: "",
  unlockableEnabled: false,
  soulbound: false,
  pausable: true,
  freezeMetadata: true,
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" className={checked ? "toggle on" : "toggle"} onClick={() => onChange(!checked)} aria-pressed={checked} aria-label={label}>
      <span />
    </button>
  );
}

function ChoiceCard({ selected, onClick, tag, title, copy, children }: { selected: boolean; onClick: () => void; tag?: string; title: string; copy: string; children?: ReactNode }) {
  return (
    <button type="button" className={selected ? "choice-card selected" : "choice-card"} onClick={onClick}>
      <span className="choice-check">{selected ? "✓" : ""}</span>
      {tag && <b className="choice-tag">{tag}</b>}
      <strong>{title}</strong>
      <p>{copy}</p>
      {children}
    </button>
  );
}

function LocalModelPreview({ artwork }: { artwork: UploadedArtwork }) {
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

  if (!ready) return <div className="preview-loading"><span>◇</span><b>Preparing 3D preview…</b></div>;

  const props = {
    src: artwork.url,
    "camera-controls": "",
    "auto-rotate": "",
    "shadow-intensity": "1",
    "environment-image": "neutral",
    "touch-action": "pan-y",
    alt: artwork.name,
    className: "creator-model-viewer",
  } as HTMLAttributes<HTMLElement>;

  return createElement("model-viewer", props);
}

function GenericFilePreview({ artwork }: { artwork: UploadedArtwork }) {
  return <div className="generic-file-preview"><i>{artwork.extension.slice(0, 5)}</i><span>{artwork.kind.toUpperCase()} ASSET</span><strong>{artwork.name}</strong><small>{artwork.size} · Original payload ready to mint</small></div>;
}

function LiveArtworkPreview({ artwork }: { artwork: UploadedArtwork }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === artwork.url) return <GenericFilePreview artwork={artwork} />;
  if (artwork.kind === "image") return <img src={artwork.url} alt="Uploaded NFT preview" onError={() => setFailedUrl(artwork.url)} />;
  if (artwork.kind === "video") return <video src={artwork.url} controls autoPlay loop muted playsInline preload="auto" onError={() => setFailedUrl(artwork.url)} />;
  if (artwork.kind === "audio") return <div className="audio-preview"><div className="audio-visual"><span>♪</span><div>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ animationDelay: -index * 0.07 + "s" }} />)}</div></div><strong>{artwork.name}</strong><small>LOOPING AUDIO · {artwork.extension}</small><audio src={artwork.url} controls autoPlay loop preload="auto" onError={() => setFailedUrl(artwork.url)} /></div>;
  if (artwork.kind === "interactive") return <iframe className="local-file-frame" src={artwork.url} sandbox="allow-scripts allow-forms allow-pointer-lock" title="Uploaded interactive file preview" />;
  if (artwork.kind === "document" && artwork.extension === "PDF") return <iframe className="local-file-frame" src={artwork.url} title="Uploaded PDF preview" />;
  if (artwork.kind === "model" && ["GLB", "GLTF"].includes(artwork.extension)) return <LocalModelPreview artwork={artwork} />;
  if (artwork.kind === "code" && artwork.previewText) return <div className="code-file-preview"><div><span>{artwork.extension}</span><b>{artwork.name}</b></div><pre>{artwork.previewText}</pre></div>;
  return <GenericFilePreview artwork={artwork} />;
}

export default function Home() {
  const [mode, setMode] = useState<"create" | "viewer" | "stake">("create");
  const [activeStep, setActiveStep] = useState(0);
  const [selectedChain, setSelectedChain] = useState(chains[0]);
  const [chainOpen, setChainOpen] = useState(false);
  const [wallet, setWallet] = useState("");
  const [notice, setNotice] = useState("");
  const [artwork, setArtwork] = useState<UploadedArtwork | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [reviewModal, setReviewModal] = useState(false);
  const [savedAt, setSavedAt] = useState("Draft saved locally");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("mintforge-draft");
      if (saved) setDraft({ ...initialDraft, ...JSON.parse(saved) });
    } catch {
      setNotice("This browser could not restore your previous local draft.");
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.request({ method: "eth_accounts" })
      .then((accounts) => {
        const list = accounts as string[];
        if (list?.[0]) setWallet(list[0]);
      })
      .catch(() => undefined);

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setWallet(accounts?.[0] || "");
    };
    const onChainChanged = (...args: unknown[]) => {
      const chainId = String(args[0] || "").toLowerCase();
      const matchingChain = chains.find((chain) => chain.id.toLowerCase() === chainId);
      if (matchingChain) setSelectedChain(matchingChain);
    };
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem("mintforge-draft", JSON.stringify(draft));
      setSavedAt("Draft saved locally");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const shortWallet = useMemo(() => wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "", [wallet]);
  const progress = Math.round(((activeStep + 1) / steps.length) * 100);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function connectWallet() {
    setNotice("");
    if (!window.ethereum) {
      setNotice("No EVM wallet found. Install MetaMask or Rabby to connect.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts?.[0]) {
        setWallet(accounts[0]);
        if (!draft.royaltyReceiver) update("royaltyReceiver", accounts[0]);
      }
    } catch {
      setNotice("Connection was cancelled. Your draft is still safe.");
    }
  }

  async function chooseChain(chain: (typeof chains)[number]) {
    setSelectedChain(chain);
    setChainOpen(false);
    if (mode === "create" && wallet && window.ethereum) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.id }] });
      } catch {
        setNotice(chain.name + " is selected here. Add or switch networks in your wallet when prompted at launch.");
      }
    }
  }

  function detectFileKind(file: File): FileKind {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (file.type.startsWith("image/") || ["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"].includes(extension)) return "image";
    if (file.type.startsWith("video/") || ["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"].includes(extension)) return "video";
    if (file.type.startsWith("audio/") || ["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba"].includes(extension)) return "audio";
    if (file.type === "text/html" || ["html", "htm"].includes(extension)) return "interactive";
    if (file.type.startsWith("model/") || ["glb", "gltf", "usdz", "obj", "fbx", "stl"].includes(extension)) return "model";
    if (file.type === "application/pdf" || ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "epub"].includes(extension)) return "document";
    if (file.type.startsWith("text/") || ["js", "jsx", "ts", "tsx", "sol", "py", "rs", "json", "md", "css", "xml", "csv"].includes(extension)) return "code";
    if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(extension)) return "archive";
    return "file";
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  async function acceptFile(file?: File) {
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) {
      setNotice("This interface currently accepts files up to 500 MB. Compress larger assets or use an external metadata URI.");
      return;
    }
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() || "FILE" : "FILE";
    const kind = detectFileKind(file);
    let previewText: string | null = null;
    if (kind === "code") {
      try {
        const limit = 64 * 1024;
        const rawText = await file.slice(0, limit).text();
        if (extension === "JSON") {
          try { previewText = JSON.stringify(JSON.parse(rawText), null, 2); }
          catch { previewText = rawText; }
        } else previewText = rawText;
        if (file.size > limit) previewText += "\n\n… Preview truncated. The complete file will be minted.";
      } catch {
        previewText = "Preview unavailable. The complete original file is still ready to mint.";
      }
    }
    if (artwork?.url) URL.revokeObjectURL(artwork.url);
    setArtwork({ name: file.name, size: formatFileSize(file.size), type: file.type || "application/octet-stream", extension, kind, url: URL.createObjectURL(file), previewText });
    if (!draft.name) update("name", file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "));
    setNotice("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
  }

  function goToStep(index: number) {
    setActiveStep(Math.max(0, Math.min(steps.length - 1, index)));
    window.scrollTo(0, 0);
  }

  function saveDraft() {
    localStorage.setItem("mintforge-draft", JSON.stringify(draft));
    setSavedAt("Saved just now");
    setNotice("Draft saved on this device.");
  }

  function switchMode(nextMode: "create" | "viewer" | "stake") {
    setMode(nextMode);
    setChainOpen(false);
    setNotice("");
    window.scrollTo(0, 0);
  }

  function renderArtwork() {
    return (
      <div className="creation-grid">
        <section className="form-panel">
          <div
            className={dragging ? "upload-zone dragging" : artwork ? "upload-zone has-file" : "upload-zone"}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileRef.current?.click(); }}
          >
            <input ref={fileRef} type="file" onChange={onFileChange} hidden />
            <div className="upload-beam" aria-hidden="true" />
            <div className="upload-symbol"><span>↑</span></div>
            {artwork ? <><span className="file-kicker">{artwork.kind.toUpperCase()} · {artwork.extension}</span><h2>{artwork.name}</h2><p>{artwork.size} · Click to replace</p></> : <><span className="file-kicker">UNIVERSAL ASSET INPUT</span><h2>Drop literally any file</h2><p>Images, video, audio, 3D, PDFs, HTML, code, archives and more · Up to 500 MB</p></>}
            <button type="button">{artwork ? "Replace file" : "Choose any file"}</button>
          </div>
          <div className="form-fields">
            <label className="field wide"><span>NAME <b>REQUIRED</b></span><input value={draft.name} onChange={(e) => update("name", e.target.value)} placeholder="Give your NFT a memorable name" maxLength={80} /><small>{draft.name.length} / 80</small></label>
            <label className="field wide"><span>DESCRIPTION</span><textarea value={draft.description} onChange={(e) => update("description", e.target.value)} placeholder="Tell collectors the story behind this work…" maxLength={1000} /><small>{draft.description.length} / 1,000</small></label>
            <label className="field wide"><span>EXTERNAL LINK <b>OPTIONAL</b></span><div className="input-prefix"><i>↗</i><input type="url" value={draft.externalUrl} onChange={(e) => update("externalUrl", e.target.value)} placeholder="https://yourwebsite.com/artwork" /></div></label>
          </div>
        </section>
        <aside className="preview-column">
          <div className="preview-label"><span>LIVE PREVIEW</span><b>{selectedChain.name}</b></div>
          <article className="nft-card">
            <div className="media-preview">
              {artwork && <LiveArtworkPreview artwork={artwork} />}
              {!artwork && <div className="empty-preview"><span>YOUR<br />ARTWORK</span><i /></div>}
              <span className="chain-chip" style={{ background: selectedChain.colour }}>{selectedChain.mark}</span>
            </div>
            <div className="card-copy">
              <span className="collection-name">{draft.collectionName.toUpperCase()} <b>◇</b></span>
              <h3>{draft.name || "Your NFT name"}</h3>
              <div className="card-bottom"><span>EDITION <b>{draft.mintType === "unique" ? "1 of 1" : "1 of " + draft.supply}</b></span><span>CREATOR <b>{wallet ? shortWallet : "Not connected"}</b></span></div>
            </div>
          </article>
          <div className="storage-note"><span>◎</span><div><b>Any file. Content-addressed.</b><p>The original payload will be pinned to IPFS when contract integration is enabled.</p></div></div>
        </aside>
      </div>
    );
  }

  function renderCollection() {
    return (
      <div className="settings-layout">
        <section className="settings-main">
          <div className="choice-grid two">
            <ChoiceCard selected={draft.collectionMode === "shared"} onClick={() => update("collectionMode", "shared")} tag="FASTEST" title="Mint Forge collection" copy="Mint into our shared multichain contract. No separate deployment needed."><span className="mini-detail">Lower setup cost · Instant launch</span></ChoiceCard>
            <ChoiceCard selected={draft.collectionMode === "owned"} onClick={() => update("collectionMode", "owned")} tag="FULL CONTROL" title="Creator-owned contract" copy="Deploy a dedicated collection contract owned by your connected wallet."><span className="mini-detail">Custom contract · Transferable ownership</span></ChoiceCard>
          </div>
          <div className="settings-card">
            <div className="card-heading"><div><span>COLLECTION IDENTITY</span><h2>Name the collection</h2></div><span className="card-index">A</span></div>
            <div className="form-fields compact">
              <label className="field"><span>COLLECTION NAME</span><input value={draft.collectionName} onChange={(e) => update("collectionName", e.target.value)} placeholder="Collection name" /></label>
              <label className="field"><span>SYMBOL</span><input value={draft.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase().slice(0, 8))} placeholder="FORGE" /></label>
              <label className="field wide"><span>COLLECTION DESCRIPTION</span><textarea value={draft.collectionDescription} onChange={(e) => update("collectionDescription", e.target.value)} placeholder="What connects the work in this collection?" /></label>
            </div>
          </div>
          <div className="settings-card">
            <div className="card-heading"><div><span>TOKEN STANDARD</span><h2>Choose the right format</h2></div><span className="card-index">B</span></div>
            <div className="choice-grid two tight">
              <ChoiceCard selected={draft.standard === "ERC-721"} onClick={() => update("standard", "ERC-721")} title="ERC-721" copy="Best for unique works and individually tracked editions." />
              <ChoiceCard selected={draft.standard === "ERC-1155"} onClick={() => update("standard", "ERC-1155")} title="ERC-1155" copy="Efficient for larger editions and multiple asset types." />
            </div>
          </div>
        </section>
        <aside className="summary-rail">
          <span className="rail-label">CONTRACT PREVIEW</span>
          <div className="contract-card">
            <div className="contract-icon"><span>{draft.collectionMode === "shared" ? "◇" : "◆"}</span></div>
            <span>{draft.collectionMode === "shared" ? "SHARED COLLECTION" : "CREATOR CONTRACT"}</span>
            <h3>{draft.collectionName || "Untitled Collection"}</h3>
            <dl><div><dt>Network</dt><dd>{selectedChain.name}</dd></div><div><dt>Standard</dt><dd>{draft.standard}</dd></div><div><dt>Owner</dt><dd>{draft.collectionMode === "shared" ? "Mint Forge" : wallet ? shortWallet : "Connect wallet"}</dd></div><div><dt>Symbol</dt><dd>{draft.symbol || "—"}</dd></div></dl>
          </div>
          <div className="info-block"><b>Why two modes?</b><p>Creators can launch quickly through the platform or own a dedicated contract. Both routes use the same studio controls.</p></div>
        </aside>
      </div>
    );
  }

  function renderMint() {
    return (
      <div className="settings-layout">
        <section className="settings-main">
          <div className="settings-card first">
            <div className="card-heading"><div><span>EDITION MODEL</span><h2>How many can exist?</h2></div><span className="card-index">A</span></div>
            <div className="choice-grid three tight">
              <ChoiceCard selected={draft.mintType === "unique"} onClick={() => { update("mintType", "unique"); update("supply", "1"); }} title="1 / 1" copy="One truly unique token." />
              <ChoiceCard selected={draft.mintType === "fixed"} onClick={() => { update("mintType", "fixed"); if (draft.supply === "1") update("supply", "100"); }} title="Fixed edition" copy="Set a hard maximum supply." />
              <ChoiceCard selected={draft.mintType === "open"} onClick={() => update("mintType", "open")} title="Open edition" copy="Mint freely until the sale ends." />
            </div>
            <div className="form-fields compact top-gap">
              <label className="field"><span>MAXIMUM SUPPLY</span><input type="number" min="1" disabled={draft.mintType === "unique"} value={draft.supply} onChange={(e) => update("supply", e.target.value)} /></label>
              <label className="field"><span>MAX PER WALLET</span><input type="number" min="1" value={draft.maxPerWallet} onChange={(e) => update("maxPerWallet", e.target.value)} /></label>
            </div>
          </div>
          <div className="settings-card">
            <div className="card-heading"><div><span>PRICE</span><h2>Set the mint price</h2></div><span className="card-index">B</span></div>
            <div className="price-field"><input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => update("price", e.target.value)} /><span>{selectedChain.native}</span></div>
            <p className="field-help">Enter 0 for a free mint. Gas fees are paid separately by the collector.</p>
          </div>
          <div className="settings-card">
            <div className="card-heading"><div><span>AVAILABILITY</span><h2>Control the launch</h2></div><span className="card-index">C</span></div>
            <div className="segmented"><button className={draft.saleTiming === "now" ? "active" : ""} onClick={() => update("saleTiming", "now")}>Open immediately</button><button className={draft.saleTiming === "scheduled" ? "active" : ""} onClick={() => update("saleTiming", "scheduled")}>Schedule window</button></div>
            {draft.saleTiming === "scheduled" && <div className="form-fields compact top-gap"><label className="field"><span>START</span><input type="datetime-local" value={draft.saleStart} onChange={(e) => update("saleStart", e.target.value)} /></label><label className="field"><span>END</span><input type="datetime-local" value={draft.saleEnd} onChange={(e) => update("saleEnd", e.target.value)} /></label></div>}
            <div className="toggle-list top-gap">
              <div><div><b>Allowlist phase</b><p>Reserve early access for approved wallets.</p></div><Toggle checked={draft.allowlist} onChange={(v) => update("allowlist", v)} label="Allowlist phase" /></div>
              <div><div><b>Delayed reveal</b><p>Show placeholder art until you reveal the collection.</p></div><Toggle checked={draft.delayedReveal} onChange={(v) => update("delayedReveal", v)} label="Delayed reveal" /></div>
            </div>
          </div>
        </section>
        <aside className="summary-rail sticky-rail">
          <span className="rail-label">DROP SNAPSHOT</span>
          <div className="metric-card"><span>MINT PRICE</span><strong>{draft.price || "0"} <i>{selectedChain.native}</i></strong><p>{draft.price === "0" ? "Free mint" : "Per NFT, before gas"}</p></div>
          <div className="metric-grid"><div><span>SUPPLY</span><b>{draft.mintType === "open" ? "OPEN" : draft.supply}</b></div><div><span>PER WALLET</span><b>{draft.maxPerWallet}</b></div></div>
          <div className="timeline-card"><i /><div><span>SALE STATUS</span><b>{draft.saleTiming === "now" ? "Ready to open" : "Scheduled"}</b><p>{draft.allowlist ? "Allowlist enabled" : "Public mint"}</p></div></div>
        </aside>
      </div>
    );
  }

  function renderRevenue() {
    return (
      <div className="settings-layout">
        <section className="settings-main">
          <div className="settings-card first">
            <div className="module-title"><div><span>RESALE ROYALTIES</span><h2>Reward the creator over time</h2><p>Request a percentage whenever this NFT is resold on compatible marketplaces.</p></div><Toggle checked={draft.royaltyEnabled} onChange={(v) => update("royaltyEnabled", v)} label="Resale royalties" /></div>
            {draft.royaltyEnabled && <>
              <div className="royalty-value"><strong>{draft.royaltyPercent.toFixed(1)}%</strong><span>CREATOR ROYALTY</span></div>
              <input className="range" type="range" min="0" max="15" step=".5" value={draft.royaltyPercent} onChange={(e) => update("royaltyPercent", Number(e.target.value))} aria-label="Royalty percentage" />
              <div className="range-labels"><span>0%</span><span>5% typical</span><span>15%</span></div>
              <label className="field top-gap"><span>ROYALTY RECEIVER</span><input value={draft.royaltyReceiver} onChange={(e) => update("royaltyReceiver", e.target.value)} placeholder="0x wallet address" /></label>
            </>}
          </div>
          <div className="settings-card">
            <div className="module-title"><div><span>PRIMARY SALE SPLIT</span><h2>Share the first sale</h2><p>Automatically split mint proceeds with a collaborator.</p></div><Toggle checked={draft.primarySplitEnabled} onChange={(v) => update("primarySplitEnabled", v)} label="Primary sale split" /></div>
            {draft.primarySplitEnabled && <div className="split-box">
              <div className="split-row"><span className="avatar">YOU</span><div><b>Creator wallet</b><p>{wallet ? shortWallet : "Connect wallet"}</p></div><strong>{100 - draft.collaboratorPercent}%</strong></div>
              <div className="split-row"><span className="avatar alt">02</span><div className="split-address"><b>Collaborator</b><input value={draft.collaboratorAddress} onChange={(e) => update("collaboratorAddress", e.target.value)} placeholder="0x address" /></div><input className="percent-input" type="number" min="1" max="99" value={draft.collaboratorPercent} onChange={(e) => update("collaboratorPercent", Math.min(99, Math.max(1, Number(e.target.value))))} /><strong>%</strong></div>
            </div>}
          </div>
          <div className="settings-card">
            <div className="card-heading"><div><span>FEE TRANSPARENCY</span><h2>Estimated distribution</h2></div><span className="card-index">C</span></div>
            <div className="fee-table"><div><span>Creator proceeds</span><b>{draft.primarySplitEnabled ? 98.5 * ((100 - draft.collaboratorPercent) / 100) : 98.5}%</b></div>{draft.primarySplitEnabled && <div><span>Collaborator proceeds</span><b>{(98.5 * draft.collaboratorPercent / 100).toFixed(2)}%</b></div>}<div><span>Mint Forge platform fee</span><b>1.5%</b></div><div className="total"><span>Total</span><b>100%</b></div></div>
          </div>
        </section>
        <aside className="summary-rail sticky-rail">
          <span className="rail-label">REVENUE SUMMARY</span>
          <div className="revenue-visual"><div style={{ width: (100 - (draft.primarySplitEnabled ? draft.collaboratorPercent : 0)) + "%" }} /><div className="collab" style={{ width: (draft.primarySplitEnabled ? draft.collaboratorPercent : 0) + "%" }} /></div>
          <div className="legend"><span><i /> Creator</span>{draft.primarySplitEnabled && <span><i className="collab" /> Collaborator</span>}</div>
          <div className="metric-card"><span>SECONDARY SALES</span><strong>{draft.royaltyEnabled ? draft.royaltyPercent.toFixed(1) + "%" : "OFF"}</strong><p>ERC-2981 royalty signal</p></div>
          <div className="info-block warning"><b>Marketplace note</b><p>Royalties are signalled on-chain, but enforcement depends on the marketplace. Contract design will make this clear.</p></div>
        </aside>
      </div>
    );
  }

  function renderUtility() {
    return (
      <div className="utility-stack">
        <section className={draft.stakingEnabled ? "utility-card enabled" : "utility-card"}>
          <div className="utility-head"><span className="utility-index">01</span><div><span>STAKING MODULE</span><h2>Reward long-term holders</h2><p>Let collectors lock NFTs to earn a native coin or ERC-20 reward.</p></div><Toggle checked={draft.stakingEnabled} onChange={(v) => update("stakingEnabled", v)} label="Staking module" /></div>
          {draft.stakingEnabled && <div className="utility-body">
            <div className="staking-config-section">
              <div className="staking-section-title"><span>STAKING CONTRACT</span><b>Choose the infrastructure</b><p>The selected contract—not MintForge staff or an administrator wallet—controls the staking record.</p></div>
              <div className="choice-grid two tight vault-options">
                <ChoiceCard selected={draft.stakeVaultMode === "shared"} onClick={() => update("stakeVaultMode", "shared")} tag="RECOMMENDED" title="Shared MintForge vault" copy="Use the audited MintForge staking contract deployed on this network."><span className="mini-detail">Isolated collection accounting · Lower deployment cost</span></ChoiceCard>
                <ChoiceCard selected={draft.stakeVaultMode === "creator"} onClick={() => update("stakeVaultMode", "creator")} tag="DEDICATED" title="Creator-owned vault" copy="Deploy a separate staking contract owned by the creator wallet."><span className="mini-detail">Dedicated address · Greater control and cost</span></ChoiceCard>
              </div>
            </div>

            <div className="staking-config-section">
              <div className="staking-section-title"><span>NFT CUSTODY</span><b>Choose where the NFT is held</b><p>This determines whether staking transfers the NFT or records a lock while it remains in the holder&apos;s wallet.</p></div>
              {draft.soulbound ? <div className="soulbound-custody"><i>◎</i><div><span>SOULBOUND-SAFE MODE</span><b>Non-custodial wallet lock selected</b><p>The NFT remains in the holder&apos;s wallet. The staking contract records its locked state because a soulbound NFT cannot be transferred into a vault.</p></div></div> : <div className="choice-grid two tight vault-options">
                <ChoiceCard selected={draft.stakeCustody === "vault"} onClick={() => update("stakeCustody", "vault")} tag="RECOMMENDED" title="Vault custody" copy="The exact NFT is transferred into the staking contract and returned on withdrawal."><span className="mini-detail">Visible on-chain custody · Simple, proven flow</span></ChoiceCard>
                <ChoiceCard selected={draft.stakeCustody === "wallet"} onClick={() => update("stakeCustody", "wallet")} tag="NON-CUSTODIAL" title="Wallet lock" copy="The NFT stays in the holder's wallet while the collection records its locked state."><span className="mini-detail">Requires transfer-lock integration in the NFT contract</span></ChoiceCard>
              </div>}
            </div>

            <div className="staking-route-card">
              <div><span>ON-CHAIN STAKING ROUTE</span><b>{draft.stakeVaultMode === "shared" ? "Shared MintForge contract" : "Creator-owned contract"} · {draft.soulbound || draft.stakeCustody === "wallet" ? "Wallet lock" : "Vault custody"}</b></div>
              <div className="staking-flow">
                <span>Holder wallet</span><i>→</i><span>{draft.soulbound || draft.stakeCustody === "wallet" ? "Lock registered" : "NFT vault"}</span><i>→</i><span>Rewards accrue</span><i>→</i><span>{draft.soulbound || draft.stakeCustody === "wallet" ? "Unlock" : "NFT returned"}</span>
              </div>
              <p>{draft.soulbound || draft.stakeCustody === "wallet" ? "No NFT transfer occurs. The collection contract must prevent transfers while the staking lock is active." : "The holder approves only the published staking contract. On unstake, that contract returns the same token ID to the recorded depositor."}</p>
              <small>Contract address will be displayed before approval · Reward pool isolated to this collection · No administrator custody</small>
            </div>

            <div className="staking-section-title reward-title"><span>REWARD ECONOMICS</span><b>Configure the earning rules</b></div>
            <div className="segmented small"><button className={draft.stakeRewardType === "native" ? "active" : ""} onClick={() => update("stakeRewardType", "native")}>Native reward</button><button className={draft.stakeRewardType === "erc20" ? "active" : ""} onClick={() => update("stakeRewardType", "erc20")}>ERC-20 reward</button></div>
            <div className="form-fields compact">
              {draft.stakeRewardType === "erc20" && <label className="field wide"><span>REWARD TOKEN ADDRESS</span><input value={draft.rewardToken} onChange={(e) => update("rewardToken", e.target.value)} placeholder="0x token contract" /></label>}
              <label className="field"><span>REWARD PER NFT / DAY</span><input type="number" min="0" value={draft.rewardRate} onChange={(e) => update("rewardRate", e.target.value)} /></label>
              <label className="field"><span>MINIMUM LOCK — DAYS</span><input type="number" min="0" value={draft.minimumLock} onChange={(e) => update("minimumLock", e.target.value)} /></label>
              <label className="field"><span>EARLY EXIT PENALTY</span><div className="suffix-input"><input type="number" min="0" max="100" value={draft.exitPenalty} onChange={(e) => update("exitPenalty", e.target.value)} /><span>%</span></div></label>
            </div>
          </div>}
        </section>

        <section className={draft.burningEnabled ? "utility-card enabled" : "utility-card"}>
          <div className="utility-head"><span className="utility-index">02</span><div><span>BURNING MODULE</span><h2>Trade scarcity for value</h2><p>Burn NFTs permanently to redeem, evolve or unlock something new.</p></div><Toggle checked={draft.burningEnabled} onChange={(v) => update("burningEnabled", v)} label="Burning module" /></div>
          {draft.burningEnabled && <div className="utility-body">
            <div className="choice-grid three tight">
              <ChoiceCard selected={draft.burnOutcome === "redeem"} onClick={() => update("burnOutcome", "redeem")} title="Redeem" copy="Claim a token or physical benefit." />
              <ChoiceCard selected={draft.burnOutcome === "evolve"} onClick={() => update("burnOutcome", "evolve")} title="Evolve" copy="Mint a new upgraded NFT." />
              <ChoiceCard selected={draft.burnOutcome === "access"} onClick={() => update("burnOutcome", "access")} title="Unlock" copy="Open gated content or access." />
            </div>
            <div className="form-fields compact top-gap"><label className="field"><span>NFTS REQUIRED</span><input type="number" min="1" value={draft.burnQuantity} onChange={(e) => update("burnQuantity", e.target.value)} /></label><label className="field"><span>{draft.burnOutcome === "evolve" ? "NEW TOKEN / COLLECTION" : "REWARD OR DESTINATION"}</span><input value={draft.burnReward} onChange={(e) => update("burnReward", e.target.value)} placeholder="Contract, token ID or description" /></label></div>
          </div>}
        </section>

        <section className="utility-card enabled">
          <div className="utility-head"><span className="utility-index">03</span><div><span>OWNERSHIP RULES</span><h2>Control access and transfer</h2><p>Choose the safeguards that match the purpose of your NFT.</p></div></div>
          <div className="utility-body toggle-list grid">
            <div><div><b>Unlockable content</b><p>Private files or links for current holders.</p></div><Toggle checked={draft.unlockableEnabled} onChange={(v) => update("unlockableEnabled", v)} label="Unlockable content" /></div>
            <div><div><b>Soulbound token</b><p>Make the NFT permanently non-transferable.</p></div><Toggle checked={draft.soulbound} onChange={(v) => setDraft((current) => ({ ...current, soulbound: v, stakeCustody: v ? "wallet" : current.stakeCustody }))} label="Soulbound token" /></div>
            <div><div><b>Emergency pause</b><p>Allow the owner to pause minting and transfers.</p></div><Toggle checked={draft.pausable} onChange={(v) => update("pausable", v)} label="Emergency pause" /></div>
            <div><div><b>Freeze metadata</b><p>Permanently lock metadata after final reveal.</p></div><Toggle checked={draft.freezeMetadata} onChange={(v) => update("freezeMetadata", v)} label="Freeze metadata" /></div>
          </div>
        </section>
      </div>
    );
  }

  function renderReview() {
    const modules = [draft.stakingEnabled && "Staking", draft.burningEnabled && "Burning", draft.unlockableEnabled && "Unlockables", draft.soulbound && "Soulbound"].filter(Boolean);
    return (
      <div className="review-layout">
        <section className="review-main">
          <div className="review-hero">
            <div className="review-art">{artwork?.kind === "image" ? <img src={artwork.url} alt="" /> : <span>{artwork?.extension.slice(0, 4) || "MF"}</span>}</div>
            <div><span>READY FOR CONTRACT DESIGN</span><h2>{draft.name || "Untitled NFT"}</h2><p>{draft.collectionName} · {selectedChain.name}</p><div className="review-badges"><b>{draft.standard}</b><b>{draft.collectionMode === "owned" ? "Creator-owned" : "Shared contract"}</b><b>{draft.mintType === "unique" ? "1 / 1" : draft.mintType + " edition"}</b></div></div>
          </div>
          <div className="review-grid">
            <div className="review-card"><span>DROP</span><dl><div><dt>Supply</dt><dd>{draft.mintType === "open" ? "Open" : draft.supply}</dd></div><div><dt>Price</dt><dd>{draft.price} {selectedChain.native}</dd></div><div><dt>Per wallet</dt><dd>{draft.maxPerWallet}</dd></div><div><dt>Access</dt><dd>{draft.allowlist ? "Allowlist + public" : "Public"}</dd></div></dl><button onClick={() => goToStep(2)}>Edit mint settings</button></div>
            <div className="review-card"><span>REVENUE</span><dl><div><dt>Royalty</dt><dd>{draft.royaltyEnabled ? draft.royaltyPercent + "%" : "Off"}</dd></div><div><dt>Primary split</dt><dd>{draft.primarySplitEnabled ? "2 wallets" : "Creator only"}</dd></div><div><dt>Platform fee</dt><dd>1.5%</dd></div><div><dt>Standard</dt><dd>ERC-2981</dd></div></dl><button onClick={() => goToStep(3)}>Edit revenue</button></div>
            <div className="review-card"><span>UTILITY</span><dl><div><dt>Modules</dt><dd>{modules.length ? modules.join(", ") : "None"}</dd></div>{draft.stakingEnabled && <><div><dt>Staking contract</dt><dd>{draft.stakeVaultMode === "shared" ? "Shared MintForge" : "Creator-owned"}</dd></div><div><dt>NFT custody</dt><dd>{draft.soulbound || draft.stakeCustody === "wallet" ? "Wallet lock" : "Vault contract"}</dd></div><div><dt>Reward pool</dt><dd>Collection-isolated</dd></div></>}<div><dt>Emergency pause</dt><dd>{draft.pausable ? "Enabled" : "Off"}</dd></div><div><dt>Metadata freeze</dt><dd>{draft.freezeMetadata ? "Enabled" : "Off"}</dd></div><div><dt>Transferable</dt><dd>{draft.soulbound ? "No" : "Yes"}</dd></div></dl><button onClick={() => goToStep(4)}>Edit utility</button></div>
            <div className="review-card"><span>STORAGE</span><dl><div><dt>Original payload</dt><dd>{artwork ? artwork.extension : "Needed"}</dd></div><div><dt>File category</dt><dd>{artwork ? artwork.kind : "—"}</dd></div><div><dt>Metadata</dt><dd>IPFS</dd></div><div><dt>Network</dt><dd>{selectedChain.name}</dd></div></dl><button onClick={() => goToStep(0)}>Edit asset</button></div>
          </div>
        </section>
        <aside className="launch-panel">
          <span className="rail-label">NEXT PHASE</span>
          <h3>Contract build package</h3>
          <p>Your choices will become a versioned specification for smart-contract implementation and testing.</p>
          <ol><li><b>01</b><span>Generate contract architecture</span><i>Next</i></li><li><b>02</b><span>Security tests and review</span></li><li><b>03</b><span>Testnet deployment</span></li><li><b>04</b><span>Mainnet launch</span></li></ol>
          <button className="launch-button" onClick={() => setReviewModal(true)}>Prepare contract phase <span>→</span></button>
          <small>No blockchain transaction will occur.</small>
        </aside>
      </div>
    );
  }

  return (
    <main className={"app-shell mode-" + mode}>
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Mint Forge home"><span className="brand-mark"><i /><i /><i /></span><span>MINT<span>FORGE</span></span><small>WEB3 STUDIO</small></a>
        {mode === "create" ? <>
          <div className="project-status"><div className="status-line"><span>New drop</span><b>{progress}% complete</b></div><div className="progress-track"><span style={{ width: progress + "%" }} /></div></div>
          <nav className="step-nav" aria-label="Creation steps">
            {steps.map(([number, label], index) => <button key={label} className={activeStep === index ? "step active" : "step"} onClick={() => goToStep(index)}><span>{number}</span><strong>{label}</strong>{index < activeStep ? <em>✓</em> : <i />}</button>)}
          </nav>
        </> : mode === "viewer" ? <>
          <div className="viewer-side-intro"><span>WALLET GALLERY</span><strong>Your NFTs.<br />In focus.</strong><p>Automatically discover owned NFTs on the selected network.</p></div>
          <nav className="viewer-side-list" aria-label="Viewer capabilities">
            <div><span>01</span><b>Wallet gallery</b><i>●</i></div>
            <div><span>02</span><b>Grid + list views</b><i>●</i></div>
            <div><span>03</span><b>Full-screen media</b><i>●</i></div>
          </nav>
          <div className="viewer-side-formats"><span>MEDIA ENGINE</span><div><b>IMG</b><b>VID</b><b>AUD</b><b>3D</b><b>WEB</b><b>SVG</b></div></div>
        </> : <>
          <div className="stake-side-intro"><span>HOLDER REWARDS</span><strong>Stake.<br />Earn. Repeat.</strong><p>Manage eligible NFTs and every active reward position.</p></div>
          <nav className="stake-side-list" aria-label="Staking workflow">
            <div><span>01</span><b>Select NFTs</b><i>●</i></div>
            <div><span>02</span><b>Choose terms</b><i>●</i></div>
            <div><span>03</span><b>Claim + unstake</b><i>●</i></div>
          </nav>
          <div className="stake-side-contract"><span>CONTRACT ROUTE</span><div><b>WALLET</b><i>→</i><b>VAULT</b><i>→</i><b>REWARD</b></div></div>
        </>}
        <div className="phase-note"><span>{mode === "create" ? "PROTOCOL STATUS" : mode === "viewer" ? "READ-ONLY VIEWER" : "STAKING STATUS"}</span><p>{mode === "create" ? "Creator interface online · contracts coming next." : mode === "viewer" ? "No wallet or blockchain approval required." : "Holder interface online · staking contracts coming next."}</p></div>
        <button className="help-button">Documentation <span>↗</span></button>
      </aside>

      <section className="workspace" id="top">
        <header className="topbar">
          <div><span className="eyebrow">{mode === "create" ? "MULTICHAIN CREATION TERMINAL" : mode === "viewer" ? "UNIVERSAL NFT VIEWER" : "NFT STAKING TERMINAL"}</span><span className="autosave"><i /> {mode === "create" ? savedAt : mode === "viewer" ? "Read-only mode" : "Interface mode"}</span></div>
          <div className="studio-mode-switch" role="tablist" aria-label="Studio mode">
            <button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => switchMode("create")}>Create NFT</button>
            <button type="button" role="tab" aria-selected={mode === "viewer"} className={mode === "viewer" ? "active" : ""} onClick={() => switchMode("viewer")}>View NFT</button>
            <button type="button" role="tab" aria-selected={mode === "stake"} className={mode === "stake" ? "active" : ""} onClick={() => switchMode("stake")}>Stake NFTs</button>
          </div>
          <div className="wallet-controls">
            <div className="chain-picker">
              <button className="chain-button" onClick={() => setChainOpen(!chainOpen)} aria-expanded={chainOpen}><span style={{ background: selectedChain.colour }}>{selectedChain.mark}</span>{selectedChain.name}<b>⌄</b></button>
              {chainOpen && <div className="chain-menu"><small>{mode === "create" ? "LAUNCH NETWORK" : mode === "viewer" ? "VIEW NETWORK" : "STAKING NETWORK"}</small>{chains.map((chain) => <button key={chain.id} onClick={() => chooseChain(chain)}><span style={{ background: chain.colour }}>{chain.mark}</span>{chain.name}{chain.id === selectedChain.id && <b>✓</b>}</button>)}</div>}
            </div>
            <button className={wallet ? "wallet-button connected" : "wallet-button"} onClick={connectWallet}><span>{wallet ? "●" : "◌"}</span>{wallet ? shortWallet : "Connect wallet"}</button>
          </div>
        </header>

        <div className="page-wrap">
          {mode === "viewer" ? <NftViewer chain={selectedChain} wallet={wallet} onConnectWallet={connectWallet} /> : mode === "stake" ? <NftStaking chain={selectedChain} wallet={wallet} onConnectWallet={connectWallet} /> : <>
            <div className="page-heading">
              <div><span className="section-number">{headings[activeStep].number}</span><h1>{headings[activeStep].title}</h1><p>{headings[activeStep].copy}</p></div>
              {activeStep === 0 && <div className="supported-formats"><span>UNIVERSAL FILE SUPPORT</span><div><b>IMAGE</b><b>VIDEO</b><b>AUDIO</b><b>3D</b><b>DOC</b><b>CODE</b><b>+</b></div></div>}
              {activeStep > 0 && activeStep < 5 && <div className="step-context"><span>CONFIGURING</span><b>{draft.name || "Untitled NFT"}</b><small>{selectedChain.name}</small></div>}
            </div>
            {notice && <div className="notice" role="status"><span>i</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

            {activeStep === 0 && renderArtwork()}
            {activeStep === 1 && renderCollection()}
            {activeStep === 2 && renderMint()}
            {activeStep === 3 && renderRevenue()}
            {activeStep === 4 && renderUtility()}
            {activeStep === 5 && renderReview()}

            <footer className="page-actions">
              {activeStep > 0 ? <button className="secondary-action" onClick={() => goToStep(activeStep - 1)}>← Back</button> : <button className="secondary-action" onClick={saveDraft}>Save draft</button>}
              <span>{activeStep === 5 ? "Review your blueprint before the contract phase." : "Your progress is stored on this device."}</span>
              {activeStep < 5 && <button className="primary-action" onClick={() => goToStep(activeStep + 1)}>Continue to {steps[activeStep + 1][1].toLowerCase()} <span>→</span></button>}
            </footer>
          </>}
        </div>
      </section>

      {mode === "create" && reviewModal && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={() => setReviewModal(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setReviewModal(false)} aria-label="Close">×</button>
          <span className="modal-mark">✓</span>
          <span>INTERFACE BLUEPRINT COMPLETE</span>
          <h2 id="modal-title">Ready for the contract phase.</h2>
          <p>The creator flow is fully configured. Next we’ll convert these choices into audited, multichain smart contracts—starting on a test network.</p>
          <div><b>{selectedChain.name}</b><b>{draft.standard}</b><b>{draft.collectionMode === "owned" ? "Creator-owned" : "Shared"}</b></div>
          <button onClick={() => setReviewModal(false)}>Return to blueprint</button>
        </div>
      </div>}
    </main>
  );
}
