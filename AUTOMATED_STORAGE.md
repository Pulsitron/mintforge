# Automated PLS storage checkout

Implemented in this package; **not deployed or publicly enabled**. No real customer payment, mainnet bridge transfer or live Irys deposit was made during development. The build, local chain tests and browser-state tests are different from a funded provider acceptance test.

## What the customer and operator do

The creator reviews an itemized quote and approves one PLS payment on PulseChain. MintForge uses that payment to buy WETH on PulseX, bridge through LibertySwap, fund Irys on Ethereum or Base, and authorize the upload. The creator pays their initial wallet transaction gas as well. Collection deployment remains a separate wallet approval and gas charge.

The operator does not manually swap tokens, top up Irys, or advance transaction fees in this mode. Each collection has its own server-controlled payment wallet and Irys credit. All spending comes from the creator's payment. The existing storage secret derives those wallets; **keep that secret unchanged and keep the database**. The original storage wallet can receive the configured service fee but is not a shared source of funding for these jobs.

This automates normal processing, retries and supported refunds. It does not guarantee that every third-party outage, lost key, changed contract or stuck bridge can recover without intervention. Cloudflare, RPC and other operating costs still exist. A configured service fee can contribute to them; choosing zero does not make hosting free.

## Deploy on the existing MintForge Worker

1. Extract `MintForge-GitHub-Ready.zip`. Upload or merge the contents of its project folder into the existing `Pulsitron/mintforge` repository. Keep the project files at the repository root, not inside another nested folder. The ZIP intentionally omits `public/deployments.json` so uploading this update preserves your existing contract addresses. Do not delete that file from the repository. GitHub browser uploads may need separate batches for the root files and code folders.
2. Keep the existing D1 database `mintforge-uploads`. Its ID from the successful deployment is `88f2b8c6-d679-4129-81ce-5ff294c1b3f5`. Keep that as the **build variable** `MINTFORGE_D1_DATABASE_ID`.
3. Keep the build command `chmod +x scripts/*.sh && npm run build` and deploy command `node scripts/deploy-cloudflare.mjs`. The deployment helper applies all migrations, including `0002_pls_settlements.sql`, and installs the once-per-minute scheduled payment worker. The build token needs D1 Edit and Worker deployment permissions. Do not run only `npx wrangler deploy` for this update.
4. Keep the existing **runtime secret** `IRYS_PRIVATE_KEY`. Do not upload a real `.env` file. Set or check the runtime variables below in **Workers & Pages → mintforge → Settings → Variables and Secrets**.
5. Deploy and confirm the build log reports successful migrations and a scheduled trigger. `/setup` should say that automatic PLS checkout is installed but disabled. Existing ETH checkout still requires its original treasury credit while the PLS flag is off.
6. For the first funded test, set `UPLOAD_ALLOWED_WALLETS` to just the chosen test wallet's public address, then set `PLS_CHECKOUT_ENABLED=true`. Other wallets cannot authorize new upload jobs. Keep the allowlist during testing. Already-paid jobs continue if you later turn the flag off.
7. Complete the acceptance procedure below. Remove the allowlist only after the funded route, upload and refunds have been verified. If payment processing fails, turn new checkout off and retain the job IDs, database and secret; do not send a second payment.

| Runtime setting | Value / purpose |
| --- | --- |
| `IRYS_PRIVATE_KEY` | Existing encrypted secret. Derives payment wallets; never exposed to browsers. |
| `STORAGE_PAYMENT_RECEIVER` | `0x2729280acd1454F4Be448dDD021878e3D2d9b7DC`, if this remains your intended service-fee wallet. |
| `IRYS_TOKEN` | Keep `ethereum` for the initial test. `base-eth` is also implemented but requires its own matching RPC and acceptance run. |
| `STORAGE_PAYMENT_RPC` | Ethereum RPC for `ethereum`; Base RPC for `base-eth`. Defaults are provided when absent. Do not change networks while jobs remain open. |
| `PLS_RPC_URL` | `https://rpc.pulsechain.com`, or a reliable PulseChain RPC. |
| `PLS_CHECKOUT_ENABLED` | Initially `false`; `true` with a restricted test wallet for acceptance. |
| `UPLOAD_ALLOWED_WALLETS` | Comma-separated allowed creator addresses during testing. Include the storage wallet if using its manual setup tools. |
| `STORAGE_SERVICE_FEE_WEI` | Fixed operating fee in ETH wei per collection, default `0`. Conversion and transaction budgets are calculated separately. |
| `PLS_SLIPPAGE_BPS` | `100` means a maximum 1% increase in the PLS needed for the PulseX trade. Allowed range: 10–200. |
| `IRYS_NODE_URL` / `IRYS_GATEWAY_URL` | Default `https://uploader.irys.xyz` / `https://gateway.irys.xyz`. This targets the Irys datachain uploader, not a legacy Bundlr endpoint. |

