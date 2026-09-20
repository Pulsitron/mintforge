import { settings } from "../../../lib/server";
export async function GET() {
  const s = settings();
  return Response.json(
    { uploads: !!(s.IRYS_PRIVATE_KEY && s.STORAGE_PAYMENT_RECEIVER && s.DB), provider: "irys", maxItems: 10000, maxFileBytes: 90 * 1024 * 1024,
      storageChain: (s.IRYS_TOKEN || "ethereum") === "ethereum" ? "0x1" : s.IRYS_TOKEN === "base-eth" ? "0x2105" : null,
      storageSymbol: s.PLS_CHECKOUT_ENABLED === "true" ? "PLS" : "ETH",
      plsCheckout: s.PLS_CHECKOUT_ENABLED === "true", automaticIrysFunding: s.PLS_CHECKOUT_ENABLED === "true", automationAvailable: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
