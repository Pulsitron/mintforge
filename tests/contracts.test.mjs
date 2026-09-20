import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  Contract,
  parseEther,
  ZeroAddress,
  ZeroHash,
  solidityPackedKeccak256,
  keccak256,
  concat,
  TypedDataEncoder,
} from "ethers";
const artifact = (name) =>
  JSON.parse(fs.readFileSync(`public/contracts/${name}.json`));
const chain = ganache.provider({
  logging: { quiet: true },
  wallet: { totalAccounts: 7 },
  chain: { hardfork: "shanghai" },
  miner: { timestampIncrement: 1 },
});
const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
const users = await Promise.all(
  Array.from({ length: 7 }, (_, i) => provider.getSigner(i)),
);
const [owner, buyer, other, fee, royalty, collab] = users;
const addresses = await Promise.all(users.map((s) => s.getAddress()));
const [oa, ba, xa, fa, ra, ca] = addresses;
async function deploy(name, ...args) {
  const a = artifact(name);
  const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args);
  await c.waitForDeployment();
  return c;
}
async function sent(tx) {
  return (await tx).wait();
}
const template721 = await deploy("MintForge721");
const template1155 = await deploy("MintForge1155");
const template404 = await deploy("MintForge404");
const factory = await deploy(
  "MintForgeFactory",
  template721.target,
  template1155.target,
  template404.target,
  fa,
  150,
);
const market = await deploy("MintForgeMarket", fa, 150);
const vault = await deploy("MintForgeStaking");
const config = {
  name: "Test collection",
  symbol: "TEST",
  price: parseEther("1"),
  supply: 20,
  walletLimit: 20,
  start: 0,
  end: 0,
  royaltyReceiver: ra,
  royaltyBps: 500,
  allowlistRoot: ZeroHash,
  placeholder: "",
  revealAt: 0,
  soulbound: false,
  pausable: true,
  frozen: false,
};
async function collection(is1155 = false, c = {}) {
  const n = await factory.collectionCount();
  await sent(
    factory.createCollection(
      is1155,
      { ...config, ...c },
      ["ipfs://metadata"],
      [oa, ca],
      [8000, 2000],
    ),
  );
  const addr = await factory.collections(n);
  return new Contract(
    addr,
    artifact(is1155 ? "MintForge1155" : "MintForge721").abi,
    owner,
  );
}
await test("templates are locked and cloned initialization is atomic", async () => {
  await assert.rejects(() =>
    sent(
      template721.initialize(oa, config, ["ipfs://m"], [oa], [10000], fa, 150),
    ),
  );
  const c = await collection();
  assert.equal(await c.owner(), oa);
  await assert.rejects(() =>
    sent(c.initialize(xa, config, ["ipfs://m"], [xa], [10000], fa, 150)),
  );
  assert.equal(await factory.standard(c.target), 721n);
});
await test("mint price, wallet cap, supply, splits and unauthorized management", async () => {
  const c = await collection(false, { supply: 2, walletLimit: 1 });
  await assert.rejects(() =>
    sent(c.connect(buyer).mint(1, [], { value: parseEther(".9") })),
  );
  await sent(c.connect(buyer).mint(1, [], { value: parseEther("1") }));
  assert.equal(await c.ownerOf(1), ba);
  assert.equal(await c.proceeds(fa), parseEther(".015"));
  assert.equal(await c.proceeds(ca), parseEther(".197"));
  assert.equal(await c.proceeds(oa), parseEther(".788"));
  await assert.rejects(() =>
    sent(c.connect(buyer).mint(1, [], { value: parseEther("1") })),
  );
  await assert.rejects(() => sent(c.connect(buyer).setPrice(0)));
  await sent(c.setPrice(parseEther("2")));
  await sent(c.connect(other).mint(1, [], { value: parseEther("2") }));
  await assert.rejects(() => sent(c.mint(1, [], { value: parseEther("2") })));
  await sent(c.withdraw(oa));
  assert.equal(await c.proceeds(oa), 0n);
});
await test("pause prevents mint but preserves NFT exits; freeze cannot be undone", async () => {
  const c = await collection();
  await sent(c.mint(1, [], { value: parseEther("1") }));
  await sent(c.setPaused(true));
  await assert.rejects(() =>
    sent(c.connect(buyer).mint(1, [], { value: parseEther("1") })),
  );
  await sent(c.transferFrom(oa, ba, 1));
  assert.equal(await c.ownerOf(1), ba);
  await sent(c.freezeMetadata());
  await assert.rejects(() => sent(c.setMetadata(0, "ipfs://changed")));
});
await test("market exact-price purchase distributes royalty and fee, cannot replay", async () => {
  const c = await collection();
  await sent(c.mint(1, [], { value: parseEther("1") }));
  await sent(c.approve(market.target, 1));
  const id = await market.listingCount();
  const time = (await provider.getBlock("latest")).timestamp;
  await sent(market.list(c.target, 1, 1, parseEther("2"), time + 86400, false));
  await assert.rejects(() => sent(market.connect(other).cancel(id)));
  await assert.rejects(() =>
    sent(
      market
        .connect(buyer)
        .buy(id, parseEther("1"), { value: parseEther("1") }),
    ),
  );
  await sent(
    market.connect(buyer).buy(id, parseEther("2"), { value: parseEther("2") }),
  );
  assert.equal(await c.ownerOf(1), ba);
  assert.equal(await market.proceeds(ra), parseEther(".1"));
  assert.equal(await market.proceeds(fa), parseEther(".03"));
  assert.equal(await market.proceeds(oa), parseEther("1.87"));
  await assert.rejects(() =>
    sent(
      market
        .connect(other)
        .buy(id, parseEther("2"), { value: parseEther("2") }),
    ),
  );
  assert.equal(await market.isAvailable(id), false);
});
await test("offers are escrowed, cancellable after listing cancellation and seller can accept", async () => {
  const c = await collection();
  await sent(c.mint(2, [], { value: parseEther("2") }));
  await sent(c.setApprovalForAll(market.target, true));
  const time = (await provider.getBlock("latest")).timestamp;
  const id = await market.listingCount();
  await sent(market.list(c.target, 1, 1, parseEther("2"), time + 86400, false));
  await sent(
    market
      .connect(buyer)
      .makeOffer(id, time + 10000, { value: parseEther(".5") }),
  );
  const offerId = await market.listingOffer(id, 0);
  await sent(market.cancel(id));
  await sent(market.connect(buyer).cancelOffer(offerId));
  assert.equal(await market.proceeds(ba), parseEther(".5"));
  await sent(market.connect(buyer).withdraw(ba));
  assert.equal(await market.proceeds(ba), 0n);
  const next = await market.listingCount();
  await sent(market.list(c.target, 2, 1, parseEther("2"), time + 86400, false));
  await sent(
    market
      .connect(other)
      .makeOffer(next, time + 10000, { value: parseEther(".7") }),
  );
  const accepted = await market.listingOffer(next, 0);
  await sent(market.acceptOffer(accepted));
  assert.equal(await c.ownerOf(2), xa);
  await assert.rejects(() => sent(market.acceptOffer(accepted)));
});
await test("offers-only listings cannot be bought for free and can settle funded offers", async () => {
  const c = await collection();
  await sent(c.mint(1, [], { value: parseEther("1") }));
  await sent(c.approve(market.target, 1));
  const id = await market.listingCount();
  const time = (await provider.getBlock("latest")).timestamp;
  await sent(market.list(c.target, 1, 1, 0, time + 86400, false));
  assert.equal((await market.listings(id)).price, 0n);
  await assert.rejects(() => sent(market.connect(buyer).buy(id, 0, { value: 0 })));
  await sent(market.connect(buyer).makeOffer(id, time + 10000, { value: parseEther(".8") }));
  const offer = await market.listingOffer(id, 0);
  await sent(market.acceptOffer(offer));
  assert.equal(await c.ownerOf(1), ba);
  await assert.rejects(() => sent(market.updatePrice(id, 1)));
});
await test("only sellers can update prices; stale buyer quotes cannot settle", async () => {
  const c = await collection();
  await sent(c.mint(1, [], { value: parseEther("1") }));
  await sent(c.approve(market.target, 1));
  const id = await market.listingCount();
  const time = (await provider.getBlock("latest")).timestamp;
  await sent(market.list(c.target, 1, 1, parseEther("2"), time + 86400, false));
  await assert.rejects(() => sent(market.connect(buyer).updatePrice(id, 1)));
  await sent(market.updatePrice(id, parseEther("3")));
  await assert.rejects(() => sent(market.connect(buyer).buy(id, parseEther("2"), { value: parseEther("2") })));
  await sent(market.updatePrice(id, 0));
  await assert.rejects(() => sent(market.connect(buyer).buy(id, 0, { value: 0 })));
  await sent(market.updatePrice(id, parseEther("1")));
  await sent(market.connect(buyer).buy(id, parseEther("1"), { value: parseEther("1") }));
  assert.equal(await c.ownerOf(1), ba);
});
await test("stale non-custodial listings cannot sell moved NFTs", async () => {
  const c = await collection();
  await sent(c.mint(1, [], { value: parseEther("1") }));
  await sent(c.approve(market.target, 1));
  const id = await market.listingCount();
  const time = (await provider.getBlock("latest")).timestamp;
  await sent(market.list(c.target, 1, 1, 1, time + 500, false));
  await sent(c.transferFrom(oa, xa, 1));
  assert.equal(await market.isAvailable(id), false);
  await assert.rejects(() =>
    sent(market.connect(buyer).buy(id, 1, { value: 1 })),
  );
});
await test("ERC1155 supplies are per artwork and quantities are atomically traded", async () => {
  const c = await collection(true, { supply: 3 });
  await sent(c.mint(1, 3, [], { value: parseEther("3") }));
  await assert.rejects(() =>
    sent(c.mint(1, 1, [], { value: parseEther("1") })),
  );
  await sent(c.setApprovalForAll(market.target, true));
  const id = await market.listingCount();
  const time = (await provider.getBlock("latest")).timestamp;
  await sent(market.list(c.target, 1, 2, parseEther("1"), time + 1000, true));
  await sent(
    market.connect(buyer).buy(id, parseEther("1"), { value: parseEther("1") }),
  );
  assert.equal(await c.balanceOf(ba, 1), 2n);
  assert.equal(await c.balanceOf(oa, 1), 1n);
});
await test("staking reserves full rewards, rejects unfunded deposits and preserves early exits", async () => {
  const c = await collection();
  await sent(c.connect(buyer).mint(1, [], { value: parseEther("1") }));
  const id = await vault.poolCount();
  await sent(
    vault.createPool(c.target, ZeroAddress, parseEther("1"), 86400, 500, false),
  );
  await sent(c.connect(buyer).approve(vault.target, 1));
  await assert.rejects(() => sent(vault.connect(buyer).stake(id, 1, 1)));
  await sent(vault.fund(id, parseEther("1"), { value: parseEther("1") }));
  const posCount = await vault.positionCount(ba);
  await sent(vault.connect(buyer).stake(id, 1, 1));
  const pos = await vault.holderPosition(ba, posCount);
  assert.equal(await c.ownerOf(1), vault.target);
  assert.equal((await vault.pools(id)).available, 0n);
  await assert.rejects(() => sent(vault.connect(other).unstake(pos, xa)));
  await sent(vault.setOpen(id, false));
  await assert.rejects(() => sent(vault.withdrawUnused(id, 1, oa)));
  await chain.request({ method: "evm_increaseTime", params: [43200] });
  await chain.request({ method: "evm_mine", params: [] });
  await sent(vault.connect(buyer).unstake(pos, ba));
  assert.equal(await c.ownerOf(1), ba);
  const credit = await vault.credit(id, ba);
  assert(credit > parseEther(".47") && credit < parseEther(".48"));
  const budget = (await vault.pools(id)).available;
  assert.equal(budget + credit, parseEther("1"));
  await sent(vault.connect(buyer).withdrawReward(id, ba));
  await sent(vault.withdrawUnused(id, budget, oa));
  assert.equal(await vault.credit(id, ba), 0n);
});
await test("mature claims plus NFT return never double-pay and ERC1155 escrow works", async () => {
  const c = await collection(true);
  await sent(c.connect(buyer).mint(1, 2, [], { value: parseEther("2") }));
  const id = await vault.poolCount();
  await sent(
    vault.createPool(c.target, ZeroAddress, parseEther(".1"), 86400, 0, true),
  );
  await sent(vault.fund(id, parseEther(".2"), { value: parseEther(".2") }));
  await sent(c.connect(buyer).setApprovalForAll(vault.target, true));
  const count = await vault.positionCount(ba);
  await sent(vault.connect(buyer).stake(id, 1, 2));
  const pos = await vault.holderPosition(ba, count);
  await chain.request({ method: "evm_increaseTime", params: [86401] });
  await chain.request({ method: "evm_mine", params: [] });
  await sent(vault.connect(buyer).claim(pos));
  assert.equal(await vault.credit(id, ba), parseEther(".2"));
  await sent(vault.connect(buyer).unstake(pos, ba));
  assert.equal(await c.balanceOf(ba, 1), 2n);
  assert.equal(await vault.credit(id, ba), parseEther(".2"));
  await sent(vault.connect(buyer).withdrawReward(id, ba));
  await assert.rejects(() => sent(vault.connect(buyer).withdrawReward(id, ba)));
});
await test("untracked safe NFT transfers to the staking vault are rejected", async () => {
  const c = await collection();
  await sent(c.mint(1, [], { value: parseEther("1") }));
  await assert.rejects(() =>
    sent(c["safeTransferFrom(address,address,uint256)"](oa, vault.target, 1)),
  );
  assert.equal(await c.ownerOf(1), oa);
});
await test("Merkle allowlist rejects another wallet and validates an odd-sized tree", async () => {
  const leaves = [ba, xa, ra]
    .map((a) => solidityPackedKeccak256(["address"], [a]))
    .sort();
  const pair = keccak256(concat([leaves[0], leaves[1]]));
  const root = keccak256(concat([pair, leaves[2]].sort()));
  const c = await collection(false, { price: 0, allowlistRoot: root });
  await assert.rejects(() => sent(c.mint(1, [])));
  for (const user of [buyer, other, royalty]) {
    const a = await user.getAddress();
    const leaf = solidityPackedKeccak256(["address"], [a]);
    const i = leaves.indexOf(leaf);
    const proof = i === 2 ? [pair] : [leaves[i ^ 1], leaves[2]];
    await sent(c.connect(user).mint(1, proof));
  }
  assert.equal(await c.totalMinted(), 3n);
  await sent(c.setAllowlistRoot(ZeroHash));
  await sent(c.mint(1, []));
});
await test("receiver callback cannot reenter mint", async () => {
  const a = JSON.parse(fs.readFileSync("tests/artifacts/MintReentry.json"));
  const attacker = await new ContractFactory(a.abi, a.bytecode, owner).deploy();
  await attacker.waitForDeployment();
  const c = await collection(false, { price: 0 });
  await sent(attacker.attack(c.target));
  assert.equal(await attacker.blocked(), true);
  assert.equal(await c.totalMinted(), 1n);
});
await test("failed ERC20 reward payment never traps the staked NFT", async () => {
  const a = JSON.parse(fs.readFileSync("tests/artifacts/BlockableReward.json"));
  const reward = await new ContractFactory(a.abi, a.bytecode, owner).deploy();
  await reward.waitForDeployment();
  const c = await collection();
  await sent(c.connect(buyer).mint(1, [], { value: parseEther("1") }));
  const pool = await vault.poolCount();
  await sent(
    vault.createPool(c.target, reward.target, parseEther("1"), 86400, 0, false),
  );
  await sent(reward.approve(vault.target, parseEther("1")));
  await sent(vault.fund(pool, parseEther("1")));
  await sent(c.connect(buyer).approve(vault.target, 1));
  const n = await vault.positionCount(ba);
  await sent(vault.connect(buyer).stake(pool, 1, 1));
  const id = await vault.holderPosition(ba, n);
  await chain.request({ method: "evm_increaseTime", params: [86401] });
  await chain.request({ method: "evm_mine", params: [] });
  await sent(reward.setBlocked(true));
  await sent(vault.connect(buyer).unstake(id, ba));
  assert.equal(await c.ownerOf(1), ba);
  await assert.rejects(() =>
    sent(vault.connect(buyer).withdrawReward(pool, ba)),
  );
  assert.equal(await vault.credit(pool, ba), parseEther("1"));
  await sent(reward.setBlocked(false));
  await sent(vault.connect(buyer).withdrawReward(pool, ba));
  assert.equal(await reward.balanceOf(ba), parseEther("1"));
});
async function baseCollection(kind, count=10000, overrides={}) {
  const n = await factory.collectionCount();
  const receipt = await sent(factory.createCollectionBase(kind,{...config,supply:10000,walletLimit:10000,...overrides},"https://gateway.irys.xyz/manifest/",count,[oa],[10000]));
  return {receipt,c:new Contract(await factory.collections(n),artifact(kind===404?"MintForge404":kind===1155?"MintForge1155":"MintForge721").abi,owner)};
}
await test("10,000 metadata paths deploy at constant gas and preserve reveal/freeze overrides",async()=>{
  const small=await baseCollection(721,1),large=await baseCollection(721,10000);
  assert.ok(large.receipt.gasUsed < small.receipt.gasUsed + 10000n);
  assert.equal(await large.c.metadataCount(),10000n);
  assert.equal(await large.c.previewURI(9999),"https://gateway.irys.xyz/manifest/10000.json");
  await sent(large.c.setMetadata(9999,"ipfs://updated"));
  assert.equal(await large.c.previewURI(9999),"ipfs://updated");
  await sent(large.c.freezeMetadata());
  await assert.rejects(()=>sent(large.c.setMetadata(9999,"ipfs://locked")));
  const edition=await baseCollection(1155,10000);
  await sent(edition.c.mint(10000,1,[],{value:parseEther("1")}));
  assert.equal(await edition.c.uri(10000),"https://gateway.irys.xyz/manifest/10000.json");
  await assert.rejects(()=>baseCollection(721,10001));
});
await test("ERC404 whole mint, fractional banking, recycled IDs and independent permit domains",async()=>{
  const {c}=await baseCollection(404,10,{supply:3,walletLimit:3});
  const {c:otherClone}=await baseCollection(404,10);
  const prefix=1n<<255n;
  assert.equal(await c.DOMAIN_SEPARATOR(),TypedDataEncoder.hashDomain({name:config.name,version:"1",chainId:1337,verifyingContract:c.target}));
  assert.notEqual(await c.DOMAIN_SEPARATOR(),await otherClone.DOMAIN_SEPARATOR());
  await sent(c.mint(3,[],{value:parseEther("3")}));
  assert.equal(await c.erc20BalanceOf(oa),parseEther("3"));
  assert.equal(await c.erc721BalanceOf(oa),3n);
  assert.equal(await c.tokenURI(prefix+1n),"https://gateway.irys.xyz/manifest/1.json");
  await sent(c.transfer(ba,parseEther(".4")));
  assert.equal(await c.erc721BalanceOf(oa),2n);assert.equal(await c.erc721BalanceOf(ba),0n);
  assert.equal(await c.getERC721QueueLength(),1n);
  await sent(c.transfer(ba,parseEther(".6")));
  assert.equal(await c.erc721BalanceOf(ba),1n);assert.equal(await c.ownerOf(prefix+3n),ba);
  assert.equal(await c.totalSupply(),parseEther("3"));
  await assert.rejects(()=>sent(c.mint(1,[],{value:parseEther("1")})));
  await assert.rejects(()=>sent(c.setERC721TransferExempt(ba,true)));
  await sent(c.setERC721TransferExempt(xa,true));
  assert.equal(await c.erc721TransferExempt(xa),true);
});
await test("ERC404 encoded NFT IDs trade and stake without confusing fungible balances",async()=>{
  const {c}=await baseCollection(404,2,{supply:2,walletLimit:2});
  const id=(1n<<255n)+1n;
  await sent(c.mint(2,[],{value:parseEther("2")}));
  await sent(c.erc721Approve(market.target,id));
  const listing=await market.listingCount();
  const now=(await provider.getBlock("latest")).timestamp;
  await sent(market.list(c.target,id,1,parseEther("1"),now+86400,false));
  await sent(market.connect(buyer).buy(listing,parseEther("1"),{value:parseEther("1")}));
  assert.equal(await c.ownerOf(id),ba);assert.equal(await c.erc20BalanceOf(ba),parseEther("1"));
  const pool=await vault.poolCount();
  await sent(vault.createPool(c.target,ZeroAddress,parseEther(".1"),86400,0,false));
  await sent(vault.fund(pool,parseEther("1"),{value:parseEther("1")}));
  await sent(c.connect(buyer).erc721Approve(vault.target,id));
  const n=await vault.positionCount(ba);
  await sent(vault.connect(buyer).stake(pool,id,1));
  const position=await vault.holderPosition(ba,n);
  assert.equal(await c.ownerOf(id),vault.target);
  const exitGas=await vault.connect(buyer).unstake.estimateGas(position,ba);
  await sent(vault.connect(buyer).unstake(position,ba,{gasLimit:exitGas+100000n}));
  assert.equal(await c.ownerOf(id),ba);assert.equal(await c.erc20BalanceOf(ba),parseEther("1"));
});
await chain.disconnect();
