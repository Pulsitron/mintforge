# MintForge

NFT creation, viewing, creator management, fixed-price trading with funded offers, and funded staking for EVM chains. This update starts from `Pulsitron/mintforge` commit `bfe018e`, which is newer than the original attached ZIP.

**Status:** implementation and local tests; no production contracts or storage credentials are included. The contracts have not received an independent audit. Run the complete flow on Sepolia before enabling real-value use. The existing `mintforge.astrognomey.workers.dev` site is not changed by downloading this package.

## Where each feature lives

All six entries stay visible in the studio navigation on desktop and mobile. These routes also work when opened directly or reloaded:

| Feature | Page | Controls |
| --- | --- | --- |
| Create NFT | `/create` | Single file, preview and traits; all six creation steps |
| Collection upload | `/collections/upload` | Batch selection or drag-and-drop; per-item traits; CSV template/import and metadata JSON import |
| View NFT | `/viewer` | Wallet gallery and manual lookup |
| Stake NFTs | `/staking` | Pool selection, positions, claims, withdrawals, pool creation and funding |
| Dashboard | `/dashboard` | Saved draft, collection upload shortcut, mint progress, explorer holder counts, proceeds and collection management |
| Marketplace | `/marketplace` | Browse, My listings & offers, List an NFT; fixed-price and offers-only listings |

Legacy `/#create`, `/#viewer`, `/#stake`, `/#dashboard` and `/#market` links still work. A new `/#collection` link opens batch upload. The in-app `/guide` explains the tools.

Dashboard, Marketplace and Staking keep their workspace controls visible when a network has no deployment. Transaction controls clearly wait for activation; missing statistics display a dash. Holder counts are explorer indexed and may lag; summary counts cover the displayed collections and are not deduplicated across collections. No sample balances or listings are shown as real activity.

The correction also restores saved-draft resumption, marketplace price updates and offers-only listings. If you already deployed the earlier marketplace contract, deploy the updated marketplace and update its address in `public/deployments.json` to enable these two contract additions; existing contracts cannot acquire new methods. Collection CSV import now handles quoted commas, escaped quotes and multiline values. Draft settings persist in this browser; file selections stay in the current tab and need reselecting after a full reload.

## What works after setup

- Creator-owned ERC-721, ERC-1155 and experimental ERC-404 collections through a minimal-proxy factory. Single artwork or up to 10,000 uploaded artworks with 10,000 matching metadata JSON files, native-currency paid/free minting, fixed/open editions, per-wallet limits, scheduled sales, allowlists, display reveals, royalties, collaborator splits, permanent metadata freezing, optional soulbound tokens, and mint-only pausing.
- Public collector mint links at `/mint?chain=369&collection=0x…`. Wallet review, exact payment checks, confirmation tracking, and explorer links.
- Viewer: wallet discovery in batches, manual contract/metadata lookup, image/video/audio/document/interactive media support, animated 3D playback. Discovery depends on public indexers; BNB currently uses manual lookup. Original file types unsupported by the browser remain downloadable.
- Dashboard: saved drafts, on-chain collections, mint progress, explorer holder counts, primary revenue, withdrawable proceeds, price updates, mint pause, reveal, metadata editing/freezing, and loading a collection whose ownership was transferred to you.
- Marketplace: ERC-721 and ERC-1155 fixed-price or offers-only listings, seller price updates, funded native-currency offers, acceptance, cancellation, refunds, expiry, stale-listing checks, ERC-2981 royalty payments, and pull withdrawals. NFTs remain with the seller until purchase.
- Staking: per-pool native or standard ERC-20 rewards, ERC-721/1155 vault custody, full reward reservation at deposit, fixed 1–365 day terms, maturity claims, early exits with a configured penalty on accrued rewards, and NFT return independent of reward-token transfers. Closing deposits cannot block exits. Pool creators may withdraw only unreserved funds after closing a pool.
- Irys: direct browser uploads in bounded bundles, two concurrent small batches, chunked large files, retries, pause/resume and IndexedDB checkpoints. Full metadata imports retain custom fields and numeric traits. Lazy previews avoid decoding 10,000 images. A single metadata manifest/base URI keeps deployment gas independent of the artwork count. Maximum artwork size is 90 MiB; each JSON may be up to 1 MiB, with 128 MiB of JSON in one import. The default quoted collection budget is 200 GiB and is configurable.
- Itemized storage checkout: live Irys price queries include signed data envelopes, metadata and the manifest; a 10% reserve, approval cost and configured service/funding allowance are shown before payment. Native-chain gas estimates are shown separately. A confirmed, wallet-bound payment unlocks an Irys spending approval limited to that upload job. No Irys treasury key goes to the browser.
- ERC-404 uses pinned Pandora v2 source. Whole-token minting, encoded NFT IDs, fractional banking/recycling, royalties and proceeds are integrated. The marketplace and staking vault accept whole ERC-404 NFTs explicitly; fungible balances are not treated as ERC-721 counts.

## First launch on your existing Cloudflare Worker

