import { signer } from "./web3";
export async function authorizeUploads(chainId: string, wallet: string) {
  const first = await fetch("/api/upload-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const challenge = (await first.json()) as {
    error?: string;
    message: string;
    nonce: string;
  };
  if (!first.ok) throw new Error(challenge.error);
  const signature = await (
    await signer(chainId, wallet)
  ).signMessage(challenge.message);
  const r = await fetch("/api/upload-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, nonce: challenge.nonce, signature }),
  });
  const result = (await r.json()) as { error?: string; uri: string };
  if (!r.ok) throw new Error(result.error);
}
export async function upload(file: File) {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/upload", {
    method: "POST",
    headers: { "x-upload-size": String(file.size) },
    body: form,
  });
  const result = (await r.json()) as { error?: string; uri: string };
  if (!r.ok) throw new Error(result.error || "Upload failed.");
  return result.uri as string;
}
export async function uploadJson(data: unknown, name = "metadata.json") {
  return upload(
    new File([JSON.stringify(data)], name, { type: "application/json" }),
  );
}
