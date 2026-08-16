import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const NETWORKS: Record<string, { name: string; rpc: string }> = {
  "0x171": { name: "PulseChain", rpc: "https://rpc.pulsechain.com" },
  "0x1": { name: "Ethereum", rpc: "https://eth-mainnet.g.alchemy.com/public" },
  "0x2105": { name: "Base", rpc: "https://mainnet.base.org" },
  "0x89": { name: "Polygon", rpc: "https://polygon.drpc.org" },
  "0xa4b1": { name: "Arbitrum", rpc: "https://arb1.arbitrum.io/rpc" },
  "0x38": { name: "BNB Chain", rpc: "https://bsc-dataseed.bnbchain.org" },
};

const TOKEN_URI_SELECTOR = "0xc87b56dd";
const ERC1155_URI_SELECTOR = "0x0e89341c";
const NAME_SELECTOR = "0x06fdde03";
const SYMBOL_SELECTOR = "0x95d89b41";
const OWNER_OF_SELECTOR = "0x6352211e";
const MAX_METADATA_BYTES = 2_000_000;

type JsonRecord = Record<string, unknown>;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function encodeTokenId(value: string) {
  try {
    const tokenId = BigInt(value.trim());
    if (tokenId < 0n) throw new Error("negative");
    return tokenId.toString(16).padStart(64, "0");
  } catch {
    throw new Error("Token ID must be a non-negative decimal or hexadecimal number.");
  }
}

function hexToBytes(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decodeAbiString(hex: string) {
  if (!hex || hex === "0x") throw new Error("Empty contract response.");
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (raw.length < 64) throw new Error("Invalid contract response.");

  try {
    const offsetBytes = Number.parseInt(raw.slice(0, 64), 16);
    const offset = offsetBytes * 2;
    const length = Number.parseInt(raw.slice(offset, offset + 64), 16);
    const start = offset + 64;
    const value = new TextDecoder().decode(hexToBytes(raw.slice(start, start + length * 2)));
    if (value) return value.replace(/\0+$/g, "");
  } catch {
    // Some older contracts return bytes32 instead of a dynamic ABI string.
  }

  return new TextDecoder().decode(hexToBytes(raw.slice(0, 64))).replace(/\0+$/g, "");
}

function decodeAddress(hex: string) {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  return raw.length >= 40 ? "0x" + raw.slice(-40) : null;
}

function normalizeUri(value: unknown, tokenHex = "") {
  if (typeof value !== "string") return null;
  let uri = value.trim();
  if (!uri) return null;
  if (tokenHex) {
    uri = uri.replace(/\{id\}/gi, tokenHex.toLowerCase());
  }
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice(7).replace(/^ipfs\//i, "");
    return "https://ipfs.io/ipfs/" + path;
  }
  if (uri.startsWith("ar://")) {
    return "https://arweave.net/" + uri.slice(5);
  }
  if (/^https?:\/\//i.test(uri)) return uri;
  if (/^data:(application\/json|application\/pdf|image\/|video\/|audio\/|model\/)/i.test(uri)) return uri;
  return null;
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some((value) => value > 255)) return true;
  const [a, b] = values;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function assertSafeUrl(value: string) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported metadata URL protocol.");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.includes(":") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("Private network metadata URLs are not supported.");
  }
  return parsed;
}

async function fetchPublic(url: string) {
  let current = assertSafeUrl(url);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(current, {
      headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.2" },
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Metadata redirect had no destination.");
      current = assertSafeUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  throw new Error("Metadata redirected too many times.");
}

function decodeDataJson(uri: string) {
  const comma = uri.indexOf(",");
  if (comma === -1) throw new Error("Invalid on-chain JSON URI.");
  const header = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  const text = /;base64/i.test(header)
    ? new TextDecoder().decode(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)))
    : decodeURIComponent(payload);
  return JSON.parse(text) as JsonRecord;
}

