import {
  digest,
  jsonError,
  quota,
  sameOrigin,
  settings,
  uploadSession,
} from "../../../lib/server";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const s = settings();
    if (!s.PINATA_JWT) throw new Error("IPFS uploads are not configured yet.");
    const session = await uploadSession(req);
    const type = req.headers.get("content-type") || "";
    if (!type.startsWith("multipart/form-data;") || !req.body)
      throw new Error("A file upload is required.");
    const declared = Number(req.headers.get("x-upload-size"));
    if (
      !Number.isSafeInteger(declared) ||
      declared < 1 ||
      declared > 90 * 1024 * 1024
    )
      throw new Error("Files must be between 1 byte and 90 MB.");
    const day = Math.floor(Date.now() / 86400000);
    const ip = await digest(req.headers.get("cf-connecting-ip") || "local");
    const cap = Number(s.UPLOAD_MAX_BYTES_PER_DAY || 104857600);
    if (!Number.isSafeInteger(cap) || cap < 1)
      throw new Error("Upload quota is not configured correctly.");
    await quota(`files:${day}:${ip}`, 1, 500);
    await quota(`bytes:${day}:global`, declared + 65536, cap);
    await quota(`wallet:${day}:${session.wallet}`, declared + 65536, cap);
    let received = 0;
    const limited = req.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > declared + 65536)
            throw new Error("Upload exceeds declared size.");
          controller.enqueue(chunk);
        },
      }),
    );
    const response = await fetch(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${s.PINATA_JWT}`,
          "Content-Type": type,
        },
        body: limited,
        signal: AbortSignal.timeout(120000),
        duplex: "half",
      } as RequestInit,
    );
    if (!response.ok)
      throw new Error(
        "IPFS upload failed. Check the storage account and try again.",
      );
    const data = (await response.json()) as { IpfsHash?: string };
    if (!data.IpfsHash || !/^([A-Za-z0-9]{40,100})$/.test(data.IpfsHash))
      throw new Error("Storage returned an invalid content address.");
    return Response.json(
      { uri: "ipfs://" + data.IpfsHash },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
