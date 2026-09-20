import { Buffer } from "buffer";
import browserProcess from "process";
import { Wallet } from "ethers";
import type { DataItem } from "@irys/bundles/web";
// Keep signing dependencies out of the initial studio bundle.
const sdk = () => {
  // The upstream browser SDK uses these Node globals. Initialize only when signing,
  // without injecting shims into Cloudflare's server module runner.
  const scope = globalThis as unknown as {Buffer?: typeof Buffer; process?: typeof browserProcess; global?: unknown};
  scope.Buffer ??= Buffer; scope.process ??= browserProcess; scope.global ??= globalThis;
  return import("@irys/bundles/web");
};

export type UploadPart = {path: string; file: File};
export const IRYS_TAGS = [{name: "App-Name", value: "MintForge"}];
export function uploadIdentity() {
  const wallet = Wallet.createRandom();
  return {key: wallet.privateKey, address: wallet.address};
}
export async function signedData(data: Uint8Array | string, key: string, tags: {name: string; value: string}[]) {
  const {EthereumSigner, createData, bundleAndSignData} = await sdk();
  const signer = new EthereumSigner(key);
  const item = createData(typeof data === "string" ? data : Buffer.from(data), signer, {tags});
  await item.sign(signer);
  return item;
}
export async function signedBundle(parts: UploadPart[], key: string) {
  const {EthereumSigner, createData, bundleAndSignData} = await sdk();
  const signer = new EthereumSigner(key);
  const items: DataItem[] = [];
  const ids: Record<string, string> = {};
  // Only the current bounded batch is materialized. No full-collection ZIP or Promise.all.
  for (const part of parts) {
    const item = await signedData(new Uint8Array(await part.file.arrayBuffer()), key, [
      ...IRYS_TAGS, {name: "Content-Type", value: part.file.type || "application/octet-stream"},
    ]);
    items.push(item); ids[part.path] = item.id;
  }
  const bundle = await bundleAndSignData(items, signer);
  const transaction = await signedData(bundle.getRaw(), key, [
    ...IRYS_TAGS, {name: "Bundle-Format", value: "binary"}, {name: "Bundle-Version", value: "2.0.0"},
  ]);
  return {raw: new Uint8Array(transaction.getRaw()), id: transaction.id, ids};
}
export function manifest(paths: Record<string, string>) {
  return {manifest: "irys/paths", version: "0.1.0", paths: Object.fromEntries(Object.entries(paths).map(([name, id]) => [name, {id}]))};
}
