"use client";
import { useEffect, useState } from "react";
import { ContractFactory, isAddress } from "ethers";
import { chains } from "../../lib/chains";
import {
  artifact,
  ContractName,
  errorText,
  short,
  signer,
} from "../../lib/web3";
import TransactionNotice from "../TransactionNotice";
import StorageSetup from "../StorageSetup";
const order: ContractName[] = [
  "MintForge721",
  "MintForge1155",
  "MintForge404",
  "MintForgeFactory",
  "MintForgeMarket",
  "MintForgeStaking",
];
export default function Setup() {
  const [chainId, setChainId] = useState("0xaa36a7"),
    [wallet, setWallet] = useState(""),
    [recipient, setRecipient] = useState(""),
    [fee, setFee] = useState("1.5"),
    [addresses, setAddresses] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [hash, setHash] = useState("");
  useEffect(() => {
    setAddresses({});
    setMessage("");
    setHash("");
    if (!wallet) return;
    try {
      const saved = JSON.parse(
        localStorage.getItem("mintforge-setup:v2:" + chainId + ":" + wallet) ||
          "null",
      );
      if (saved) {
        setAddresses(saved.addresses || {});
        setRecipient(saved.recipient || wallet);
        setFee(saved.fee || "1.5");
      }
    } catch {}
  }, [chainId, wallet]);
  async function connect() {
    try {
      const s = await signer(chainId);
      const address = await s.getAddress();
      setWallet(address);
      setRecipient(address);
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function deploy(name: ContractName) {
    setBusy(true);
    setHash("");
    try {
      if (
        !isAddress(recipient) ||
        !Number.isFinite(Number(fee)) ||
        Number(fee) < 0 ||
        Number(fee) > 10 ||
        !Number.isInteger(Number(fee) * 100)
      )
        throw new Error(
          "Use a valid fee wallet and a fee between 0 and 10%, with at most two decimals.",
        );
      const s = await signer(chainId, wallet);
      const a = await artifact(name);
      const bps = Math.round(Number(fee) * 100);
      const args =
        name === "MintForgeFactory"
          ? [addresses.MintForge721, addresses.MintForge1155, addresses.MintForge404, recipient, bps]
          : name === "MintForgeMarket"
            ? [recipient, bps]
            : [];
      setMessage(
        "Review " + name + " deployment and the network fee in your wallet.",
      );
      const instance = await new ContractFactory(a.abi, a.bytecode, s).deploy(
        ...args,
      );
      const tx = instance.deploymentTransaction();
      if (tx) setHash(tx.hash);
      setMessage("Waiting for " + name + " deployment…");
      await instance.waitForDeployment();
      const updated = { ...addresses, [name]: await instance.getAddress() };
      setAddresses(updated);
      localStorage.setItem(
        "mintforge-setup:v2:" + chainId + ":" + wallet,
        JSON.stringify({ addresses: updated, recipient, fee }),
      );
      setMessage(
        name + " deployed. Save the addresses before leaving this device.",
      );
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    try {
      const existing = (await (
        await fetch("/deployments.json", { cache: "no-store" })
      ).json()) as { networks?: Record<string, unknown> };
      const merged = {
        version: 1,
        networks: {
          ...existing.networks,
          [String(Number(chainId))]: {
            factory: addresses.MintForgeFactory,
            market: addresses.MintForgeMarket,
            staking: addresses.MintForgeStaking,
          },
        },
      };
      const uri = URL.createObjectURL(
        new Blob([JSON.stringify(merged, null, 2) + "\n"], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = uri;
      a.download = "deployments.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(uri), 1000);
      setMessage(
        "Replace public/deployments.json in your website with this file, then redeploy.",
      );
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  const complete = order.every((n) => addresses[n]);
  const any = Object.keys(addresses).length > 0;
  return (
    <main className="mf-standalone">
      <a className="mf-back" href="/">
        ← MintForge
      </a>
      <span className="section-number">PLATFORM SETUP</span>
      <h1>
        Launch <em>MintForge.</em>
      </h1>
      <p>
        Deploy the platform once per network. Your wallet signs each deployment
        and pays its network fee. Start on Sepolia to test the complete flow.
      </p>
      <section className="settings-card">
        <h2>1. Network and platform fees</h2>
        <div className="mf-form-grid">
          <label>
            Network
            <select
              value={chainId}
              disabled={busy}
              onChange={(e) => setChainId(e.target.value)}
            >
              {chains.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Platform fee wallet
            <input
              disabled={busy || any}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x…"
            />
          </label>
          <label>
            Platform fee (%)
            <input
              disabled={busy || any}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        <p>
          Mint and marketplace fee settings are fixed at deployment. Creator
          royalties are additional on secondary sales.
        </p>
        <button className="mf-button" disabled={busy} onClick={connect}>
          {wallet ? short(wallet) : "Connect deployment wallet"}
        </button>
      </section>
      <section className="settings-card">
        <h2>2. Deploy contracts</h2>
        <p>
          The contracts are source available and have local automated tests.
          They have not received an independent security audit.
        </p>
        {order.map((name, i) => (
          <div className="mf-position" key={name}>
            <div>
              <b>
                {i + 1}. {name.replace("MintForge", "")}
              </b>
              {addresses[name] && (
                <p className="mf-address">{addresses[name]}</p>
              )}
            </div>
            <button
              disabled={
                busy ||
                !wallet ||
                !!addresses[name] ||
                (name === "MintForgeFactory" &&
                  (!addresses.MintForge721 || !addresses.MintForge1155))
              }
              onClick={() => deploy(name)}
            >
              {addresses[name] ? "Deployed" : "Deploy"}
            </button>
          </div>
        ))}
        <TransactionNotice message={message} hash={hash} chainId={chainId} />
        <button
          className="mf-button"
          disabled={!complete || busy}
          onClick={download}
        >
          Download network configuration
        </button>
        <p>
          Replace <code>public/deployments.json</code> in your site with the
          downloaded file and publish the update. The same file can contain all
          supported networks.
        </p>
      </section>
      <StorageSetup />
    </main>
  );
}
