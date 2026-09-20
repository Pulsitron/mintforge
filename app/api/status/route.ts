import { settings } from "../../../lib/server";
export async function GET() {
  const s = settings();
  return Response.json(
    { uploads: !!(s.IRYS_PRIVATE_KEY && s.STORAGE_PAYMENT_RECEIVER && s.DB), provider: "irys", maxItems: 10000, maxFileBytes: 90 * 1024 * 1024 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