1. Upload/merge this project into the existing repository used by the `mintforge` Worker. Keep the Worker name and current Cloudflare account.
2. In Cloudflare, create a D1 database named `mintforge-uploads`. Copy its database ID.
3. Set the **build variable** `MINTFORGE_D1_DATABASE_ID` to that ID. Set the build command to `npm run build` and the deploy command to `node scripts/deploy-cloudflare.mjs`. The deploy helper applies the supplied D1 migration, binds it as `DB`, deploys the built Worker named `mintforge`, and preserves existing dashboard variables.
4. Configure a dedicated **Irys treasury** and fund its Irys upload balance using the official Irys tooling. Add its `IRYS_PRIVATE_KEY` as a **server runtime secret**, never a browser variable or a value pasted into chat. This integration targets the current Irys datachain SDK, not an old Bundlr/Arweave endpoint.
5. Set `STORAGE_PAYMENT_RECEIVER`, `IRYS_TOKEN` (`ethereum` or `base-eth`), and `STORAGE_PAYMENT_RPC` for the corresponding funding chain (Ethereum 1 or Base 8453). Set `STORAGE_SERVICE_FEE_WEI` to cover your operational/treasury-funding overhead, or leave zero if you absorb that overhead. Set `COLLECTION_MAX_BYTES` and, during testing, `UPLOAD_ALLOWED_WALLETS`. All variables are documented in `.env.example`. Quotes fail closed if live pricing or the funded treasury is unavailable. Minting can use PulseChain while storage checkout uses ETH on the configured funding chain; the UI explains the wallet network switch.
6. Open `/setup`, select **Sepolia testnet**, connect your creator wallet, review the fee recipient and percentage, and deploy the **six contracts**, including the new ERC-404 template and factory. Existing deployments do not gain these methods automatically. The suggested 1.5% mint fee is editable before deployment. A real storage checkout is independent of Sepolia; use the local mocked-provider tests first and configure a deliberate, small provider acceptance budget before paid testing.
7. Download `deployments.json`, replace `public/deployments.json` with it, and republish. Repeat per network when ready. The setup page keeps a deployment draft in that browser to help resume interrupted setup; export the addresses for your records.
8. Test a small free mint and a paid mint, marketplace sale/offer/refund, and funded staking/withdrawal using separate wallets. Only then repeat the deployment on PulseChain or another supported mainnet.

If you deploy from your computer instead of Workers Builds, use Node 22.13+ and Linux/WSL (the existing build scripts use Bash). Run `npm ci`, `npm run build`, authenticate Wrangler in your own terminal, set `MINTFORGE_D1_DATABASE_ID`, then run `node scripts/deploy-cloudflare.mjs`. The helper stops if the ID is missing; it never deploys the starter's placeholder database ID.

## Creator flow

Upload files and traits, set collection identity, supply, native-token mint price, royalty receiver and collaborators, then review and launch. The wallet first signs an upload authorization without spending funds. The first launch click prepares an itemized quote; the next click approves storage payment. The site verifies two confirmations and the exact chain, sender, receiver, amount and quote ID before granting storage spending. Files then upload directly to Irys, after which the wallet approves collection deployment. If staking is selected, there is a separate pool-creation transaction; fund that pool in Staking before holders deposit. A cancelled pool transaction does not undo an already-deployed collection.

ERC-721 artworks are assigned sequentially and repeat if the supply exceeds the number of files. ERC-1155 supply is **per artwork/token ID**, while the wallet limit is across the collection. Open editions require an end date. The allowlist stays active until the owner opens public minting from the dashboard; this release uses one price and wallet limit for both phases.

Creator proceeds and secondary-sale proceeds are withdrawn from the Dashboard and Marketplace respectively. Accepted offers and cancelled-offer refunds use marketplace withdrawal balances. Staking accrual becomes claimable at maturity, or is credited on early exit after the penalty; withdraw it separately from NFT return. Reward schedules stop at maturity.

## Remaining differences from the reference interface

- The reference site’s draft controls for evolution/redemption, gated content, dedicated staking vaults and wallet-lock staking do **not** have implementations here. Launch rejects these selections; turn them off/use the shared vault. Holder-initiated NFT burning is built into the token contracts, but no replacement asset or external reward is promised.
- Collection-owned means an isolated creator-owned minimal proxy. Shared platform infrastructure does not mean shared ownership. Existing arbitrary NFT contracts can be viewed/traded/staked where compatible; they cannot be edited through this factory's creator dashboard.
- Display reveal hides the normal token URI until reveal, but the metadata references are on-chain and are **not secret**. There is no random assignment/VRF or cryptographic unrevealed mint.
- No auctions, fiat checkout, ERC-20 mint payments or automatic reinvestment. Mint/marketplace revenue fees and the collection storage checkout are separate. Storage checkout proceeds do **not** automatically top up the operator’s Irys balance. Monitor and replenish that dedicated balance. Quotes use conservative byte/price bands, not an exact final provider invoice; unused allowance belongs to the same upload job for 30 days and is not automatically refunded. This policy is shown before payment. Failed late payments require operator reconciliation using the saved transaction and quote IDs.
- Standard ERC-20 reward tokens only: transfer-tax and rebasing assets are unsuitable. NFT contracts with their own transfer restrictions can prevent vault transfers; inspect an external collection before funding its pool.
- The existing Terms page remains a draft. Its custody paragraph now reflects staking and offer escrow; it is not a substitute for legal review.
- Upload keys and funded-wallet testing are absent from this package, so live Irys billing, gateway propagation and end-to-end wallet transactions still require setup. No fake addresses, balances, liquidity or completed transactions are inserted.

