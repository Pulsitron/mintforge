import { INDEXERS } from "../../../lib/indexers";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = params.get("address") || "";
  const indexer = INDEXERS[params.get("chainId") || ""];
  if (!indexer || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ error: "Choose a supported network and valid collection address." }, { status: 400 });
  }
  if (!indexer.base) return Response.json({ holders: null, source: null });
  try {
    // Blockscout's token endpoint reports its indexed holder count. It may lag the chain.
    const response = await fetch(`${indexer.base}/api/v2/tokens/${address}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Indexer unavailable");
    const data = await response.json() as { holders_count?: string | number | null };
    const raw = data.holders_count;
    const holders = raw !== null && raw !== undefined && /^\d+$/.test(String(raw)) ? Number(raw) : null;
    return Response.json({ holders: Number.isSafeInteger(holders) ? holders : null, source: indexer.name + " explorer" }, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  } catch {
    return Response.json({ holders: null, source: indexer.name + " explorer" });
  }
}
