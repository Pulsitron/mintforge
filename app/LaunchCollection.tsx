"use client";
import { useEffect, useRef, useState } from "react";
import {
  isAddress,
  parseEther,
  parseUnits,
  ZeroAddress,
  solidityPackedKeccak256,
  keccak256,
  concat,
  ZeroHash,
  MaxUint256,
  Interface,
  formatEther,
} from "ethers";
import type { Draft, UploadedArtwork, CollectionItem } from "./Studio";
import type { Chain } from "../lib/chains";
import {
  contract,
  deployment,
  errorText,
  confirmed,
  artifact,
  signer,
  rewardInfo,
  reader,
} from "../lib/web3";
import { authorizeUploads } from "../lib/uploads";
import { prepareStorage, quoteStorage, payStorage, runStorage, type StoragePlan } from "../lib/storage-job";
import type { StorageQuote } from "../lib/storage-types";
import type { Metadata } from "../lib/collection-files";
import TransactionNotice from "./TransactionNotice";
export function merkle(addresses: string[]) {
  let leaves = [
    ...new Set(addresses.map((a) => solidityPackedKeccak256(["address"], [a]))),
  ].sort();
  if (!leaves.length) return ZeroHash;
  while (leaves.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < leaves.length; i += 2)
      next.push(
        i + 1 < leaves.length
          ? keccak256(concat([leaves[i], leaves[i + 1]].sort()))
          : leaves[i],
      );
    leaves = next;
  }
  return leaves[0];
}
export default function LaunchCollection({
  draft,
  artwork,
  items,
  placeholder,
  banner,
  chain,
  wallet,
  onConnect,
}: {
  draft: Draft;
  artwork: UploadedArtwork | null;
  items: CollectionItem[];
  placeholder: UploadedArtwork | null;
  banner: UploadedArtwork | null;
  chain: Chain;
  wallet: string;
  onConnect: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [hash, setHash] = useState(""),
    [created, setCreated] = useState("");
  const [ready, setReady] = useState<boolean | null>(null),
    [fee, setFee] = useState("—");
  useEffect(() => {
    let active = true;
    setReady(null);
    setCreated("");
    Promise.all([
      deployment(chain.id),
      fetch("/api/status").then(
        (r) => r.json() as Promise<{ uploads: boolean }>,
      ),
    ])
      .then(async ([d, s]) => {
        if (active) setReady(!!d && s.uploads);
        if (d) {
          const f = await contract("MintForgeFactory", d.factory, chain.id);
          const bps = await f.feeBps();
          if (active) setFee(String(Number(bps) / 100) + "%");
        }
      })
      .catch((e) => {
        if (active) {
          setReady(false);
          setMessage(errorText(e));
        }
      });
    return () => {
      active = false;
    };
  }, [chain.id]);
  const [plan, setPlan] = useState<StoragePlan | null>(null);
  const [quote, setQuote] = useState<StorageQuote | null>(null);
  const [gasEstimate, setGasEstimate] = useState("");
  const [storageGas, setStorageGas] = useState("");
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { setPlan(null); setQuote(null); setGasEstimate(""); }, [draft,items,artwork,placeholder,banner,chain.id,wallet]);
  useEffect(() => () => abort.current?.abort(), []);
  async function launch() {
    if (!wallet) {
      onConnect();
      return;
    }
    setBusy(true);
    abort.current = new AbortController();
    setMessage("Checking collection settings…");
    setHash("");
    try {
      const d = await deployment(chain.id);
      if (!d)
        throw new Error(
          "This network needs contract deployment. Open Launch setup in the dashboard.",
        );
      const uploads =
        draft.itemMode === "collection"
          ? items
          : artwork
            ? [
                {
                  name: artwork.name,
                  url: artwork.url,
                  kind: artwork.kind,
                  traits: draft.traits,
                  file: artwork.file,
                  metadata: undefined as Metadata | undefined,
                  traitsEdited: true,
                },
              ]
            : [];
      if (!uploads.length || uploads.length > 10000)
        throw new Error("Choose between 1 and 10,000 artwork files.");
      if (!draft.collectionName.trim() || !draft.symbol.trim())
        throw new Error("Enter a collection name and symbol.");
      if (draft.existingContractAddress)
        throw new Error(
          "Launch creates a new collection. Manage existing collections from the dashboard.",
        );
      if (draft.burningEnabled || draft.unlockableEnabled)
        throw new Error(
          "Redemption, evolution and gated-content modules are not implemented in this release. Turn those modules off to launch. Holder-initiated burning is built in.",
        );
      if (draft.stakingEnabled && draft.stakeVaultMode === "creator")
        throw new Error(
          "This release uses a shared vault with separate accounting for each reward pool. Choose the shared vault.",
        );
      if (
        draft.stakingEnabled &&
        (draft.soulbound || draft.stakeCustody === "wallet")
      )
        throw new Error(
          "The staking vault requires transferable NFTs. Wallet-lock staking is not supported.",
        );
      if (draft.standard === "ERC-404" && (!riskAccepted || draft.soulbound || draft.mintType === "open" || BigInt(draft.supply) > 10000n))
        throw new Error("ERC-404 requires acknowledging fractional-transfer behavior, transferable tokens and a fixed supply of at most 10,000 whole tokens.");
      const price = parseEther(draft.price || "0");
      if (price < 0n) throw new Error("Mint price cannot be negative.");
      const supply =
        draft.mintType === "open" ? MaxUint256 : BigInt(draft.supply);
      const walletLimit = BigInt(draft.maxPerWallet);
      if (supply < 1n || walletLimit < 1n)
        throw new Error(
          "Supply and wallet limit must be positive whole numbers.",
        );
      const start =
        draft.saleTiming === "scheduled"
          ? Math.floor(new Date(draft.saleStart).getTime() / 1000)
          : 0;
      const end = draft.saleEnd
        ? Math.floor(new Date(draft.saleEnd).getTime() / 1000)
        : 0;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        (end && end <= Math.max(start, Date.now() / 1000))
      )
        throw new Error("Enter a valid future sale window.");
      if (draft.mintType === "open" && !end)
        throw new Error("Open editions need a sale end date.");
      const addresses = draft.allowlist
        ? draft.allowlistAddresses.split(/[\s,;]+/).filter(Boolean)
        : [];
      if (
        draft.allowlist &&
        (!addresses.length || addresses.some((a) => !isAddress(a)))
      )
        throw new Error("The allowlist must contain valid wallet addresses.");
      // Separate allowlist pricing must match the contract configuration, never silently ignore it.
      if (
        draft.allowlist &&
        ((draft.allowlistPrice && parseEther(draft.allowlistPrice) !== price) ||
          (draft.allowlistPerWallet &&
            BigInt(draft.allowlistPerWallet) !== walletLimit))
      )
        throw new Error(
          "This release uses the same price and wallet limit during the allowlist phase. Set matching values.",
        );
      const payees = [wallet],
        bps = [10000];
      if (draft.primarySplitEnabled) {
        let total = 0;
        for (const c of draft.collaborators) {
          const share = Math.round(c.percent * 100);
          if (
            !isAddress(c.address) ||
            share <= 0 ||
            !Number.isInteger(c.percent * 100)
          )
            throw new Error("Check each collaborator address and share.");
          payees.push(c.address);
          bps.push(share);
          total += share;
        }
        if (total >= 10000 || payees.length > 10)
          throw new Error(
            "Creator must retain a share; maximum 9 collaborators.",
          );
        bps[0] -= total;
      }
      const royalty = draft.royaltyEnabled
        ? draft.royaltyReceiver || wallet
        : wallet;
      if (!isAddress(royalty))
        throw new Error("Enter a valid royalty receiver.");
      if (draft.delayedReveal && !placeholder)
        throw new Error("Choose placeholder artwork for delayed reveal.");
      let revealAt = 0;
      if (draft.delayedReveal && draft.revealMode === "scheduled") {
        revealAt = Math.floor(new Date(draft.revealDate).getTime() / 1000);
        if (!Number.isFinite(revealAt) || revealAt <= Date.now() / 1000)
          throw new Error("Choose a future reveal time.");
      }
      let stakingTerms: {
        token: string;
        daily: bigint;
        duration: number;
        penalty: number;
      } | null = null;
      if (draft.stakingEnabled) {
        const token =
          draft.stakeRewardType === "native" ? ZeroAddress : draft.rewardToken;
        if (!isAddress(token)) throw new Error("Enter a valid reward token.");
        const info = await rewardInfo(token, chain.id);
        const daily = parseUnits(draft.rewardRate, info.decimals);
        const duration = Number(draft.minimumLock) * 86400;
        const penalty = Math.round(Number(draft.exitPenalty) * 100);
        if (
          daily <= 0n ||
          !Number.isInteger(duration) ||
          duration < 86400 ||
          duration > 365 * 86400 ||
          penalty < 0 ||
          penalty > 10000
        )
          throw new Error(
            "Check the reward rate, 1–365 day duration, and early exit penalty.",
          );
        stakingTerms = { token, daily, duration, penalty };
      }
      await signer(chain.id, wallet);
      const media = uploads.map((a,i) => ({path: `media/${i+1}`, file: a.file}));
      if (banner) media.push({path:"banner",file:banner.file});
      if (draft.delayedReveal && placeholder) media.push({path:"placeholder",file:placeholder.file});
      if (addresses.length) media.push({path:"allowlist",file:new File([JSON.stringify({addresses})],"allowlist.json",{type:"application/json"})});
      const render = (uris: Record<string,string>) => {
        const files = uploads.map((a,i) => {
          const imported = a.metadata || {};
          const previousProperties = imported.properties && typeof imported.properties === "object" && !Array.isArray(imported.properties) ? imported.properties as Metadata : {};
          const attributes = !a.traitsEdited && Array.isArray(imported.attributes) ? imported.attributes : a.traits
            .filter(t=>t.trait_type.trim() && t.value.trim()).map(t=>{
              const original = Array.isArray(imported.attributes) ? imported.attributes.find(a=>a && a.trait_type === t.trait_type) : undefined;
              const value = typeof original?.value === "number" && Number.isFinite(Number(t.value)) ? Number(t.value) : t.value;
              return {...original,trait_type:t.trait_type,value};
            });
          const previousFiles = Array.isArray(previousProperties.files) ? previousProperties.files : [];
          const metadata = {
            ...imported,
            name: imported.name ?? (draft.itemMode === "single" ? draft.name || a.name : a.name.replace(/\.[^.]+$/, "")),
            description: imported.description ?? (draft.description || draft.collectionDescription),
            external_url: imported.external_url ?? (draft.externalUrl || draft.socialWebsite || undefined),
            [a.kind === "image" ? "image" : "animation_url"]: uris[`media/${i+1}`],
            attributes,
            properties: {...previousProperties, files:[{...(previousFiles[0] && typeof previousFiles[0] === "object" ? previousFiles[0] : {}),uri:uris[`media/${i+1}`],type:a.file.type || "application/octet-stream"},...previousFiles.slice(1)], category:previousProperties.category ?? draft.category,
              banner:uris.banner || previousProperties.banner, links:previousProperties.links ?? {twitter:draft.socialTwitter,discord:draft.socialDiscord,telegram:draft.socialTelegram,facebook:draft.socialFacebook,website:draft.socialWebsite}},
            mintforge_allowlist_uri: uris.allowlist,
          };
          return new File([JSON.stringify(metadata)],`${i+1}.json`,{type:"application/json"});
        });
        if (uris.placeholder) files.push(new File([JSON.stringify({name:draft.collectionName+" — unrevealed",image:uris.placeholder,mintforge_allowlist_uri:uris.allowlist})],"placeholder.json",{type:"application/json"}));
        return files;
      };
      let prepared = plan;
      if (!prepared) {
        setMessage("Checking files and saving a resumable upload plan…");
        prepared = await prepareStorage(media,render,uploads.length,wallet,setMessage);
        setPlan(prepared);
      }
      let placeholderURI = "";
      setMessage("Review the collection deployment in your wallet.");
      const factory = await contract(
        "MintForgeFactory",
        d.factory,
        chain.id,
        true,
        wallet,
      );
      const c = {
        name: draft.collectionName,
        symbol: draft.symbol,
        price,
        supply,
        walletLimit,
        start,
        end,
        royaltyReceiver: royalty,
        royaltyBps: draft.royaltyEnabled
          ? Math.round(draft.royaltyPercent * 100)
          : 0,
        allowlistRoot: merkle(addresses),
        placeholder: placeholderURI,
        revealAt,
        soulbound: draft.soulbound,
        pausable: draft.pausable,
        frozen: draft.freezeMetadata,
      };
      const kind = draft.standard === "ERC-404" ? 404 : draft.standard === "ERC-1155" ? 1155 : 721;
      if (!quote) {
        const estimatedBase = "https://gateway.irys.xyz/" + "x".repeat(48) + "/";
        const gas = await factory.createCollectionBase.estimateGas(kind,{...c,placeholder:draft.delayedReveal ? estimatedBase+"placeholder.json" : ""},estimatedBase,uploads.length,payees,bps);
        const fees = await reader(chain.id).getFeeData();
        setGasEstimate(formatEther(gas * (fees.maxFeePerGas || fees.gasPrice || 0n)));
        setMessage("Authorize the storage quote in your wallet. This signature does not spend funds.");
        await authorizeUploads(chain.id,wallet);
        const quoted = await quoteStorage(prepared);
        const paymentReader = reader(quoted.paymentChain);
        const [paymentGas,paymentFees] = await Promise.all([
          paymentReader.estimateGas({from:wallet,to:quoted.recipient,value:BigInt(quoted.total),data:quoted.data}),paymentReader.getFeeData(),
        ]);
        setStorageGas(formatEther(paymentGas * (paymentFees.maxFeePerGas || paymentFees.gasPrice || 0n)));
        setQuote(quoted);
        setMessage(prepared.job.payment ? "Found your saved storage payment. Continue to resume without paying again." : "Review the itemized storage quote and estimated network fees, then continue.");
        return;
      }
      await authorizeUploads(chain.id,wallet);
      await payStorage(prepared,wallet,setMessage);
      setUploading(true);
      const base = await runStorage(prepared,setMessage,abort.current!.signal);
      setUploading(false);
      setMessage("Checking that the first and last metadata files resolve before deployment…");
      for (const name of new Set(["1.json",`${uploads.length}.json`,...(draft.delayedReveal ? ["placeholder.json"] : [])])) {
        const response = await fetch("/api/nft",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uri:base+name})});
        if (!response.ok) throw new Error("Files are saved, but the Irys gateway is still indexing the collection. Continue again in a moment; the saved uploads and payment will be reused.");
      }
      placeholderURI = draft.delayedReveal ? base+"placeholder.json" : "";
      setMessage("Files are saved. Review collection deployment and the current network fee in your wallet.");
      const mintFactory = await contract("MintForgeFactory",d.factory,chain.id,true,wallet);
      const tx = await mintFactory.createCollectionBase(kind,{...c,placeholder:placeholderURI},base,uploads.length,payees,bps);
      setHash(tx.hash);
      setMessage("Waiting for collection deployment…");
      const receipt = await tx.wait(1);
      if (receipt?.status !== 1) throw new Error("Deployment failed.");
      const iface = new Interface((await artifact("MintForgeFactory")).abi);
      let address = "";
      for (const log of receipt.logs) {
        try {
          const event = iface.parseLog(log);
          if (event?.name === "CollectionCreated")
            address = event.args.collection;
        } catch {}
      }
      if (!address)
        throw new Error(
          "Deployment confirmed. Open the dashboard to retrieve the collection address.",
        );
      setCreated(address);
      if (stakingTerms) {
        try {
          setMessage(
            "Collection deployed. Review creation of its staking pool in your wallet.",
          );
          const v = await contract(
            "MintForgeStaking",
            d.staking,
            chain.id,
            true,
            wallet,
          );
          await confirmed(
            v.createPool(
              address,
              stakingTerms.token,
              stakingTerms.daily,
              stakingTerms.duration,
              stakingTerms.penalty,
              draft.standard === "ERC-1155",
            ),
            setHash,
          );
          setMessage(
            "Collection and staking pool deployed. Fund the pool in Staking to enable deposits.",
          );
        } catch (e) {
          setMessage(
            "Your collection was deployed, but the staking pool was not created: " +
              errorText(e) +
              " Create it from Staking when ready.",
          );
        }
      } else
        setMessage("Collection deployed. Share the mint page with collectors.");
    } catch (e) {
      setMessage(abort.current?.signal.aborted ? "Upload paused. Progress is saved. Reselect the same files and metadata after reopening to resume." : errorText(e));
    } finally {
      setUploading(false);
      setBusy(false);
    }
  }
  return (
    <aside className="launch-panel">
      <span className="rail-label">LAUNCH COLLECTION</span>
      <h3>Publish your drop</h3>
      <p>
        Your artwork and metadata go to Irys. Your wallet owns the collection
        contract.
      </p>
      <dl className="mf-details">
        <div>
          <dt>Mint fee</dt>
          <dd>{fee}</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>Quoted by wallet</dd>
        </div>
        <div>
          <dt>ERC-1155 supply</dt>
          <dd>Per artwork</dd>
        </div>
      </dl>
      <p className="field-hint">
        Uploads resume on this browser after you reselect the same files. Keep this browser’s saved data until the collection is deployed. Staking rewards require a funded pool.
      </p>
      {ready === false && (
        <p className="mf-warning">
          Contracts or Irys storage still need setup on this network.{" "}
          <a href="/setup">Open launch setup</a>
        </p>
      )}
      {draft.standard === "ERC-404" && <label className="mf-warning"><input type="checkbox" checked={riskAccepted} onChange={e=>setRiskAccepted(e.target.checked)} /> I understand ERC-404 is experimental: fractional transfers may bank or restore NFT IDs, and wallet/indexer support varies.</label>}
      {quote && <section className="settings-card" aria-label="Collection quote"><h4>Collection quote · Irys</h4><dl className="mf-details">
        <div><dt>Storage budget, including metadata and manifest</dt><dd>{formatEther(BigInt(quote.storage))} ETH</dd></div>
        <div><dt>Price / recovery reserve (10%)</dt><dd>{formatEther(BigInt(quote.reserve))} ETH</dd></div>
        <div><dt>Upload approval</dt><dd>{formatEther(BigInt(quote.approvalCost))} ETH</dd></div>
        <div><dt>Service and treasury funding allowance</dt><dd>{formatEther(BigInt(quote.service))} ETH</dd></div>
        <div><dt>Storage checkout total</dt><dd>{formatEther(BigInt(quote.total))} ETH</dd></div>
        <div><dt>Storage payment gas estimate</dt><dd>{storageGas || "—"} ETH</dd></div>
        <div><dt>Collection deployment gas estimate</dt><dd>{gasEstimate || "—"} {chain.native}</dd></div>
      </dl><p className="field-hint">Storage checkout uses {quote.paymentChain === "0x1" ? "Ethereum" : "Base"}. Quote expires {new Date(quote.expires).toLocaleTimeString()}. Storage allowance is capped and valid for 30 days; unused allowance remains with this upload job until expiry and is not automatically refunded. Network gas is variable and confirmed by your wallet. Optional staking pool creation and reward funding are separate transactions. This creates Irys URLs; an IPFS copy is not included.</p>
        {plan?.job.payment && <p className="field-hint">Saved storage payment: {plan.job.payment}</p>}
        {!busy && !plan?.job.payment && <button type="button" className="secondary-action" onClick={()=>{if(plan) plan.job.quote=undefined;setQuote(null);setMessage("Request a fresh quote before continuing.");}}>Refresh unpaid quote</button>}
      </section>}
      {uploading && <button type="button" className="secondary-action" onClick={()=>abort.current?.abort()}>Pause uploads</button>}
      <button
        className="launch-button"
        disabled={busy || ready !== true || !!created}
        onClick={launch}
      >
        {busy
          ? "Working…"
          : wallet
            ? quote ? "Approve quote & continue" : "Get collection quote"
            : "Connect wallet"}
      </button>
      <TransactionNotice message={message} hash={hash} chainId={chain.id} />
      {created && (
        <a
          className="mf-button"
          href={`/mint?chain=${Number(chain.id)}&collection=${created}`}
        >
          Open collector mint page ↗
        </a>
      )}
    </aside>
  );
}