## Development and verification

```sh
npm ci
npm run contracts:compile
npm run contracts:test
npm run typecheck
npm run test:interface
npm run test:scale
npm test
npm run dev
```

Contracts use pinned OpenZeppelin 5.4.0, solc 0.8.30, optimizer/viaIR, and Paris EVM output for broad chain compatibility. ABI/bytecode artifacts are committed under `public/contracts`; regenerate after changing Solidity. Each runtime is below the EIP-170 size limit.

The Node artifact loader only supplies an empty `cloudflare:workers` environment for export/render inspection. It does not simulate successful storage operations. Production and previews use Cloudflare's actual runtime bindings.

References: [OpenZeppelin ERC-721](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721), [official Irys SDK](https://github.com/Irys-xyz/js-sdk), [Pandora ERC-404](https://github.com/Pandora-Labs-Org/erc404). The source pins `@irys/bundles` 0.0.5 and follows the Irys SDK price, approval, bundle and chunk protocols. The SDK is loaded only when signing begins. Vendor provenance is recorded in `contracts/vendor/erc404/UPSTREAM.md`.

## Irys and IPFS are different

The creator flow now produces **Irys gateway URLs**, matching the previous provider identified in this conversation. It does not generate IPFS CIDs or silently charge for a second copy. The old `/api/upload` Pinata endpoint remains available only if explicitly configured, but it is not the 10,000-item pipeline. Pinata’s old 500-request/100-MiB limits do not affect direct Irys uploads. An IPFS mirror needs a separate provider, retention policy, capacity quote and implementation.

## Resume and ERC-404 details

- Reselect the same images and metadata in the same browser after interruption. Content hashes identify the job, and completed signed batches, the capped upload key and payment hash are saved before continuing. Changed bytes cannot reuse another file’s receipt. Keep browser data until deployment. Checkpoints are local to that browser, not portable backups.
- A failed or cancelled contract deployment does not discard uploaded files. Continue again to reuse them. The first, last and optional placeholder metadata files must resolve through the gateway before deployment proceeds.
- ERC-404 supports fixed supply of at most 10,000 whole tokens, 18 decimals and encoded NFT IDs greater than `2**255`. It cannot be combined with soulbound/open-edition settings here. A fractional transfer can bank an NFT, and later restore a recycled ID. The ABI exposes separate fungible and NFT balance methods. Wallet discovery may require manual lookup because indexers vary.
- New DEX pools/routers can be marked NFT-transfer-exempt by the collection owner **before** receiving tokens through `setERC721TransferExempt`. The owner cannot use this method on funded accounts. Holders may change their own exemption via the upstream method. Do not assume every DEX is compatible.
- The ERC-404 integration and MintForge contracts have not had an independent security audit. No funds, mainnet deployments or live 10,000-image provider benchmark were performed for this package.

## Verification added for large collections

The scale test imports 10,000 images plus 10,000 JSON files and exercises actual Irys signing against a simulated provider. It interrupts after over 3,000 image acknowledgements, reopens from IndexedDB and verifies no completed batch is uploaded twice. The tiny test fixtures require 101 bundle/manifest requests; real request counts and elapsed time depend on file sizes and uplink throughput. This is a recovery/scale test, not a live bandwidth benchmark.

Contract tests cover 10,000 metadata paths at constant deployment gas, ERC-404 fractional transfers, ID recycling, clone-specific permit domains and whole-NFT trading/staking. Checkout tests use a local EVM and simulated Irys responses to test exact receipt matching, price components, bounded pricing requests and deterministic approval retries. Production treasury funding, current provider acceptance/retention and real-browser network performance must be verified before public launch.

### Verification of the restored interface

React component tests exercise all navigation links, saved-draft access, marketplace tabs and listing-type selection, and pool controls with no wallet and no network configuration. Route tests load every direct feature URL against the built Worker. Contract tests cover offers-only settlement, rejection of free purchases, seller-only price changes and stale buyer quotes, in addition to the original minting, sale and staking checks.

Browser inspection reaches the existing Terms gate on feature routes. It is not automatically accepted by the tests; wallet-funded production transactions and live pinning require the configuration above.

### Browser verification boundary for this update

The supervised preview could not start after two attempts because the Cloudflare development module runner failed. Browser-specific polyfills were subsequently isolated from the server runner and the full production build and API/render tests pass, but an interactive browser signing check was not completed. Verify the production browser uploader with a small funded collection before the 10,000-image acceptance run.
