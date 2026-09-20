import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { create, act } from "react-test-renderer";

// Exercise the actual components with React, including their unconfigured-network effects.
// These isolated tests do not render or accept the production Terms gate.
const temporary = await mkdtemp(new URL("../.ui-test-", import.meta.url).pathname);
const output = temporary + "/components.mjs";
await build({
  stdin: {
    contents: `export { default as Dashboard } from "./app/CreatorDashboard";
      export { default as Marketplace } from "./app/Marketplace";
      export { default as Staking } from "./app/NftStaking";
      export { default as Navigation } from "./app/StudioNavigation";
      export * from "./lib/studio-navigation";
      export * from "./lib/collection-import";`,
    resolveDir: new URL("..", import.meta.url).pathname,
    loader: "tsx",
  },
  outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
});
const ui = await import(pathToFileURL(output).href);
await test("MintForge interface parity", async (suite) => {
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async (url) => {
  assert.equal(url, "/deployments.json", "Unconfigured workspaces must not attempt contract calls");
  return Response.json({ version: 1, networks: {} });
};
globalThis.localStorage = { getItem: () => JSON.stringify({ collectionName: "My collection", itemMode: "collection", standard: "ERC-721", stakingEnabled: true }) };
suite.after(async () => {
  globalThis.fetch = originalFetch;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  await rm(temporary, { recursive: true, force: true });
});
const chain = { id: "0x171", name: "PulseChain", native: "PLS", mark: "P", colour: "#18d99b", explorer: "https://scan.pulsechain.com", rpc: "https://rpc.pulsechain.com" };
const textOf = (node) => typeof node === "string" ? node : Array.isArray(node) ? node.map(textOf).join("") : node?.children?.map(textOf).join("") || "";
const button = (renderer, name) => renderer.root.findAllByType("button").find((node) => textOf(node).trim() === name);

await suite.test("all six tools have reloadable URLs and legacy hashes resolve to the right workspace", async () => {
  let selected, renderer;
  await act(async () => { renderer = create(React.createElement(ui.Navigation, { active: "collection", onNavigate: (value) => { selected = value; } })); });
  const anchors = renderer.root.findAllByType("a");
  assert.deepEqual(anchors.map((node) => node.props.href), ["/create", "/collections/upload", "/viewer", "/staking", "/dashboard", "/marketplace"]);
  assert.equal(anchors[1].props["aria-current"], "page");
  let prevented = false;
  await act(async () => { anchors[5].props.onClick({ button: 0, preventDefault() { prevented = true; } }); });
  assert.equal(prevented, true); assert.equal(selected, "market");
  for (const destination of ui.studioDestinations) {
    assert.equal(ui.destinationFromLocation(destination.href, ""), destination.id);
    assert.equal(ui.destinationFromLocation("/", "#" + destination.id), destination.id);
  }
  await act(async () => renderer.unmount());
});
await suite.test("dashboard retains saved drafts, collection upload and metrics without a wallet or deployment", async () => {
  let renderer, edited = false, uploaded = false;
  await act(async () => { renderer = create(React.createElement(ui.Dashboard, { chain, wallet: "", onConnectWallet() {}, onEditDraft() { edited = true; }, onCreateCollection() { uploaded = true; }, onManageStaking() {} })); });
  const content = textOf(renderer.toJSON());
  assert.match(content, /My collection/);
  assert.match(content, /MINTED · THIS PAGE/);
  assert.match(content, /HOLDERS · THIS PAGE/);
  assert.match(content, /awaiting activation/);
  await act(async () => button(renderer, "Continue editing draft →").props.onClick());
  await act(async () => button(renderer, "Upload a collection →").props.onClick());
  assert.equal(edited, true); assert.equal(uploaded, true);
  await act(async () => renderer.unmount());
});
await suite.test("marketplace tabs and fixed/offer-only listing form remain accessible before activation", async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(ui.Marketplace, { chain, wallet: "", onConnectWallet() {} })); });
  assert.ok(button(renderer, "Browse"));
  assert.ok(button(renderer, "My listings & offers"));
  await act(async () => button(renderer, "List an NFT").props.onClick());
  assert.ok(button(renderer, "Fixed price"));
  await act(async () => button(renderer, "Accept offers only").props.onClick());
  assert.equal(button(renderer, "Approve & accept offers").props.disabled, true);
  assert.match(textOf(renderer.toJSON()), /Set your listing/);
  await act(async () => button(renderer, "My listings & offers").props.onClick());
  assert.ok(button(renderer, "My listings"));
  await act(async () => button(renderer, "Offers I made").props.onClick());
  assert.match(textOf(renderer.toJSON()), /No offers yet/);
  await act(async () => renderer.unmount());
});
await suite.test("staking workspace retains pool setup while transactions stay disabled before activation", async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(ui.Staking, { chain, wallet: "", onConnectWallet() {} })); });
  assert.match(textOf(renderer.toJSON()), /Choose a staking pool/);
  assert.match(textOf(renderer.toJSON()), /Create a reward pool/);
  assert.equal(button(renderer, "Create pool").props.disabled, true);
  await act(async () => renderer.unmount());
});
await suite.test("collection CSV matches quoted filenames and preserves commas, newlines, escaped quotes and zero traits", () => {
  const source = '\uFEFFfilename,Background,Quote,Level\r\n"art, 1.png","Blue, green","He said ""hello""",0\r\n2.png,"Line 1\nLine 2",,\r\n';
  const { byFilename, rowCount } = ui.parseTraitCsv(source);
  assert.equal(rowCount, 2);
  assert.deepEqual(byFilename.get("art, 1.png"), [
    { trait_type: "Background", value: "Blue, green" },
    { trait_type: "Quote", value: 'He said "hello"' },
    { trait_type: "Level", value: "0" },
  ]);
  assert.equal(byFilename.get("2.png")[0].value, "Line 1\nLine 2");
  const template = ui.traitCsvTemplate(['art, 1.png', 'my "art".png']);
  assert.deepEqual([...ui.parseTraitCsv(template).byFilename.keys()], ['art, 1.png', 'my "art".png']);
  assert.throws(() => ui.parseTraitCsv('filename,Eyes\n"broken,Blue'), /not closed/);
  assert.throws(() => ui.parseTraitCsv('filename,Eyes\n1.png,Blue\n1.png,Red'), /more than once/);
});

});
