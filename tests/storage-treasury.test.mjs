import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { BrowserProvider, Wallet, ZeroAddress, parseEther } from "ethers";
import ganache from "ganache";
import { env } from "cloudflare:workers";

await test("Storage treasury setup and deposit recovery", async suite => {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of ["0000_peaceful_avengers.sql", "0001_storage_quotes.sql"])
    sqlite.exec(fs.readFileSync("drizzle/" + file, "utf8").replaceAll("--> statement-breakpoint", ""));
  function prepared(sql, args = []) {
    return { bind(...v) { return prepared(sql, v); }, async first() { return sqlite.prepare(sql).get(...args) || null; },
      async run() { return { success: true, meta: sqlite.prepare(sql).run(...args) }; } };
  }
  env.DB = { prepare: prepared, async batch(statements) { return Promise.all(statements.map(s => s.run())); } };
  const chain = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1 }, wallet: { totalAccounts: 3 } });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const keys = Object.values(chain.getInitialAccounts());
  const treasury = new Wallet(keys[0].secretKey, provider);
  const other = new Wallet(keys[1].secretKey, provider);
  const depositAddress = new Wallet(keys[2].secretKey).address;
  const rpcMethods = [];
  const rpc = http.createServer(async (req, res) => {
    try {
      let raw = ""; for await (const part of req) raw += part;
      const body = JSON.parse(raw); rpcMethods.push(body.method);
      const result = await chain.request({ method: body.method, params: body.params });
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    } catch (e) { res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: e.message } })); }
  });
  await new Promise(r => rpc.listen(0, "127.0.0.1", r));
  env.IRYS_PRIVATE_KEY = treasury.privateKey;
  env.IRYS_NODE_URL = "https://irys.test";
  env.IRYS_GATEWAY_URL = "https://gateway.test";
  env.STORAGE_PAYMENT_RPC = `http://127.0.0.1:${rpc.address().port}`;
  env.STORAGE_PAYMENT_RECEIVER = treasury.address;
  env.IRYS_TOKEN = "ethereum";
  let credit = "0", invalidCredit = false, priceUnavailable = false, loseNotification = false;
  const notifications = [], credited = new Set();
  let routeResponse, routeRequest, routeCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.origin === "https://api-v2.rubic.exchange") {
      routeCalls++;
      assert.equal(u.pathname, "/api/routes/quoteBest");
      routeRequest = JSON.parse(options.body);
      return Response.json(routeResponse);
    }
    if (u.origin !== "https://irys.test") return originalFetch(url, options);
    if (u.pathname === "/info") return Response.json({ addresses: { ethereum: depositAddress, "base-eth": depositAddress } });
    if (u.pathname.startsWith("/price/")) return priceUnavailable ? new Response("Unavailable", { status: 503 }) : Response.json("12345");
    if (u.pathname.startsWith("/account/balance/")) {
      if (options.method === "POST") {
        const { tx_id } = JSON.parse(options.body); notifications.push(tx_id);
        if (loseNotification) {
          loseNotification = false;
          if (!credited.has(tx_id)) { credited.add(tx_id); credit = String(BigInt(credit) + parseEther("0.01")); }
          throw new TypeError("Simulated lost acknowledgement after Irys accepted a hash");
        }
        return new Response("Accepted", { status: 202 });
      }
      return Response.json({ balance: invalidCredit ? 42 : credit });
    }
    throw new Error("Unexpected Irys endpoint " + u.pathname);
  };
  const { default: worker } = await import("../dist/server/index.js");
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  let cookie = "";
  function call(path, body, origin = "https://mintforge.example") {
    return worker.fetch(new Request("https://mintforge.example" + path, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify(body),
    }), { ASSETS: { fetch: () => new Response("", { status: 404 }) } }, ctx);
  }
  const post = body => call("/api/storage-treasury", body);
  async function login(wallet) {
    const challenge = await (await call("/api/upload-auth", { wallet: wallet.address })).json();
    const response = await call("/api/upload-auth", { wallet: wallet.address, nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
  }
  suite.beforeEach(() => sqlite.exec("DELETE FROM upload_quota"));
  suite.after(async () => {
    globalThis.fetch = originalFetch; provider.destroy(); await chain.disconnect();
    await new Promise(r => rpc.close(r)); sqlite.close();
  });

  await suite.test("treasury diagnostics require same-origin and storage-wallet authorization", async () => {
    assert.equal((await post({ action: "status" })).status, 400);
    await login(other);
    let response = await post({ action: "status" }); assert.equal(response.status, 400);
    assert.match((await response.json()).error, /dedicated storage wallet/);
    await login(treasury);
    response = await call("/api/storage-treasury", { action: "status" }, "https://other.example");
    assert.equal(response.status, 400);
    response = await post({ action: "status" }); assert.equal(response.status, 200);
    const text = await response.text(); assert.ok(!text.includes(treasury.privateKey));
    const status = JSON.parse(text);
    assert.equal(status.checks.database.ok, true);
    assert.equal(status.checks.credit.value, "0");
    assert.ok(BigInt(status.checks.wallet.value) > 0n, "wallet ETH must not be mistaken for Irys credit");
    assert.equal(status.chainId, "0x1");
  });
  await suite.test("unavailable pricing, malformed balances and missing migration never become successful checks", async () => {
    invalidCredit = true; priceUnavailable = true;
    sqlite.exec("ALTER TABLE storage_quotes RENAME TO storage_quotes_missing");
    const response = await post({ action: "status" }); const status = await response.json();
    assert.equal(response.status, 200);
    assert.equal(status.checks.database.ok, false);
    assert.equal(status.checks.credit.ok, false); assert.equal(status.checks.credit.value, undefined);
    assert.equal(status.checks.price.ok, false); assert.equal(status.checks.wallet.ok, true);
    sqlite.exec("ALTER TABLE storage_quotes_missing RENAME TO storage_quotes");
    invalidCredit = false; priceUnavailable = false;
  });
  await suite.test("deposit review includes bounded gas, requires funds and detects an RPC on the wrong chain", async () => {
    for (const amount of ["0", "-1", "1e-3", "10000"])
      assert.equal((await post({ action: "prepare", amount })).status, 400);
    const response = await post({ action: "prepare", amount: "0.01" });
    assert.equal(response.status, 200, await response.clone().text());
    const plan = await response.json();
    assert.equal(plan.to, depositAddress); assert.equal(plan.treasury, treasury.address);
    assert.equal(BigInt(plan.maximumTotal), parseEther("0.01") + BigInt(plan.gasPrice) * BigInt(plan.gasLimit));
    env.IRYS_TOKEN = "base-eth";
    const wrong = await post({ action: "prepare", amount: "0.01" });
    assert.equal(wrong.status, 400); assert.match((await wrong.json()).error, /wrong network/);
    env.IRYS_TOKEN = "ethereum";
  });
  await suite.test("notification verifies sender, destination, plain transfer and two confirmations", async () => {
    const wrongs = [
      await treasury.sendTransaction({ to: other.address, value: 1000n }),
      await other.sendTransaction({ to: depositAddress, value: 1000n }),
      await treasury.sendTransaction({ to: depositAddress, value: 1000n, data: "0x1234" }),
    ];
    await chain.request({ method: "evm_mine", params: [] });
    for (const tx of wrongs) {
      const response = await post({ action: "notify", hash: tx.hash });
      assert.equal(response.status, 400); assert.match((await response.json()).error, /not a plain ETH deposit/);
    }
    const deposit = await treasury.sendTransaction({ to: depositAddress, value: parseEther("0.01") });
    await deposit.wait();
    let response = await post({ action: "notify", hash: deposit.hash });
    assert.equal(response.status, 400); assert.match((await response.json()).error, /two network confirmations/);
    assert.equal(notifications.length, 0);
    await chain.request({ method: "evm_mine", params: [] });
    response = await post({ action: "notify", hash: deposit.hash });
    assert.equal(response.status, 200); assert.equal((await response.json()).accepted, true);
    const status = await (await post({ action: "status" })).json();
    assert.equal(status.checks.credit.value, "0", "202 acknowledgement is not credited balance");
    loseNotification = true;
    response = await post({ action: "notify", hash: deposit.hash }); assert.equal(response.status, 400);
    assert.match((await response.json()).error, /do not pay again/);
    response = await post({ action: "notify", hash: deposit.hash }); assert.equal(response.status, 200);
    assert.equal(credit, parseEther("0.01").toString());
    assert.equal(new Set(notifications).size, 1, "recovery must report the same hash");
    assert.equal(rpcMethods.some(method => /send|sign/i.test(method)), false, "server must never sign or broadcast a funding transaction");
  });
  await suite.test("PLS check validates native tokens, exact input and minimum output without returning executable transaction data", async () => {
    routeResponse = {
      tokens: { from: { address: ZeroAddress, blockchainId: "369", decimals: 18, amount: "1000" },
        to: { address: ZeroAddress, blockchainId: "1", decimals: 18 } },
      estimate: { destinationWeiAmount: "10000000000", destinationWeiMinAmount: "9500000000" }, providerType: "test_provider",
      transaction: { to: other.address, data: "0xbadbadbad", value: "1000" },
    };
    let response = await post({ action: "route", amount: "1000" });
    assert.equal(response.status, 200, await response.clone().text());
    const quote = await response.json(); assert.equal(quote.executable, false); assert.equal(quote.transaction, undefined);
    assert.equal(routeRequest.srcTokenBlockchain, "PULSECHAIN"); assert.equal(routeRequest.dstTokenBlockchain, "ETH");
    routeResponse.tokens.to.address = other.address;
    response = await post({ action: "route", amount: "1000" });
    assert.equal(response.status, 400); assert.match((await response.json()).error, /native-PLS to native-ETH/);
    assert.equal(routeCalls, 2);
  });
  await suite.test("invalid treasury secrets are redacted from errors", async () => {
    env.IRYS_PRIVATE_KEY = "invalid-private-key-value";
    const response = await post({ action: "status" }); const text = await response.text();
    assert.equal(response.status, 400); assert.ok(!text.includes(env.IRYS_PRIVATE_KEY));
    assert.match(text, /not a valid wallet private key/);
    env.IRYS_PRIVATE_KEY = treasury.privateKey;
  });
});