function looksLikeMedia(uri: string) {
  if (/^data:(image|video|audio|model|application\/pdf)/i.test(uri)) return true;
  let source = uri;
  try { source = decodeURIComponent(source); } catch { /* Keep the encoded URL. */ }
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp|mp4|m4v|mov|webm|ogv|mp3|wav|ogg|oga|m4a|flac|glb|gltf|usdz|pdf)(?:$|[?&#=])/i.test(source);
}

function inferMediaKind(uri: string | null, animation = false) {
  if (!uri) return "unknown";
  let clean = uri.toLowerCase();
  try { clean = decodeURIComponent(clean); } catch { /* Keep the encoded URL. */ }
  if (/^data:image\//.test(clean) || /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?&#=])/.test(clean)) return "image";
  if (/^data:video\//.test(clean) || /\.(mp4|m4v|mov|webm|ogv)(?:$|[?&#=])/.test(clean)) return "video";
  if (/^data:audio\//.test(clean) || /\.(mp3|wav|ogg|oga|m4a|flac)(?:$|[?&#=])/.test(clean)) return "audio";
  if (/^data:model\//.test(clean) || /\.(glb|gltf|usdz)(?:$|[?&#=])/.test(clean)) return "model";
  if (/^data:application\/pdf/.test(clean) || /\.pdf(?:$|[?&#=])/.test(clean)) return "document";
  if (/\.html?(?:$|[?&#=])/.test(clean)) return "html";
  return animation ? "html" : "image";
}

function gatewayCandidates(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "ipfs.io" || !parsed.pathname.startsWith("/ipfs/")) return [url];
    const path = parsed.pathname.slice(6);
    const [cid, ...restParts] = path.split("/");
    if (!cid) return [url];
    const suffix = restParts.length ? "/" + restParts.join("/") : "/";
    return [...new Set([
      url,
      "https://dweb.link/ipfs/" + path + parsed.search,
      ...(cid.toLowerCase().startsWith("b") ? ["https://" + cid + ".ipfs.dweb.link" + suffix + parsed.search] : []),
      "https://nftstorage.link/ipfs/" + path + parsed.search,
    ])];
  } catch {
    return [url];
  }
}

function normalizeMetadata(raw: JsonRecord, tokenHex: string) {
  let image = normalizeUri(raw.image ?? raw.image_url ?? raw.imageUrl ?? raw.image_uri ?? raw.imageURI ?? raw.thumbnail ?? raw.thumbnail_url, tokenHex);
  if (!image && typeof raw.image_data === "string") {
    const svg = raw.image_data.trim();
    image = svg.startsWith("<svg")
      ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
      : normalizeUri(svg, tokenHex);
  }

  const animation = normalizeUri(raw.animation_url ?? raw.animationUrl ?? raw.animation ?? raw.animation_uri ?? raw.animationURI ?? raw.video ?? raw.video_url ?? raw.videoUrl ?? raw.audio ?? raw.audio_url ?? raw.audioUrl, tokenHex);
  const externalUrl = normalizeUri(raw.external_url ?? raw.external_link ?? raw.home_url, tokenHex);
  const attributes = Array.isArray(raw.attributes)
    ? raw.attributes.slice(0, 100).map((attribute) => {
        if (!attribute || typeof attribute !== "object") return null;
        const record = attribute as JsonRecord;
        return {
          trait_type: String(record.trait_type ?? record.type ?? "Attribute"),
          value: String(record.value ?? record.display_value ?? "—"),
          display_type: typeof record.display_type === "string" ? record.display_type : null,
        };
      }).filter(Boolean)
    : [];

  return {
    name: typeof raw.name === "string" ? raw.name : null,
    description: typeof raw.description === "string" ? raw.description : null,
    image,
    animation_url: animation,
    external_url: externalUrl,
    background_color: typeof raw.background_color === "string" ? raw.background_color.replace(/^#/, "") : null,
    attributes,
    image_kind: inferMediaKind(image, false),
    animation_kind: inferMediaKind(animation, true),
  };
}

async function readMetadata(tokenUri: string, tokenHex: string) {
  const resolved = normalizeUri(tokenUri, tokenHex);
  if (!resolved) throw new Error("The contract returned an empty metadata URI.");

  let raw: JsonRecord;
  if (/^data:application\/json/i.test(resolved)) {
    raw = decodeDataJson(resolved);
  } else if (looksLikeMedia(resolved)) {
    const kind = inferMediaKind(resolved, false);
    raw = kind === "video" || kind === "audio" || kind === "model"
      ? { name: null, animation_url: resolved }
      : { name: null, image: resolved };
  } else {
    raw = await Promise.any(gatewayCandidates(resolved).map(async (candidate) => {
      const response = await fetchPublic(candidate);
      if (!response.ok) throw new Error("Metadata server returned HTTP " + response.status + ".");
      const contentType = response.headers.get("content-type") || "";
      if (/^image\//i.test(contentType)) return { image: resolved };
      if (/^(video|audio|model)\//i.test(contentType)) return { animation_url: resolved };
      const declaredLength = Number(response.headers.get("content-length") || "0");
      if (declaredLength > MAX_METADATA_BYTES) throw new Error("Metadata file is too large.");
      const text = await response.text();
      if (text.length > MAX_METADATA_BYTES) throw new Error("Metadata file is too large.");
      try {
        return JSON.parse(text) as JsonRecord;
      } catch {
        throw new Error("The token URI did not return valid NFT metadata.");
      }
    }));
  }

  return { metadataUri: resolved, metadata: normalizeMetadata(raw, tokenHex), raw };
}

async function rpcCall(rpc: string, method: string, params: unknown[]) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("The network RPC is temporarily unavailable.");
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error || typeof body.result !== "string") {
    throw new Error(body.error?.message || "The contract call failed.");
  }
  return body.result;
}

async function contractCall(rpc: string, contract: string, data: string) {
  return rpcCall(rpc, "eth_call", [{ to: contract, data }, "latest"]);
}

async function optionalStringCall(rpc: string, contract: string, selector: string) {
  try {
    return decodeAbiString(await contractCall(rpc, contract, selector)) || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { chainId?: string; contract?: string; tokenId?: string; uri?: string };

    if (body.uri) {
      const directUri = body.uri.trim();
      const { metadataUri, metadata, raw } = await readMetadata(directUri, "");
      return NextResponse.json({
        source: "direct",
        standard: "Direct URI",
        network: null,
        contract: null,
        tokenId: null,
        tokenUri: directUri,
        metadataUri,
        collection: null,
        symbol: null,
        owner: null,
        metadata,
        raw,
      });
    }

    const network = body.chainId ? NETWORKS[body.chainId] : null;
    if (!network) return jsonError("Choose a supported network.");

    const contract = body.contract?.trim() || "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) return jsonError("Enter a valid NFT contract address.");
    const tokenId = body.tokenId?.trim() || "";
    const tokenHex = encodeTokenId(tokenId);

    const code = await rpcCall(network.rpc, "eth_getCode", [contract, "latest"]);
    if (!code || code === "0x") return jsonError("No smart contract was found at this address.", 404);

    let tokenUri: string;
    let standard: "ERC-721" | "ERC-1155";
    try {
      tokenUri = decodeAbiString(await contractCall(network.rpc, contract, TOKEN_URI_SELECTOR + tokenHex));
      standard = "ERC-721";
    } catch {
      try {
        tokenUri = decodeAbiString(await contractCall(network.rpc, contract, ERC1155_URI_SELECTOR + tokenHex));
        standard = "ERC-1155";
      } catch {
        return jsonError("This contract did not return ERC-721 or ERC-1155 metadata for that token ID.", 404);
      }
    }

    const [collection, symbol, owner, metadataResult] = await Promise.all([
      optionalStringCall(network.rpc, contract, NAME_SELECTOR),
      optionalStringCall(network.rpc, contract, SYMBOL_SELECTOR),
      standard === "ERC-721"
        ? contractCall(network.rpc, contract, OWNER_OF_SELECTOR + tokenHex).then(decodeAddress).catch(() => null)
        : Promise.resolve(null),
      readMetadata(tokenUri, tokenHex),
    ]);

    return NextResponse.json({
      source: "contract",
      standard,
      network: network.name,
      contract,
      tokenId,
      tokenUri,
      metadataUri: metadataResult.metadataUri,
      collection,
      symbol,
      owner,
      metadata: {
        ...metadataResult.metadata,
        name: metadataResult.metadata.name || (collection ? collection + " #" + tokenId : "Token #" + tokenId),
      },
      raw: metadataResult.raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load this NFT.";
    return jsonError(message, 502);
  }
}