The database migration adds tables; it does not delete existing quotes or uploads. The deployment helper preserves existing dashboard runtime variables with `keep_vars`. Keys and RPC credentials are not put into the browser quote.

## What is in the quote

- Irys storage budget for artwork, metadata, signed envelopes and manifest, plus the existing 10% price/retry allowance.
- Upload approval cost and the configured MintForge service fee.
- LibertySwap's quoted fee, included once in the converted amount.
- PulseX's quoted input, which already includes its trading fee, plus the explicit PLS price-movement allowance.
- PulseChain gas for the swap, approval, bridge and possible refunds.
- ETH gas for the Irys deposit, service payment if nonzero, and surplus return. Base quotes also include a bounded L1 data-fee allowance.
- The creator's initial payment gas estimate and separate collection-deployment gas estimate.

The live bridge quote currently requires **at least 0.01 WETH**, even when storage costs less. On 2026-09-20, 0.01 WETH quoted 0.00995 native ETH after the 0.5% LibertySwap fee. This is a dated observation, not a fixed exchange promise. Every new quote checks current availability and prices.

The minimum is disclosed as converted funds, not described as consumed storage. After funding Irys and paying any service fee, unused ETH is returned to the creator on Ethereum or Base. Unused PLS is returned on PulseChain. Transfer costs are deducted; balances below the transfer cost remain in the job wallet. A failure after swapping but before bridging can return WETH on PulseChain. The code does not perform a second bridge to return all currencies as PLS.

Unused **Irys upload allowance** is separate from the ETH surplus. It remains with the job for the 30-day spending approval and is not automatically withdrawn or refunded. Files get Irys URLs, not IPFS CIDs. No second IPFS copy is included or billed.

## How settlement survives interruption

1. The server stores the quote and a random job ID in D1. A domain-separated HMAC of the existing storage key derives a unique job wallet. The customer and all quote parameters are bound to the authenticated creator.
2. The browser saves the payment hash before registration. The server verifies chain 369, sender, exact recipient, amount and quote data, then waits for three confirmations. An expired payment goes to the available-funds refund path. If registration has not reached the server, the browser explicitly asks the creator to keep the page open or resume using the saved hash.
3. The server checks pinned contract code and live prices. PulseX buys the exact required WETH within the PLS ceiling. Approval is limited to that WETH amount. LibertySwap's returned calldata must exactly match the configured recipient, chain, amount, router, token and zero integrator fee.
4. Before each broadcast the server stores the signed bytes, nonce and hash. A leased job and unique database step select one canonical transaction. Retries look for its receipt and reuse the same bytes, including when the first RPC response was lost. Jobs use separate balances and nonces.
5. A successful source bridge transaction does not unlock storage. The worker waits for enough native ETH at the isolated destination wallet, at a confirmed block: three confirmations on Ethereum or twelve on Base. It also resubmits LibertySwap's notification using the saved source hash. This is a confirmed-balance check on a unique recipient following source bridge success; the implementation does not claim a provider-signed end-to-end delivery receipt.
6. The worker obtains Irys's deposit address, sends from the job wallet and persists the deposit hash. It retries the notification, then waits for sufficient actual Irys credit. A successful notification alone is not credit.
7. A saved, deterministically retried Irys payment approval caps the browser's upload spending to this job. Only then can file uploads start. Refund processing can continue after storage becomes usable.
8. The browser displays stages, errors, transaction links and refunds. Files and completed upload batches remain in IndexedDB for resume. Web Locks prevent simultaneous payment attempts in different tabs; an unsupported browser is stopped before payment. A saved payment can be recovered from wallet activity. After a confirmed refund, a new quote can be started without overwriting the refunded job's local history.

The scheduled worker resumes up to eight due jobs per invocation, rotating waiting jobs so a delayed bridge cannot block newer jobs. Each invocation advances a bounded step. Registration must have reached the server before background processing can begin. The user's files remain in the browser and need that browser open for upload; settlement can continue while it is closed.

## Supported failure handling and limits

