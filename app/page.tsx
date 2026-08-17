"use client";

import { ChangeEvent, createElement, DragEvent, HTMLAttributes, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import NftViewer from "./NftViewer";
import NftStaking from "./NftStaking";
import CreatorDashboard from "./CreatorDashboard";
import Marketplace from "./Marketplace";
import LegalGate from "./LegalGate";

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
type CollectionItem = { id: string; name: string; size: string; url: string; file: File; kind: FileKind; traits: { id: string; trait_type: string; value: string }[] };

type Draft = {
  itemMode: "single" | "collection";
  traits: { id: string; trait_type: string; value: string }[];
  name: string;
  description: string;
  externalUrl: string;
  collectionMode: "shared" | "owned";
  collectionName: string;
  symbol: string;
  standard: "ERC-721" | "ERC-1155";
  collectionDescription: string;
  category: string;
  socialTwitter: string;
  socialDiscord: string;
  socialWebsite: string;
  socialTelegram: string;
  socialFacebook: string;
  existingContractAddress: string;
  mintType: "unique" | "fixed" | "open";
  supply: string;
  price: string;
  maxPerWallet: string;
  saleTiming: "now" | "scheduled";
  saleStart: string;
  saleEnd: string;
  allowlist: boolean;
  allowlistAddresses: string;
  allowlistPrice: string;
  allowlistPerWallet: string;
  delayedReveal: boolean;
  revealMode: "manual" | "scheduled";
  revealDate: string;
  royaltyEnabled: boolean;
  royaltyPercent: number;
  royaltyReceiver: string;
  primarySplitEnabled: boolean;
  collaborators: { id: string; address: string; percent: number }[];
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
  itemMode: "single",
  traits: [],
  name: "",
  description: "",
  externalUrl: "",
  collectionMode: "shared",
  collectionName: "Untitled Collection",
  symbol: "",
  standard: "ERC-721",
  collectionDescription: "",
  category: "art",
  socialTwitter: "",
  socialDiscord: "",
  socialWebsite: "",
  socialTelegram: "",
  socialFacebook: "",
  existingContractAddress: "",
  mintType: "unique",
  supply: "1",
  price: "0.10",
  maxPerWallet: "1",
  saleTiming: "now",
  saleStart: "",
  saleEnd: "",
  allowlist: false,
  allowlistAddresses: "",
  allowlistPrice: "",
  allowlistPerWallet: "",
  delayedReveal: false,
  revealMode: "manual",
  revealDate: "",
  royaltyEnabled: true,
  royaltyPercent: 5,
  royaltyReceiver: "",
  primarySplitEnabled: false,
  collaborators: [{ id: "c1", address: "", percent: 20 }],
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

// ── MOCK DATA — placeholder only, replace with real chain queries in the contracts phase ──
const MOCK_TAKEN_SYMBOLS = ["PUNK", "APE", "BAYC", "FORGE"];
const MOCK_EXISTING_CONTRACTS = [
  { address: "0x2f4A...9cB1", name: "Genesis Collectibles", standard: "ERC-721", verified: true },
  { address: "0x88Ee...1a04", name: "Sunset Editions", standard: "ERC-1155", verified: true },
  { address: "0x0c7D...ff3E", name: "Untitled Drop", standard: "ERC-721", verified: false },
];
const MOCK_GAS_ESTIMATE = { native: "0.018", usd: "54.20" };
const CATEGORIES = ["art", "photography", "music", "video", "gaming", "pfp", "utility", "other"];
// ──────────────────────────────────────────────────────────────────────────────────────────

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
  const [mode, setMode] = useState<"create" | "viewer" | "stake" | "dashboard" | "market">("create");
  const [tosAccepted, setTosAccepted] = useState(false);
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
  const [banner, setBanner] = useState<UploadedArtwork | null>(null);
  const [collectionItems, setCollectionItems] = useState<CollectionItem[]>([]);
  const collectionFileRef = useRef<HTMLInputElement>(null);
  const [csvSummary, setCsvSummary] = useState<string | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const [itemPage, setItemPage] = useState(0);
  const ITEMS_PER_PAGE = 25;
  const [revealPlaceholder, setRevealPlaceholder] = useState<UploadedArtwork | null>(null);
  const revealPlaceholderRef = useRef<HTMLInputElement>(null);
  const [symbolCheck, setSymbolCheck] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const bannerRef = useRef<HTMLInputElement>(null);
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

  function addTrait() {
    update("traits", [...draft.traits, { id: Math.random().toString(36).slice(2), trait_type: "", value: "" }]);
  }
  function updateTrait(id: string, field: "trait_type" | "value", value: string) {
    update("traits", draft.traits.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }
  function removeTrait(id: string) {
    update("traits", draft.traits.filter((t) => t.id !== id));
  }

  function addCollaborator() {
    setDraft((current) => {
      const total = current.collaborators.reduce((sum, c) => sum + c.percent, 0);
      const remaining = Math.max(1, 99 - total);
      return { ...current, collaborators: [...current.collaborators, { id: Math.random().toString(36).slice(2), address: "", percent: Math.min(10, remaining) }] };
    });
  }
  function updateCollaboratorAddress(id: string, address: string) {
    setDraft((current) => ({ ...current, collaborators: current.collaborators.map((c) => c.id === id ? { ...c, address } : c) }));
  }
  function updateCollaboratorPercent(id: string, value: number) {
    setDraft((current) => {
      const others = current.collaborators.filter((c) => c.id !== id).reduce((sum, c) => sum + c.percent, 0);
      const maxAllowed = Math.max(1, 99 - others);
      const clamped = Math.min(maxAllowed, Math.max(1, value));
      return { ...current, collaborators: current.collaborators.map((c) => c.id === id ? { ...c, percent: clamped } : c) };
    });
  }
  function removeCollaborator(id: string) {
    update("collaborators", draft.collaborators.filter((c) => c.id !== id));
  }
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

  useEffect(() => {
    if (!draft.symbol) { setSymbolCheck("idle"); return; }
    setSymbolCheck("checking");
    // MOCK — replace with a real on-chain / indexer lookup once contracts are live
    const timer = window.setTimeout(() => {
      setSymbolCheck(MOCK_TAKEN_SYMBOLS.includes(draft.symbol) ? "taken" : "available");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft.symbol]);

  function parseAllowlist(text: string) {
    const lines = text.split(/[\n,]/).map((line) => line.trim()).filter(Boolean);
    const valid = lines.filter((line) => /^0x[a-fA-F0-9]{40}$/.test(line));
    return { total: lines.length, valid: valid.length, invalid: lines.length - valid.length };
  }

  function acceptRevealPlaceholder(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setNotice("Reveal placeholder must be an image file."); return; }
    if (revealPlaceholder?.url) URL.revokeObjectURL(revealPlaceholder.url);
    setRevealPlaceholder({ name: file.name, size: formatFileSize(file.size), type: file.type, extension: file.name.split(".").pop()?.toUpperCase() || "FILE", kind: "image", url: URL.createObjectURL(file), previewText: null });
  }

  function acceptCsvTraits(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const rows = text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
      if (rows.length < 2) { setCsvSummary("CSV needs a header row plus at least one data row."); return; }
      const [header, ...dataRows] = rows;
      const traitHeaders = header.slice(1);
      const traitsByFilename = new Map<string, { id: string; trait_type: string; value: string }[]>();
      dataRows.forEach((row) => {
        const filename = row[0]?.trim().toLowerCase();
        if (!filename) return;
        const traits = traitHeaders.map((label, i) => ({ id: Math.random().toString(36).slice(2), trait_type: label, value: (row[i + 1] || "").trim() })).filter((t) => t.value);
        traitsByFilename.set(filename, traits);
      });
      setCollectionItems((items) => items.map((item) => {
        const traits = traitsByFilename.get(item.name.toLowerCase());
        return traits ? { ...item, traits } : item;
      }));
      const matchedCount = collectionItems.filter((item) => traitsByFilename.has(item.name.toLowerCase())).length;
      setCsvSummary(`Matched ${matchedCount} of ${dataRows.length} row${dataRows.length === 1 ? "" : "s"} to uploaded files by filename.`);
    };
    reader.readAsText(file);
  }

  function downloadCsvTemplate() {
    const header = "filename,Background,Eyes,Rarity";
    const rows = collectionItems.map((item) => `${item.name},,,`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mintforge-traits-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  
  async function acceptMetadataFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).filter((file) => file.name.toLowerCase().endsWith(".json"));
    const traitsByBaseName = new Map<string, { id: string; trait_type: string; value: string }[]>();
    let parseErrors = 0;
    await Promise.all(files.map(async (file) => {
      try {
        const data = JSON.parse(await file.text());
        const attributes = Array.isArray(data.attributes) ? data.attributes : [];
        const traits = attributes
          .filter((a: { trait_type?: string; traitType?: string; value?: unknown }) => a && (a.trait_type || a.traitType) && a.value !== undefined && a.value !== null)
          .map((a: { trait_type?: string; traitType?: string; value?: unknown }) => ({ id: Math.random().toString(36).slice(2), trait_type: String(a.trait_type ?? a.traitType), value: String(a.value) }));
        traitsByBaseName.set(file.name.replace(/\.json$/i, "").toLowerCase(), traits);
      } catch {
        parseErrors += 1;
      }
    }));
    setCollectionItems((items) => items.map((item) => {
      const traits = traitsByBaseName.get(item.name.replace(/\.[^.]+$/, "").toLowerCase());
      return traits ? { ...item, traits } : item;
    }));
    const matchedCount = collectionItems.filter((item) => traitsByBaseName.has(item.name.replace(/\.[^.]+$/, "").toLowerCase())).length;
    setCsvSummary(`Matched ${matchedCount} of ${files.length} metadata file${files.length === 1 ? "" : "s"} to uploaded images by filename.${parseErrors ? ` ${parseErrors} file${parseErrors === 1 ? "" : "s"} could not be read as JSON.` : ""}`);
  }

  function generateThumbnail(file: File, maxSize = 96): Promise<string> {
    return new Promise((resolve) => {
      if (!file.type.startsWith("image/")) { resolve(""); return; }
      const rawUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(rawUrl); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(rawUrl);
        canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ""), "image/jpeg", 0.75);
      };
      img.onerror = () => { URL.revokeObjectURL(rawUrl); resolve(""); };
      img.src = rawUrl;
    });
  }

  async function acceptCollectionFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList);
    const newItems: CollectionItem[] = await Promise.all(files.map(async (file) => ({
      id: Math.random().toString(36).slice(2),
      name: file.name,
      size: formatFileSize(file.size),
      url: await generateThumbnail(file),
      file,
      kind: detectFileKind(file),
      traits: [],
    })));
    setCollectionItems((items) => [...items, ...newItems]);
  }
  function removeCollectionItem(itemId: string) {
    setCollectionItems((items) => {
      const target = items.find((item) => item.id === itemId);
      if (target?.url) URL.revokeObjectURL(target.url);
      return items.filter((item) => item.id !== itemId);
    });
  }
  function addItemTrait(itemId: string) {
    setCollectionItems((items) => items.map((item) => item.id === itemId ? { ...item, traits: [...item.traits, { id: Math.random().toString(36).slice(2), trait_type: "", value: "" }] } : item));
  }
  function updateItemTrait(itemId: string, traitId: string, field: "trait_type" | "value", value: string) {
    setCollectionItems((items) => items.map((item) => item.id === itemId ? { ...item, traits: item.traits.map((t) => t.id === traitId ? { ...t, [field]: value } : t) } : item));
  }
  function removeItemTrait(itemId: string, traitId: string) {
    setCollectionItems((items) => items.map((item) => item.id === itemId ? { ...item, traits: item.traits.filter((t) => t.id !== traitId) } : item));
  }

  function acceptBanner(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setNotice("Collection banner must be an image file."); return; }
    if (banner?.url) URL.revokeObjectURL(banner.url);
    setBanner({ name: file.name, size: formatFileSize(file.size), type: file.type, extension: file.name.split(".").pop()?.toUpperCase() || "FILE", kind: "image", url: URL.createObjectURL(file), previewText: null });
  }

  function importExistingContract(address: string) {
    const match = MOCK_EXISTING_CONTRACTS.find((c) => c.address === address);
    if (!match) return;
    setDraft((current) => ({ ...current, existingContractAddress: address, collectionName: match.name, standard: match.standard as Draft["standard"] }));
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

  function switchMode(nextMode: "create" | "viewer" | "stake" | "dashboard" | "market") {
    setMode(nextMode);
    setChainOpen(false);
    setNotice("");
    window.scrollTo(0, 0);
  }

  function renderArtwork() {
    return (
      <div className="creation-grid">
        <section className="form-panel">
          <div className="mode-toggle-card">
            <div className="segmented"><button className={draft.itemMode === "single" ? "active" : ""} onClick={() => update("itemMode", "single")}>Single item</button><button className={draft.itemMode === "collection" ? "active" : ""} onClick={() => update("itemMode", "collection")}>Collection (multiple items)</button></div>
            {draft.itemMode === "collection" && <p className="field-hint">CSV trait import and generative layering with rarity weighting are coming in a future build. For now, add traits to each item manually below.</p>}
          </div>
          {draft.itemMode === "single" ? (
            <>
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
              <div className="settings-card traits-card">
                <div className="card-heading"><div><span>PROPERTIES</span><h2>Traits &amp; attributes</h2><p className="field-hint">Power rarity, filtering and search on marketplaces.</p></div></div>
                {draft.traits.map((trait) => (
                  <div className="trait-row" key={trait.id}>
                    <input value={trait.trait_type} onChange={(e) => updateTrait(trait.id, "trait_type", e.target.value)} placeholder="Trait type (e.g. Background)" />
                    <input value={trait.value} onChange={(e) => updateTrait(trait.id, "value", e.target.value)} placeholder="Value (e.g. Blue)" />
                    <button type="button" className="trait-remove" onClick={() => removeTrait(trait.id)} aria-label="Remove trait">✕</button>
                  </div>
                ))}
                <button type="button" className="add-trait-button" onClick={addTrait}>+ Add trait</button>
              </div>
            </>
          ) : (
            <>
              <div className="upload-zone" onClick={() => collectionFileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") collectionFileRef.current?.click(); }}>
                <input ref={collectionFileRef} type="file" multiple onChange={(e) => acceptCollectionFiles(e.target.files)} hidden />
                <div className="upload-symbol"><span>↑</span></div>
                <span className="file-kicker">BATCH UPLOAD</span>
                <h2>Select every file in your collection</h2>
                <p>{collectionItems.length ? `${collectionItems.length} item${collectionItems.length === 1 ? "" : "s"} added` : "Images, video, audio, 3D, PDFs and more · one file per NFT"}</p>
                <button type="button">{collectionItems.length ? "Add more files" : "Choose files"}</button>
              </div>
              {collectionItems.length > 0 && (
                <div className="csv-import-row" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="secondary-action" onClick={downloadCsvTemplate}>Download CSV template</button>
                  <button type="button" className="secondary-action" onClick={() => csvFileRef.current?.click()}>Import trait CSV</button>
                  <button type="button" className="secondary-action" onClick={() => jsonFileRef.current?.click()}>Import metadata JSON</button>
                  <input ref={csvFileRef} type="file" accept=".csv,text/csv" onChange={(e) => acceptCsvTraits(e.target.files?.[0])} hidden />
                  <input ref={jsonFileRef} type="file" accept=".json,application/json" multiple onChange={(e) => acceptMetadataFiles(e.target.files)} hidden />
                </div>
              )}
              {csvSummary && <p className="field-hint">{csvSummary}</p>}
              {collectionItems.length > 0 && (() => {
                const totalPages = Math.max(1, Math.ceil(collectionItems.length / ITEMS_PER_PAGE));
                const safePage = Math.min(itemPage, totalPages - 1);
                const pageStart = safePage * ITEMS_PER_PAGE;
                const pagedItems = collectionItems.slice(pageStart, pageStart + ITEMS_PER_PAGE);
                return (
                  <>
                    {totalPages > 1 && (
                      <div className="pagination-row">
                        <span>Showing {pageStart + 1}–{Math.min(pageStart + ITEMS_PER_PAGE, collectionItems.length)} of {collectionItems.length}</span>
                        <div>
                          <button type="button" className="secondary-action" disabled={safePage === 0} onClick={() => setItemPage(safePage - 1)}>← Prev</button>
                          <button type="button" className="secondary-action" disabled={safePage >= totalPages - 1} onClick={() => setItemPage(safePage + 1)}>Next →</button>
                        </div>
                      </div>
                    )}
                    <div className="collection-item-list">
                      {pagedItems.map((item, localIndex) => (
                        <div className="collection-item-card" key={item.id}>
                          <div className="collection-item-head">
                            {item.url ? <img src={item.url} alt={item.name} /> : <div className="collection-item-fallback">{item.name.split(".").pop()?.toUpperCase()}</div>}
                            <div><span className="collection-item-index">#{pageStart + localIndex + 1}</span><b>{item.name}</b><small>{item.size}</small></div>
                            <button type="button" className="trait-remove" onClick={() => removeCollectionItem(item.id)} aria-label="Remove item">✕</button>
                          </div>
                          <div className="collection-item-traits">
                            {item.traits.map((trait) => (
                              <div className="trait-row" key={trait.id}>
                                <input value={trait.trait_type} onChange={(e) => updateItemTrait(item.id, trait.id, "trait_type", e.target.value)} placeholder="Trait type" />
                                <input value={trait.value} onChange={(e) => updateItemTrait(item.id, trait.id, "value", e.target.value)} placeholder="Value" />
                                <button type="button" className="trait-remove" onClick={() => removeItemTrait(item.id, trait.id)} aria-label="Remove trait">✕</button>
                              </div>
                            ))}
                            <button type="button" className="add-trait-button" onClick={() => addItemTrait(item.id)}>+ Add trait</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="pagination-row">
                        <span>Showing {pageStart + 1}–{Math.min(pageStart + ITEMS_PER_PAGE, collectionItems.length)} of {collectionItems.length}</span>
                        <div>
                          <button type="button" className="secondary-action" disabled={safePage === 0} onClick={() => setItemPage(safePage - 1)}>← Prev</button>
                          <button type="button" className="secondary-action" disabled={safePage >= totalPages - 1} onClick={() => setItemPage(safePage + 1)}>Next →</button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </section>
        <aside className="preview-column">
          <div className="preview-label"><span>LIVE PREVIEW</span><b>{selectedChain.name}</b></div>
          {draft.itemMode === "single" ? (
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
          ) : (
            <article className="nft-card collection-preview-card">
              <div className="collection-preview-grid">
                {collectionItems.slice(0, 9).map((item) => (
                  <div className="collection-preview-cell" key={item.id}>
                    {item.url ? <img src={item.url} alt={item.name} /> : <div className="collection-item-fallback">{item.name.split(".").pop()?.toUpperCase()}</div>}
                  </div>
                ))}
                {collectionItems.length === 0 && <div className="empty-preview"><span>YOUR<br />COLLECTION</span><i /></div>}
                {collectionItems.length > 9 && <div className="collection-preview-more">+{collectionItems.length - 9}</div>}
                <span className="chain-chip" style={{ background: selectedChain.colour }}>{selectedChain.mark}</span>
              </div>
              <div className="card-copy">
                <span className="collection-name">{draft.collectionName.toUpperCase()} <b>◇</b></span>
                <h3>{collectionItems.length} item{collectionItems.length === 1 ? "" : "s"} in this drop</h3>
                <div className="card-bottom"><span>STANDARD <b>{draft.standard}</b></span><span>CREATOR <b>{wallet ? shortWallet : "Not connected"}</b></span></div>
              </div>
            </article>
          )}
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

          {draft.collectionMode === "owned" && (
            <div className="settings-card">
              <div className="card-heading"><div><span>EXISTING CONTRACTS</span><h2>Use a contract you already deployed</h2></div><span className="card-index">✓</span></div>
              <div className="choice-grid two tight">
                {MOCK_EXISTING_CONTRACTS.map((c) => (
                  <ChoiceCard key={c.address} selected={draft.existingContractAddress === c.address} onClick={() => importExistingContract(c.address)} title={c.name} copy={`${c.address} · ${c.standard}`}>
                    <span className="mini-detail">{c.verified ? "✓ Verified on explorer" : "Not yet verified"}</span>
                  </ChoiceCard>
                ))}
              </div>
              <p className="field-hint">Sample data — real wallet-connected contracts will appear here once chain integration is live.</p>
            </div>
          )}

          <div className="settings-card">
            <div className="card-heading"><div><span>COLLECTION BRANDING</span><h2>Banner &amp; category</h2></div><span className="card-index">◇</span></div>
            <div className="banner-upload" onClick={() => bannerRef.current?.click()}>
              <input ref={bannerRef} type="file" accept="image/*" onChange={(e) => acceptBanner(e.target.files?.[0])} hidden />
              {banner ? <img src={banner.url} alt="Collection banner" /> : <div className="banner-empty"><span>↑</span><p>Upload a collection banner<br />Recommended 1500×500</p></div>}
            </div>
            <div className="form-fields compact top-gap">
              <label className="field wide"><span>CATEGORY</span>
                <select value={draft.category} onChange={(e) => update("category", e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="settings-card">
            <div className="card-heading"><div><span>COLLECTION IDENTITY</span><h2>Name the collection</h2></div><span className="card-index">A</span></div>
            <div className="form-fields compact">
              <label className="field"><span>COLLECTION NAME</span><input value={draft.collectionName} onChange={(e) => update("collectionName", e.target.value)} placeholder="Collection name" /></label>
              <label className="field">
                <span>SYMBOL</span>
                <input value={draft.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase().slice(0, 8))} placeholder="FORGE" />
                {symbolCheck === "checking" && <small className="symbol-status checking">Checking availability…</small>}
                {symbolCheck === "available" && <small className="symbol-status available">✓ Available</small>}
                {symbolCheck === "taken" && <small className="symbol-status taken">✕ Already in use — try another</small>}
              </label>
              <label className="field wide"><span>COLLECTION DESCRIPTION</span><textarea value={draft.collectionDescription} onChange={(e) => update("collectionDescription", e.target.value)} placeholder="What connects the work in this collection?" /></label>
            </div>
          </div>

          <div className="settings-card">
            <div className="card-heading"><div><span>SOCIAL LINKS</span><h2>Help collectors find you</h2></div><span className="card-index">◈</span></div>
            <div className="form-fields compact">
              <label className="field"><span>X / TWITTER</span><div className="input-prefix"><i>𝕏</i><input value={draft.socialTwitter} onChange={(e) => update("socialTwitter", e.target.value)} placeholder="yourhandle" /></div></label>
              <label className="field"><span>DISCORD</span><div className="input-prefix"><i>◐</i><input value={draft.socialDiscord} onChange={(e) => update("socialDiscord", e.target.value)} placeholder="discord.gg/invite" /></div></label>
              <label className="field"><span>TELEGRAM</span><div className="input-prefix"><i>✈</i><input value={draft.socialTelegram} onChange={(e) => update("socialTelegram", e.target.value)} placeholder="t.me/yourgroup" /></div></label>
              <label className="field"><span>FACEBOOK</span><div className="input-prefix"><i>f</i><input value={draft.socialFacebook} onChange={(e) => update("socialFacebook", e.target.value)} placeholder="facebook.com/yourpage" /></div></label>
              <label className="field wide"><span>WEBSITE</span><div className="input-prefix"><i>↗</i><input type="url" value={draft.socialWebsite} onChange={(e) => update("socialWebsite", e.target.value)} placeholder="https://yourproject.com" /></div></label>
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
            {draft.collectionMode === "owned" && !draft.existingContractAddress && (
              <div className="gas-estimate"><span>EST. DEPLOYMENT COST</span><b>{MOCK_GAS_ESTIMATE.native} {selectedChain.native} <i>≈ ${MOCK_GAS_ESTIMATE.usd}</i></b></div>
            )}
            {draft.existingContractAddress && (
              <div className="verify-badge">{MOCK_EXISTING_CONTRACTS.find((c) => c.address === draft.existingContractAddress)?.verified ? "✓ Verified contract" : "⚠ Unverified contract"}</div>
            )}
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
              {draft.allowlist && (() => {
                const stats = parseAllowlist(draft.allowlistAddresses);
                return (
                  <div className="sub-panel">
                    <label className="field wide"><span>ALLOWLISTED WALLETS</span><textarea value={draft.allowlistAddresses} onChange={(e) => update("allowlistAddresses", e.target.value)} placeholder={"0x1234...\n0xabcd...\nOne address per line, or comma-separated"} /></label>
                    {draft.allowlistAddresses.trim() && (
                      <p className="field-hint">{stats.valid} valid address{stats.valid === 1 ? "" : "es"}{stats.invalid > 0 ? ` · ${stats.invalid} line${stats.invalid === 1 ? "" : "s"} not recognized as a wallet address` : ""}</p>
                    )}
                    <div className="form-fields compact top-gap">
                      <label className="field"><span>ALLOWLIST PRICE</span><div className="input-prefix"><i>{selectedChain.native}</i><input type="number" min="0" step="0.01" value={draft.allowlistPrice} onChange={(e) => update("allowlistPrice", e.target.value)} placeholder={draft.price || "0.00"} /></div></label>
                      <label className="field"><span>ALLOWLIST MAX / WALLET</span><input type="number" min="1" value={draft.allowlistPerWallet} onChange={(e) => update("allowlistPerWallet", e.target.value)} placeholder={draft.maxPerWallet} /></label>
                    </div>
                  </div>
                );
              })()}
              <div><div><b>Delayed reveal</b><p>Show placeholder art until you reveal the collection.</p></div><Toggle checked={draft.delayedReveal} onChange={(v) => update("delayedReveal", v)} label="Delayed reveal" /></div>
              {draft.delayedReveal && (
                <div className="sub-panel">
                  <span className="field-label-standalone">PLACEHOLDER ARTWORK</span>
                  <div className="banner-upload reveal-upload" onClick={() => revealPlaceholderRef.current?.click()}>
                    <input ref={revealPlaceholderRef} type="file" accept="image/*" onChange={(e) => acceptRevealPlaceholder(e.target.files?.[0])} hidden />
                    {revealPlaceholder ? <img src={revealPlaceholder.url} alt="Reveal placeholder" /> : <div className="banner-empty"><span>↑</span><p>Upload placeholder art<br />Shown to collectors before reveal</p></div>}
                  </div>
                  <div className="segmented small top-gap"><button className={draft.revealMode === "manual" ? "active" : ""} onClick={() => update("revealMode", "manual")}>Manual reveal</button><button className={draft.revealMode === "scheduled" ? "active" : ""} onClick={() => update("revealMode", "scheduled")}>Scheduled reveal</button></div>
                  {draft.revealMode === "scheduled" && <label className="field top-gap"><span>REVEAL DATE &amp; TIME</span><input type="datetime-local" value={draft.revealDate} onChange={(e) => update("revealDate", e.target.value)} /></label>}
                  <p className="field-hint">{draft.revealMode === "manual" ? "You trigger the reveal manually from the Dashboard once minting ends." : "Metadata automatically reveals at the scheduled time."}</p>
                </div>
              )}
            </div>
          </div>
        </section>
        <aside className="summary-rail sticky-rail">
          <span className="rail-label">DROP SNAPSHOT</span>
          <div className="metric-card"><span>MINT PRICE</span><strong>{draft.price || "0"} <i>{selectedChain.native}</i></strong><p>{draft.price === "0" ? "Free mint" : "Per NFT, before gas"}</p></div>
          <div className="metric-grid"><div><span>SUPPLY</span><b>{draft.mintType === "open" ? "OPEN" : draft.supply}</b></div><div><span>PER WALLET</span><b>{draft.maxPerWallet}</b></div></div>
          <div className="timeline-card"><i /><div><span>SALE STATUS</span><b>{draft.saleTiming === "now" ? "Ready to open" : "Scheduled"}</b><p>{draft.allowlist ? `Allowlist enabled${draft.allowlistAddresses.trim() ? ` · ${parseAllowlist(draft.allowlistAddresses).valid} wallets` : ""}` : "Public mint"}</p></div></div>
        </aside>
      </div>
    );
  }

  function renderRevenue() {
    const totalCollabPercent = draft.collaborators.reduce((sum, c) => sum + c.percent, 0);
    const creatorPercent = 100 - totalCollabPercent;
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
            <div className="module-title"><div><span>PRIMARY SALE SPLIT</span><h2>Share the first sale</h2><p>Automatically split mint proceeds with one or more collaborators.</p></div><Toggle checked={draft.primarySplitEnabled} onChange={(v) => update("primarySplitEnabled", v)} label="Primary sale split" /></div>
            {draft.primarySplitEnabled && <div className="split-box">
              <div className="split-row"><span className="avatar">YOU</span><div><b>Creator wallet</b><p>{wallet ? shortWallet : "Connect wallet"}</p></div><strong>{creatorPercent}%</strong></div>
              {draft.collaborators.map((c, i) => (
                <div className="split-row" key={c.id}>
                  <span className="avatar alt">{String(i + 2).padStart(2, "0")}</span>
                  <div className="split-address"><b>Collaborator {i + 1}</b><input value={c.address} onChange={(e) => updateCollaboratorAddress(c.id, e.target.value)} placeholder="0x address" /></div>
                  <input className="percent-input" type="number" min="1" max="99" value={c.percent} onChange={(e) => updateCollaboratorPercent(c.id, Number(e.target.value))} />
                  <strong>%</strong>
                  <button type="button" className="trait-remove" onClick={() => removeCollaborator(c.id)} aria-label="Remove collaborator">✕</button>
                </div>
              ))}
              <button type="button" className="add-trait-button" onClick={addCollaborator} disabled={totalCollabPercent >= 99}>+ Add collaborator</button>
              {creatorPercent < 1 && <p className="field-hint">Collaborator splits are capped so the creator always retains at least 1%.</p>}
            </div>}
          </div>
          <div className="settings-card">
            <div className="card-heading"><div><span>FEE TRANSPARENCY</span><h2>Estimated distribution</h2></div><span className="card-index">C</span></div>
            <div className="fee-table">
              <div><span>Creator proceeds</span><b>{(draft.primarySplitEnabled ? 98.5 * (creatorPercent / 100) : 98.5).toFixed(2)}%</b></div>
              {draft.primarySplitEnabled && draft.collaborators.map((c, i) => (
                <div key={c.id}><span>Collaborator {i + 1} proceeds</span><b>{(98.5 * c.percent / 100).toFixed(2)}%</b></div>
              ))}
              <div><span>Mint Forge platform fee</span><b>1.5%</b></div>
              <div className="total"><span>Total</span><b>100%</b></div>
            </div>
          </div>
        </section>
        <aside className="summary-rail sticky-rail">
          <span className="rail-label">REVENUE SUMMARY</span>
          <div className="revenue-visual"><div style={{ width: (draft.primarySplitEnabled ? creatorPercent : 100) + "%" }} /><div className="collab" style={{ width: (draft.primarySplitEnabled ? totalCollabPercent : 0) + "%" }} /></div>
          <div className="legend"><span><i /> Creator</span>{draft.primarySplitEnabled && totalCollabPercent > 0 && <span><i className="collab" /> Collaborators</span>}</div>
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
          {draft.itemMode === "single" ? (
            <div className="review-hero">
              <div className="review-art">{artwork ? <LiveArtworkPreview artwork={artwork} /> : <span>MF</span>}</div>
              <div><span>READY FOR CONTRACT DESIGN</span><h2>{draft.name || "Untitled NFT"}</h2><p>{draft.collectionName} · {selectedChain.name}</p><div className="review-badges"><b>{draft.standard}</b><b>{draft.collectionMode === "owned" ? "Creator-owned" : "Shared contract"}</b><b>{draft.mintType === "unique" ? "1 / 1" : draft.mintType + " edition"}</b></div></div>
            </div>
          ) : (
            <div className="review-hero">
              <div className="review-art collection-review-grid">
                {collectionItems.slice(0, 4).map((item) => (
                  <div className="collection-preview-cell" key={item.id}>
                    {item.url ? <img src={item.url} alt={item.name} /> : <div className="collection-item-fallback">{item.name.split(".").pop()?.toUpperCase()}</div>}
                  </div>
                ))}
                {collectionItems.length === 0 && <span>MF</span>}
              </div>
              <div><span>READY FOR CONTRACT DESIGN</span><h2>{draft.collectionName || "Untitled Collection"}</h2><p>{collectionItems.length} item{collectionItems.length === 1 ? "" : "s"} · {selectedChain.name}</p><div className="review-badges"><b>{draft.standard}</b><b>{draft.collectionMode === "owned" ? "Creator-owned" : "Shared contract"}</b><b>Collection</b></div></div>
            </div>
          )}
          <div className="review-grid">
            <div className="review-card"><span>DROP</span><dl><div><dt>Supply</dt><dd>{draft.mintType === "open" ? "Open" : draft.supply}</dd></div><div><dt>Price</dt><dd>{draft.price} {selectedChain.native}</dd></div><div><dt>Per wallet</dt><dd>{draft.maxPerWallet}</dd></div><div><dt>Access</dt><dd>{draft.allowlist ? "Allowlist + public" : "Public"}</dd></div></dl><button onClick={() => goToStep(2)}>Edit mint settings</button></div>
            <div className="review-card"><span>REVENUE</span><dl><div><dt>Royalty</dt><dd>{draft.royaltyEnabled ? draft.royaltyPercent + "%" : "Off"}</dd></div><div><dt>Primary split</dt><dd>{draft.primarySplitEnabled ? draft.collaborators.length + " collaborator" + (draft.collaborators.length === 1 ? "" : "s") : "Creator only"}</dd></div><div><dt>Platform fee</dt><dd>1.5%</dd></div><div><dt>Standard</dt><dd>ERC-2981</dd></div></dl><button onClick={() => goToStep(3)}>Edit revenue</button></div>
            <div className="review-card"><span>UTILITY</span><dl><div><dt>Modules</dt><dd>{modules.length ? modules.join(", ") : "None"}</dd></div>{draft.stakingEnabled && <><div><dt>Staking contract</dt><dd>{draft.stakeVaultMode === "shared" ? "Shared MintForge" : "Creator-owned"}</dd></div><div><dt>NFT custody</dt><dd>{draft.soulbound || draft.stakeCustody === "wallet" ? "Wallet lock" : "Vault contract"}</dd></div><div><dt>Reward pool</dt><dd>Collection-isolated</dd></div></>}<div><dt>Emergency pause</dt><dd>{draft.pausable ? "Enabled" : "Off"}</dd></div><div><dt>Metadata freeze</dt><dd>{draft.freezeMetadata ? "Enabled" : "Off"}</dd></div><div><dt>Transferable</dt><dd>{draft.soulbound ? "No" : "Yes"}</dd></div></dl><button onClick={() => goToStep(4)}>Edit utility</button></div>
            <div className="review-card"><span>STORAGE</span><dl>{draft.itemMode === "single" ? (<><div><dt>Original payload</dt><dd>{artwork ? artwork.extension : "Needed"}</dd></div><div><dt>File category</dt><dd>{artwork ? artwork.kind : "—"}</dd></div></>) : (<><div><dt>Items</dt><dd>{collectionItems.length || "Needed"}</dd></div><div><dt>With traits</dt><dd>{collectionItems.filter((item) => item.traits.length > 0).length} of {collectionItems.length}</dd></div></>)}<div><dt>Metadata</dt><dd>IPFS</dd></div><div><dt>Network</dt><dd>{selectedChain.name}</dd></div></dl><button onClick={() => goToStep(0)}>Edit asset</button></div>
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

  if (!tosAccepted) return <LegalGate onAccept={() => setTosAccepted(true)} />;

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
        </> : mode === "dashboard" ? <>
          <div className="viewer-side-intro"><span>PORTFOLIO</span><strong>Own it.<br />Manage it.</strong><p>Every collection you've deployed, in one place.</p></div>
          <nav className="viewer-side-list" aria-label="Dashboard capabilities">
            <div><span>01</span><b>Track mint progress</b><i>●</i></div>
            <div><span>02</span><b>Withdraw proceeds</b><i>●</i></div>
            <div><span>03</span><b>Manage staking pools</b><i>●</i></div>
          </nav>
        </> : mode === "market" ? <>
          <div className="viewer-side-intro"><span>SECONDARY MARKET</span><strong>Buy.<br />Sell. Trade.</strong><p>Browse listings or sell what you already own.</p></div>
          <nav className="viewer-side-list" aria-label="Marketplace capabilities">
            <div><span>01</span><b>Browse listings</b><i>●</i></div>
            <div><span>02</span><b>Place offers</b><i>●</i></div>
            <div><span>03</span><b>List your NFTs</b><i>●</i></div>
          </nav>
        </> : mode === "stake" ? <>
          <div className="stake-side-intro"><span>HOLDER REWARDS</span><strong>Stake.<br />Earn. Repeat.</strong><p>Manage eligible NFTs and every active reward position.</p></div>
          <nav className="stake-side-list" aria-label="Staking workflow">
            <div><span>01</span><b>Select NFTs</b><i>●</i></div>
            <div><span>02</span><b>Choose terms</b><i>●</i></div>
            <div><span>03</span><b>Claim + unstake</b><i>●</i></div>
          </nav>
          <div className="stake-side-contract"><span>CONTRACT ROUTE</span><div><b>WALLET</b><i>→</i><b>VAULT</b><i>→</i><b>REWARD</b></div></div>
        </> : null}
        <div className="phase-note"><span>{mode === "create" ? "PROTOCOL STATUS" : mode === "viewer" ? "READ-ONLY VIEWER" : mode === "dashboard" ? "DASHBOARD STATUS" : mode === "market" ? "MARKETPLACE STATUS" : "STAKING STATUS"}</span><p>{mode === "create" ? "Creator interface online · contracts coming next." : mode === "viewer" ? "No wallet or blockchain approval required." : mode === "dashboard" ? "Sample data shown · live stats activate with contracts." : mode === "market" ? "Sample listings shown · trading activates with contracts." : "Holder interface online · staking contracts coming next."}</p></div>
        <button className="help-button">Documentation <span>↗</span></button>
      </aside>

      <section className="workspace" id="top">
        <header className="topbar">
          <div><span className="eyebrow">{mode === "create" ? "MULTICHAIN CREATION TERMINAL" : mode === "viewer" ? "UNIVERSAL NFT VIEWER" : mode === "dashboard" ? "CREATOR DASHBOARD" : mode === "market" ? "SECONDARY MARKETPLACE" : "NFT STAKING TERMINAL"}</span><span className="autosave"><i /> {mode === "create" ? savedAt : "Interface mode"}</span></div>
          <div className="studio-mode-switch" role="tablist" aria-label="Studio mode">
            <button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => switchMode("create")}>Create NFT</button>
            <button type="button" role="tab" aria-selected={mode === "viewer"} className={mode === "viewer" ? "active" : ""} onClick={() => switchMode("viewer")}>View NFT</button>
            <button type="button" role="tab" aria-selected={mode === "stake"} className={mode === "stake" ? "active" : ""} onClick={() => switchMode("stake")}>Stake NFTs</button>
            <button type="button" role="tab" aria-selected={mode === "dashboard"} className={mode === "dashboard" ? "active" : ""} onClick={() => switchMode("dashboard")}>Dashboard</button>
            <button type="button" role="tab" aria-selected={mode === "market"} className={mode === "market" ? "active" : ""} onClick={() => switchMode("market")}>Marketplace</button>
          </div>
          <div className="wallet-controls">
            <div className="chain-picker">
              <button className="chain-button" onClick={() => setChainOpen(!chainOpen)} aria-expanded={chainOpen}><span style={{ background: selectedChain.colour }}>{selectedChain.mark}</span>{selectedChain.name}<b>⌄</b></button>
              {chainOpen && <div className="chain-menu"><small>{mode === "create" ? "LAUNCH NETWORK" : mode === "viewer" ? "VIEW NETWORK" : mode === "dashboard" ? "DASHBOARD NETWORK" : mode === "market" ? "MARKETPLACE NETWORK" : "STAKING NETWORK"}</small>{chains.map((chain) => <button key={chain.id} onClick={() => chooseChain(chain)}><span style={{ background: chain.colour }}>{chain.mark}</span>{chain.name}{chain.id === selectedChain.id && <b>✓</b>}</button>)}</div>}
            </div>
            <button className={wallet ? "wallet-button connected" : "wallet-button"} onClick={connectWallet}><span>{wallet ? "●" : "◌"}</span>{wallet ? shortWallet : "Connect wallet"}</button>
          </div>
        </header>

        <div className="page-wrap">
          {mode === "viewer" ? <NftViewer chain={selectedChain} wallet={wallet} onConnectWallet={connectWallet} /> : mode === "stake" ? <NftStaking chain={selectedChain} wallet={wallet} onConnectWallet={connectWallet} /> : mode === "dashboard" ? <CreatorDashboard chain={selectedChain} wallet={wallet} onConnectWallet={connectWallet} onEditDraft={() => switchMode("create")} /> : mode === "market" ? <Marketplace chain={selectedChain} wallet={wallet} onConnectWallet={connectWallet} /> : <>
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
