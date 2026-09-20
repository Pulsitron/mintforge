import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { create, act } from "react-test-renderer";

await test("Funding UI saves a deposit and resumes notification without sending again", async t => {
  const temporary = await mkdtemp(new URL("../.ui-test-", import.meta.url).pathname);
  const file = temporary + "/setup.mjs";
  await build({ entryPoints: ["app/StorageSetup.tsx"], outfile: file, bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
    plugins: [{ name: "wallet-test-double", setup(builder) {
      builder.onResolve({ filter: /\/lib\/(web3|uploads)$/ }, args => ({ path: args.path, namespace: "test-wallet" }));
      builder.onLoad({ filter: /.*/, namespace: "test-wallet" }, () => ({ contents: "export const signer = async () => globalThis.mintforgeTestWallet; export const errorText = e => e.message; export const authorizeUploads = async () => {};", loader: "js" }));
    } }] });
  const Setup = (await import(pathToFileURL(file).href)).default;
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  const saved = new Map();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.localStorage = { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) };
  const treasury = "0x" + "11".repeat(20), destination = "0x" + "22".repeat(20), hash = "0x" + "ab".repeat(32);
  let sends = 0, notifications = 0;
  globalThis.mintforgeTestWallet = { getAddress: async () => treasury, sendTransaction: async tx => {
    sends++; assert.equal(tx.to, destination); assert.equal(tx.value, 10000000000000000n);
    assert.equal(tx.chainId, 1n); assert.equal(tx.gasPrice, 2000000000n); return { hash };
  } };
  const status = { treasury, receiver: treasury, chainId: "0x1", chainName: "Ethereum mainnet", token: "ethereum", endpoint: "https://irys.test", checkedAt: Date.now(),
    checks: { database: { ok: true, message: "Database available" }, wallet: { ok: true, value: "100000000000000000", message: "Wallet funded" },
      credit: { ok: true, value: "0", message: "No upload credit" }, price: { ok: true, value: "1000", message: "Price available" } } };
  const plan = { treasury, chainId: "0x1", token: "ethereum", endpoint: "https://irys.test", to: destination, value: "10000000000000000",
    gasLimit: "25200", gasPrice: "2000000000", maximumNetworkFee: "50400000000000", maximumTotal: "10050400000000000", expires: Date.now() + 120000 };
  globalThis.fetch = async (url, init) => {
    if (url === "/api/status") return Response.json({ uploads: true, storageChain: "0x1" });
    assert.equal(url, "/api/storage-treasury");
    const body = JSON.parse(init.body);
    if (body.action === "status") return Response.json(status);
    if (body.action === "prepare") return Response.json(plan);
    if (body.action === "notify") { assert.equal(body.hash, hash); notifications++; return Response.json({ message: "Notification accepted; check credit." }); }
    throw new Error("Unexpected API action");
  };
  const textOf = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(textOf).join("") : node?.children?.map(textOf).join("") || "";
  let renderer;
  const button = name => renderer.root.findAllByType("button").find(node => textOf(node).trim() === name);
  const click = async name => { await act(async () => button(name).props.onClick()); };
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
    delete globalThis.mintforgeTestWallet; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    await rm(temporary, { recursive: true, force: true });
  });
  await act(async () => { renderer = create(React.createElement(Setup)); });
  await click("Connect storage wallet & check");
  assert.equal(sends, 0);
  assert.match(textOf(renderer.toJSON()), /Automatic PLS checkout is installed but disabled/);
  const input = renderer.root.findAllByType("input")[0];
  await act(async () => input.props.onChange({ target: { value: "0.01" } }));
  await click("Review deposit and fee"); assert.equal(sends, 0);
  await act(async () => {
    const send = button("Send deposit · approve in wallet").props.onClick;
    await Promise.all([send(), send()]);
  });
  assert.equal(sends, 1); assert.ok([...saved.values()].includes(hash));
  await act(async () => renderer.unmount()); renderer = undefined;
  await act(async () => { renderer = create(React.createElement(Setup)); });
  await click("Connect storage wallet & check");
  assert.equal(button("Review deposit and fee").props.disabled, true);
  assert.equal(renderer.root.findAllByType("input")[1].props.value, hash);
  await click("Check deposit notification");
  await click("Retry deposit notification");
  assert.equal(sends, 1); assert.equal(notifications, 2);
});