- Price movement above the PulseX ceiling before conversion, late payment, failed conversion, and supported pre-bridge failures return the funds still held, less incurred fees. Once a bridge may be in flight, the code waits instead of claiming a source-only refund is a completed refund.
- Temporary RPC/provider errors retry saved steps. Gas prices above the budget pause new broadcasts. A signed pending transaction keeps its original nonce and fee; automatic fee replacement is not implemented. A permanently stuck transaction can require recovery.
- LibertySwap's returned output is an **estimate**. The supported bridge method has no on-chain minimum-output parameter. The code rechecks the quote before bridging and withholds Irys funding/authorization until confirmed proceeds are sufficient; it cannot force a bridge operator to deliver a guaranteed amount or reverse a completed bridge.
- Refund, deposit or service-transfer reverts can enter `needs_attention`. The collection's payment ID and hashes remain available, and no new payment is automatic. The current release does not include an administrator console for arbitrary rescue transfers.
- Ordinary receiving wallets are required for the current bounded native-transfer gas budgets. Public checkout is not designed for arbitrary smart-contract wallet refund logic.
- Preserve the root secret, provider/token configuration and D1 records. Rotating or deleting them while jobs remain open can prevent settlement or recovery. Keep them through outstanding 30-day upload approvals. The setup page's manual treasury tools inspect the original wallet, not every derived job wallet.
- Browser checkpoints are local, not a portable backup. Reselect the same files and metadata in the same browser. Keep the displayed job ID and payment hash. Wallet speed-ups can be attached when the RPC still exposes the matching original pending nonce; cancellations and missing originals may need review.
- The selected contracts are runtime-pinned, not independently audited here. There is no blanket assertion that LibertySwap, PulseX, MintForge or their operators cannot fail.

## Required funded acceptance procedure

Use one allowlisted customer wallet and one small collection first. Review the actual PLS total before signing; the 0.01 WETH bridge minimum still applies to a tiny file. **No such payment was sent by Codex.**

1. Confirm the quote's destination network, service receiver, total PLS, maximum price movement, gas budgets and refund currency. Confirm the scheduled trigger is installed and the database migration succeeded.
2. Approve one PLS payment. Follow the PulseX and LibertySwap hashes. Close the collection page after it reports a registered job, then reopen and reselect the same files. Confirm settlement progressed and no second payment is requested.
3. Verify native ETH delivery, the Irys deposit and usable upload credit. Verify that upload was unavailable before credit. Confirm the small collection's artwork and metadata resolve through the Irys gateway.
4. Verify actual ETH and PLS returns to the customer's wallet on the stated chains. Check the service fee if configured. Keep the receipts alongside the quoted budget.
5. Test a larger collection and an interrupted upload before the full 10,000-image plus 10,000-JSON acceptance run. Record total bytes, elapsed upload time and memory use; the local scale test is not a live bandwidth benchmark.
6. Only after success, open the wallet allowlist for public checkout. If a step fails, disable new PLS checkout and use the saved IDs to investigate. Do not rotate the storage key, delete settlement tables or send another payment to restart.

## Evidence and verification

Read-only checks on 2026-09-20 confirmed:

- Native PLS-to-ETH quotes were unavailable through LibertySwap's tested endpoints. The successful route uses PulseX first.
- PulseX `getAmountsIn` returned an executable-path price for `[WPLS, LibertySwap WETH]`; the verified PulseX router exposes `swapETHForExactTokens`, despite the input currency being PLS.
- LibertySwap returned quotes for the exact WETH address on chain 369 to native ETH on chains 1 and 8453. Token-address input was also accepted, not only its symbol. No live transaction was executed.
- PulseX router: `0x165C3410fC91EF562C50559f7d2289fEbed552d9`.
- WPLS: `0xA1077a294dDE1B09bB078844df40758a5D0f9a27`.
- Required WETH: `0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C`.
- LibertySwap source router: `0xFd84612B395dA9459EF47F9F4598a0be6d9F3e29`.

Primary sources: [LibertySwap API](https://docs.libertyswap.finance/resources/liberty-swap-api), [router registry](https://apis.libertyswap.finance/v3/app/routers), [LibertySwap website and public request builder](https://libertyswap.finance/), [PulseX verified router](https://api.scan.pulsechain.com/api/v2/smart-contracts/0x165C3410fC91EF562C50559f7d2289fEbed552d9), [Irys SDK funding flow](https://github.com/Irys-xyz/js-sdk/blob/6011a62ae8331e3fa18ce30437abb04165ed5853/packages/upload-core/src/fund.ts), [Base network fees](https://docs.base.org/specifications/transactions/network-fees), and [Cloudflare scheduled triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

`npm test` builds the Worker and exercises local Ethereum/Base settlement with mock provider responses: altered recipient rejection, complete arithmetic budgets, isolated wallets, delayed destination delivery, delayed Irys credit, lost broadcast/notification/approval responses, simultaneous workers, late-payment refunds, price-ceiling refunds and continued processing after new checkout is disabled. UI tests verify double-click/tab protection, payment persistence, reload/resume, registration retry, exact totals and hash-only recovery. Existing direct routes, upload authentication and legacy storage tests also run.

`npm run test:scale` covers 10,000 images and matching JSON, interruption beyond 3,000 acknowledged images, resume without duplicate completed batches, and large-file chunk recovery using a simulated Irys provider. Neither test suite is a mainnet bridge acceptance test, security audit or live upload-speed claim.
