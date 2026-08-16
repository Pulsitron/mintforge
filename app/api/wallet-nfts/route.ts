import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const PAGE_SIZE = 12;
const MAX_METADATA_BYTES = 1_000_000;
const TOKEN_URI_SELECTOR = "0xc87b56dd";
const ERC1155_URI_SELECTOR = "0x0e89341c";

const INDEXERS: Record<string, { name: string; base: string | null; rpc: string }> = {
  "0x171": { name: "PulseChain", base: "https://api.scan.pulsechain.com", rpc: "https://rpc.pulsechain.com" },
  "0x1": { name: "Ethereum", base: "https://eth.blockscout.com", rpc: "https://eth-mainnet.g.alchemy.com/public" },
  "0x2105": { name: "Base", base: "https://base.blockscout.com", rpc: "https://mainnet.base.org" },
  "0x89": { name: "Polygon", base: "https://polygon.blockscout.com", rpc: "https://polygon.drpc.org" },
  "0xa4b1": { name: "Arbitrum", base: "https://arbitrum.blockscout.com", rpc: "https://arb1.arbitrum.io/rpc" },
  "0x38": { name: "BNB Chain", base: null, rpc: "https://bsc-dataseed.bnbchain.org" },
};

type JsonRecord = Record<string, unknown>;
type Cursor = { query: Record<string, string>; offset: number; totalCount: number | null };
type MediaKind = "image" | "video" | "audio" | "model" | "html" | "document" | "unknown";
type MediaReference = { uri: string | null; mime: string | null };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function recordFrom(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonRecord;
    } catch {
      // Some indexers return null or a non-JSON status string here.
    }
  }
  return {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeUri(value: unknown) {
  if (typeof value !== "string") return null;
  const uri = value.trim();
  if (!uri) return null;
  if (/^ipfs:\/\//i.test(uri)) return "https://ipfs.io/ipfs/" + uri.slice(7).replace(/^ipfs\//i, "");
  if (/^ar:\/\//i.test(uri)) return "https://arweave.net/" + uri.slice(5);
  if (uri.startsWith("//")) return "https:" + uri;
  if (/^https?:\/\//i.test(uri) || /^data:/i.test(uri) || /^blob:/i.test(uri)) return uri;
  return null;
}

function mediaReference(value: unknown): MediaReference {
  if (typeof value === "string") return { uri: normalizeUri(value), mime: null };
  const record = recordFrom(value);
  return {
    uri: normalizeUri(firstString(record.uri, record.url, record.href, record.src, record.file, record.content, record.gateway)),
    mime: firstString(record.type, record.mime, record.mime_type, record.mimeType, record.content_type, record.contentType),
  };
}

function firstReference(...values: unknown[]): MediaReference {
  for (const value of values) {
    const reference = mediaReference(value);
    if (reference.uri) return reference;
  }
  return { uri: null, mime: null };
}

function genericMediaReference(metadata: JsonRecord) {
  const properties = recordFrom(metadata.properties);
  const candidates: unknown[] = [
    metadata.media,
    metadata.media_url,
    metadata.mediaUrl,
    metadata.file,
    metadata.file_url,
    metadata.fileUrl,
    metadata.asset,
    metadata.asset_url,
    metadata.assetUrl,
    metadata.content,
    metadata.content_url,
    metadata.contentUrl,
    metadata.artifactUri,
    metadata.displayUri,
    properties.media,
    properties.file,
  ];
  for (const group of [metadata.files, metadata.formats, properties.files, properties.formats]) {
    if (Array.isArray(group)) candidates.push(...group);
  }
  return firstReference(...candidates);
}

function mediaFrom(item: JsonRecord, metadata: JsonRecord) {
  let image = firstReference(item.image_url, metadata.image, metadata.image_url, metadata.imageUrl, metadata.image_uri, metadata.imageURI, metadata.thumbnail, metadata.thumbnail_url, metadata.thumbnailUrl);
  let animation = firstReference(item.animation_url, metadata.animation_url, metadata.animationUrl, metadata.animation, metadata.animation_uri, metadata.animationURI, metadata.video, metadata.video_url, metadata.videoUrl, metadata.audio, metadata.audio_url, metadata.audioUrl);

  if (!image.uri && typeof metadata.image_data === "string") {
    const source = metadata.image_data.trim();
    if (source.startsWith("<svg")) image = { uri: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source), mime: "image/svg+xml" };
    else image = mediaReference(source);
  }

  const generic = genericMediaReference(metadata);
  if (generic.uri && !animation.uri && !image.uri) {
    const genericKind = kindFromMime(generic.mime);
    if (genericKind === "image") image = generic;
    else animation = generic;
  }

  image.mime ||= firstString(item.image_type, metadata.image_type, metadata.image_mime_type);
  animation.mime ||= firstString(item.animation_type, metadata.animation_type, metadata.animation_mime_type, metadata.mime_type);
  return { image, animation };
}

function kindFromMime(mime: string | null): MediaKind {
  const clean = mime?.toLowerCase().split(";")[0].trim() || "";
  if (clean.startsWith("image/")) return "image";
  if (clean.startsWith("video/") || clean === "application/vnd.apple.mpegurl" || clean === "application/x-mpegurl") return "video";
  if (clean.startsWith("audio/")) return "audio";
  if (clean.startsWith("model/")) return "model";
  if (clean === "application/pdf") return "document";
  if (clean === "text/html" || clean === "application/xhtml+xml") return "html";
  return "unknown";
}

function inferKind(uri: string | null, mime: string | null): MediaKind {
  const mimeKind = kindFromMime(mime);
  if (mimeKind !== "unknown") return mimeKind;
  if (!uri) return "unknown";
  let source = uri.toLowerCase();
  try { source = decodeURIComponent(source); } catch { /* Keep the encoded URL. */ }
  if (/^data:image\//.test(source) || /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:$|[?&#=])/.test(source)) return "image";
  if (/^data:video\//.test(source) || /\.(mp4|m4v|mov|m3u8|mpeg|mpg|webm|ogv)(?:$|[?&#=])/.test(source)) return "video";
  if (/^data:audio\//.test(source) || /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav)(?:$|[?&#=])/.test(source)) return "audio";
  if (/^data:model\//.test(source) || /\.(glb|gltf|usdz)(?:$|[?&#=])/.test(source)) return "model";
  if (/^data:application\/pdf/.test(source) || /\.pdf(?:$|[?&#=])/.test(source)) return "document";
  if (/^data:text\/html/.test(source) || /\.html?(?:$|[?&#=])/.test(source)) return "html";
  return "unknown";
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
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.includes(":") || isPrivateIpv4(hostname)) {
    throw new Error("Private network metadata URLs are not supported.");
  }
  return parsed;
}

async function fetchPublic(url: string, method: "GET" | "HEAD" = "GET") {
  let current = assertSafeUrl(url);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(current, {
      method,
      headers: { Accept: method === "GET" ? "application/json, */*;q=0.5" : "*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(method === "GET" ? 10_000 : 4_000),
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

function hexToBytes(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function decodeAbiString(hex: string) {
  if (!hex || hex === "0x") throw new Error("Empty contract response.");
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (raw.length < 64) throw new Error("Invalid contract response.");
  try {
    const offset = Number.parseInt(raw.slice(0, 64), 16) * 2;
    const length = Number.parseInt(raw.slice(offset, offset + 64), 16);
    const value = new TextDecoder().decode(hexToBytes(raw.slice(offset + 64, offset + 64 + length * 2)));
    if (value) return value.replace(/\0+$/g, "");
  } catch {
    // Some older contracts return bytes32 instead of a dynamic string.
  }
  return new TextDecoder().decode(hexToBytes(raw.slice(0, 64))).replace(/\0+$/g, "");
}

function tokenHex(tokenId: string) {
  const value = BigInt(tokenId);
  if (value < 0n) throw new Error("Negative token ID.");
  return value.toString(16).padStart(64, "0");
}

function decodeDataJson(uri: string) {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("Invalid on-chain JSON.");
  const header = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  const text = /;base64/i.test(header)
    ? new TextDecoder().decode(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)))
    : decodeURIComponent(payload);
  return recordFrom(JSON.parse(text));
}

async function rpcCall(rpc: string, contract: string, data: string) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data }, "latest"] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("RPC unavailable.");
  const body = await response.json() as { result?: string; error?: unknown };
  if (body.error || typeof body.result !== "string") throw new Error("Token URI call failed.");
  return body.result;
}

function gatewayCandidates(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "ipfs.io" || !parsed.pathname.startsWith("/ipfs/")) return [url];
    const path = parsed.pathname.slice(6);
    const [cid, ...restParts] = path.split("/");
    if (!cid) return [url];
    const rest = restParts.join("/");
    const suffix = rest ? "/" + rest : "/";
    const search = parsed.search;
    return [...new Set([
      url,
      "https://dweb.link/ipfs/" + path + search,
      ...(cid.toLowerCase().startsWith("b") ? ["https://" + cid + ".ipfs.dweb.link" + suffix + search] : []),
      "https://nftstorage.link/ipfs/" + path + search,
    ])];
  } catch {
    return [url];
  }
}

async function readRemoteMetadata(url: string) {
  return Promise.any(gatewayCandidates(url).map(async (candidate) => {
    const response = await fetchPublic(candidate);
    if (!response.ok) throw new Error("Metadata gateway returned HTTP " + response.status + ".");
    const contentType = response.headers.get("content-type") || "";
    const mediaKind = kindFromMime(contentType);
    if (mediaKind !== "unknown" && mediaKind !== "html") return { file: { url, type: contentType } };
    const declaredLength = Number(response.headers.get("content-length") || "0");
    if (declaredLength > MAX_METADATA_BYTES) throw new Error("Metadata is too large.");
    const text = await response.text();
    if (text.length > MAX_METADATA_BYTES) throw new Error("Metadata is too large.");
    try {
      const metadata = recordFrom(JSON.parse(text));
      if (!Object.keys(metadata).length) throw new Error("Metadata JSON was empty.");
      return metadata;
    } catch {
      throw new Error("Token metadata was not valid JSON or playable media.");
    }
  }));
}

async function readTokenMetadata(rpc: string, contract: string, tokenId: string, standard: string) {
  const id = tokenHex(tokenId);
  const selectors = standard.toUpperCase().includes("1155") ? [ERC1155_URI_SELECTOR, TOKEN_URI_SELECTOR] : [TOKEN_URI_SELECTOR, ERC1155_URI_SELECTOR];
  let tokenUri = "";
  for (const selector of selectors) {
    try {
      tokenUri = decodeAbiString(await rpcCall(rpc, contract, selector + id));
      if (tokenUri) break;
    } catch {
      // Try the alternate ERC standard URI function.
    }
  }
  if (!tokenUri) throw new Error("No token metadata URI.");
  const resolved = normalizeUri(tokenUri.replace(/\{id\}/gi, id.toLowerCase()));
  if (!resolved) throw new Error("Unsupported token metadata URI.");
  if (/^data:application\/json/i.test(resolved)) return decodeDataJson(resolved);

  const directKind = inferKind(resolved, null);
  if (directKind !== "unknown") return { file: { url: resolved } };

  return readRemoteMetadata(resolved);
}

async function resolveKind(reference: MediaReference, fallback: MediaKind) {
  const inferred = inferKind(reference.uri, reference.mime);
  if (!reference.uri) return "unknown";
  if (inferred !== "unknown" || !/^https?:\/\//i.test(reference.uri)) return inferred === "unknown" ? fallback : inferred;
  try {
    return await Promise.any(gatewayCandidates(reference.uri).map(async (candidate) => {
      const response = await fetchPublic(candidate, "HEAD");
      if (!response.ok) throw new Error("Media gateway unavailable.");
      const detected = kindFromMime(response.headers.get("content-type"));
      if (detected === "unknown" || detected === "html") throw new Error("Unknown media type.");
      return detected;
    }));
  } catch {
    // A missing/blocked HEAD response should not stop the NFT from rendering.
  }
  return fallback;
}

function encodeCursor(cursor: Cursor) {
  const json = JSON.stringify(cursor);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: string | null): Cursor {
  if (!value) return { query: {}, offset: 0, totalCount: null };
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Cursor;
    if (!parsed || typeof parsed.offset !== "number" || parsed.offset < 0 || !parsed.query || typeof parsed.query !== "object") throw new Error("invalid");
    const query: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed.query)) {
      if (/^[a-z_]+$/i.test(key) && typeof entry === "string" && entry.length < 160) query[key] = entry;
    }
    const totalCount = typeof parsed.totalCount === "number" && Number.isFinite(parsed.totalCount) && parsed.totalCount >= 0
      ? Math.floor(parsed.totalCount)
      : null;
    return { query, offset: Math.floor(parsed.offset), totalCount };
  } catch {
    throw new Error("The gallery page cursor is invalid.");
  }
}

function normalizedAttributes(metadata: JsonRecord) {
  if (!Array.isArray(metadata.attributes)) return [];
  return metadata.attributes.slice(0, 100).map((attribute) => {
    if (!attribute || typeof attribute !== "object") return null;
    const record = attribute as JsonRecord;
    return {
      trait_type: String(record.trait_type ?? record.type ?? "Attribute"),
      value: String(record.value ?? record.display_value ?? "—"),
    };
  }).filter(Boolean);
}

async function normalizeItem(value: unknown, indexer: { name: string; rpc: string }) {
  const item = recordFrom(value);
  const token = recordFrom(item.token);
  let metadata = recordFrom(item.metadata);
  const contract = firstString(token.address_hash, token.address);
  const tokenId = String(item.id ?? item.token_id ?? "");
  const standard = String(item.token_type ?? token.type ?? "NFT");
  let media = mediaFrom(item, metadata);

  if ((!media.image.uri && !media.animation.uri) && contract && tokenId) {
    try {
      metadata = { ...metadata, ...await readTokenMetadata(indexer.rpc, contract, tokenId, standard) };
      media = mediaFrom(item, metadata);
    } catch {
      // Keep the indexed metadata if the collection's contract or host is unavailable.
    }
  }

  const [imageKind, animationKind] = await Promise.all([
    resolveKind(media.image, "image"),
    resolveKind(media.animation, "html"),
  ]);
  const collection = typeof token.name === "string" ? token.name : null;
  const name = typeof metadata.name === "string" && metadata.name.trim()
    ? metadata.name
    : collection ? collection + (tokenId ? " #" + tokenId : "") : tokenId ? "Token #" + tokenId : "Untitled NFT";

  return {
    contract,
    tokenId,
    standard,
    balance: String(item.value ?? "1"),
    collection,
    symbol: typeof token.symbol === "string" ? token.symbol : null,
    network: indexer.name,
    name,
    description: typeof metadata.description === "string" ? metadata.description : null,
    image: media.image.uri,
    animation: media.animation.uri,
    imageKind,
    animationKind,
    externalUrl: normalizeUri(firstString(item.external_app_url, metadata.external_url, metadata.externalUrl, metadata.external_link, metadata.home_url, metadata.homeUrl)),
    attributes: normalizedAttributes(metadata),
  };
}

async function normalizeItems(values: unknown[], indexer: { name: string; rpc: string }) {
  const results: Awaited<ReturnType<typeof normalizeItem>>[] = [];
  for (let offset = 0; offset < values.length; offset += 4) {
    results.push(...await Promise.all(values.slice(offset, offset + 4).map((item) => normalizeItem(item, indexer))));
  }
  return results;
}

function paginationQuery(value: unknown) {
  const query: Record<string, string> = {};
  const record = recordFrom(value);
  Object.entries(record).forEach(([key, entry]) => {
    if (/^[a-z_]+$/i.test(key) && (typeof entry === "string" || typeof entry === "number")) query[key] = String(entry);
  });
  return query;
}

async function fetchIndexerPage(base: string, wallet: string, query: Record<string, string>, grouped = false) {
  const endpoint = new URL(base + "/api/v2/addresses/" + wallet + "/nft" + (grouped ? "/collections" : ""));
  endpoint.searchParams.set("type", "ERC-721,ERC-1155");
  Object.entries(query).forEach(([key, entry]) => endpoint.searchParams.set(key, entry));
  const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("NFT indexer returned HTTP " + response.status + ".");
  return response.json() as Promise<{ items?: unknown[]; next_page_params?: Record<string, unknown> | null }>;
}

async function fetchIndexedTotal(base: string, wallet: string) {
  let query: Record<string, string> = {};
  let total = 0;
  for (let page = 0; page < 20; page += 1) {
    const body = await fetchIndexerPage(base, wallet, query, true);
    const collections = Array.isArray(body.items) ? body.items : [];
    for (const collection of collections) {
      const amount = Number(recordFrom(collection).amount ?? 0);
      if (Number.isFinite(amount) && amount > 0) total += amount;
    }
    const next = paginationQuery(body.next_page_params);
    if (!Object.keys(next).length) return total;
    query = next;
  }
  return total || null;
}

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get("wallet")?.trim() || "";
    const chainId = request.nextUrl.searchParams.get("chainId") || "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return jsonError("Connect a valid EVM wallet.");
    const indexer = INDEXERS[chainId];
    if (!indexer) return jsonError("Choose a supported network.");
    if (!indexer.base) return jsonError("Automatic wallet discovery is not yet available for BNB Chain. Manual contract lookup still works.", 501);

    const cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
    const isFirstBatch = cursor.offset === 0 && Object.keys(cursor.query).length === 0;
    const totalPromise = cursor.totalCount !== null
      ? Promise.resolve(cursor.totalCount)
      : isFirstBatch
        ? fetchIndexedTotal(indexer.base, wallet).catch(() => null)
        : Promise.resolve(null);

    let activeQuery = cursor.query;
    let activeOffset = cursor.offset;
    const rawItems: unknown[] = [];
    let nextState: { query: Record<string, string>; offset: number } | null = null;

    for (let hop = 0; hop < 5 && rawItems.length < PAGE_SIZE; hop += 1) {
      const body = await fetchIndexerPage(indexer.base, wallet, activeQuery);
      const upstreamItems = Array.isArray(body.items) ? body.items : [];
      const available = Math.max(0, upstreamItems.length - activeOffset);
      const take = Math.min(PAGE_SIZE - rawItems.length, available);
      if (take > 0) rawItems.push(...upstreamItems.slice(activeOffset, activeOffset + take));
      const consumedOffset = activeOffset + take;

      if (consumedOffset < upstreamItems.length) {
        nextState = { query: activeQuery, offset: consumedOffset };
        break;
      }

      const nextQuery = paginationQuery(body.next_page_params);
      if (!Object.keys(nextQuery).length) {
        nextState = null;
        break;
      }

      activeQuery = nextQuery;
      activeOffset = 0;
      nextState = { query: activeQuery, offset: 0 };
    }

    const totalCount = await totalPromise;
    const pageItems = await normalizeItems(rawItems, indexer);
    const nextCursor = nextState ? encodeCursor({ ...nextState, totalCount }) : null;
    return NextResponse.json({ wallet, network: indexer.name, pageSize: PAGE_SIZE, totalCount, items: pageItems, nextCursor });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to load wallet NFTs.", 502);
  }
}
