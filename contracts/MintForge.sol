// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC1155/ERC1155.sol';
import '@openzeppelin/contracts/token/common/ERC2981.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable2Step.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/cryptography/MerkleProof.sol';
import '@openzeppelin/contracts/proxy/Clones.sol';
import '@openzeppelin/contracts/utils/Strings.sol';
import './vendor/erc404/ERC404.sol';

struct DropConfig {
    string name; string symbol; uint256 price; uint256 supply; uint256 walletLimit;
    uint64 start; uint64 end; address royaltyReceiver; uint96 royaltyBps;
    bytes32 allowlistRoot; string placeholder; uint64 revealAt;
    bool soulbound; bool pausable; bool frozen;
}

abstract contract DropCore is Ownable2Step, ReentrancyGuard {
    bool internal initialized;
    DropConfig internal cfg;
    string[] internal metadata;
    string public metadataBase;
    uint256 internal artworkCount;
    mapping(uint256 => string) internal metadataOverrides;
    address[] public recipients;
    uint16[] public shares;
    mapping(address => uint256) public proceeds;
    mapping(address => uint256) public walletMinted;
    uint256 public totalMinted;
    uint256 public totalRevenue;
    bool public paused;
    bool public revealed;
    address public feeRecipient;
    uint16 public feeBps;
    string public constant protocol = 'MintForge/2';
    event Minted(address indexed minter, uint256 indexed tokenId, uint256 quantity, uint256 paid);
    event ProceedsWithdrawn(address indexed payee, uint256 amount);
    event MetadataFrozen();
    event Revealed();
    constructor() Ownable(msg.sender) { initialized = true; }
    function _initialize(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee) internal {
        require(!initialized, 'Initialized'); initialized = true;
        require(creator != address(0) && bytes(c.name).length > 0 && bytes(c.name).length <= 100, 'Name/creator');
        require(c.supply > 0 && c.walletLimit > 0 && c.royaltyBps <= 2000, 'Supply/royalty');
        require(c.end == 0 || c.end > c.start, 'Sale window');
        require(uris.length > 0 && uris.length <= 200 && fee <= 1000 && feeTo != address(0), 'Metadata/fee');
        require(payees.length > 0 && payees.length <= 10 && payees.length == bps.length, 'Splits');
        uint256 sum;
        for (uint256 i; i < payees.length; ++i) { require(payees[i] != address(0) && bps[i] > 0, 'Payee'); sum += bps[i]; }
        require(sum == 10000, 'Split total');
        for (uint256 i; i < uris.length; ++i) require(bytes(uris[i]).length > 0 && bytes(uris[i]).length <= 512, 'URI');
        cfg = c; metadata = uris; artworkCount = uris.length; recipients = payees; shares = bps;
        feeRecipient = feeTo; feeBps = fee; revealed = bytes(c.placeholder).length == 0;
        _transferOwnership(creator);
    }
    function _initializeBase(string calldata base, uint256 count) internal {
        require(count > 0 && count <= 10000 && bytes(base).length > 0 && bytes(base).length <= 512, 'Base/count');
        require(bytes(base)[bytes(base).length - 1] == bytes1('/'), 'Trailing slash');
        metadataBase = base; artworkCount = count;
    }
    function config() external view returns (DropConfig memory) { return cfg; }
    function previewURI(uint256 index) external view returns(string memory) { require(index < artworkCount, 'Artwork'); return _uri(index); }
    function metadataCount() external view returns (uint256) { return artworkCount; }
    function _uri(uint256 index) internal view returns (string memory) {
        if (!revealed && (cfg.revealAt == 0 || block.timestamp < cfg.revealAt)) return cfg.placeholder;
        index %= artworkCount;
        if (bytes(metadataOverrides[index]).length != 0) return metadataOverrides[index];
        if (bytes(metadataBase).length != 0) return string.concat(metadataBase, Strings.toString(index + 1), '.json');
        return metadata[index];
    }
    function _purchase(uint256 quantity, bytes32[] calldata proof) internal {
        require(!paused && quantity > 0 && quantity <= 50, 'Paused/quantity');
        require(block.timestamp >= cfg.start && (cfg.end == 0 || block.timestamp < cfg.end), 'Sale closed');
        require(walletMinted[msg.sender] + quantity <= cfg.walletLimit, 'Wallet limit');
        if (cfg.allowlistRoot != bytes32(0)) require(MerkleProof.verify(proof, cfg.allowlistRoot, keccak256(abi.encodePacked(msg.sender))), 'Allowlist');
        require(msg.value == cfg.price * quantity, 'Exact payment');
        walletMinted[msg.sender] += quantity; totalMinted += quantity; totalRevenue += msg.value;
        uint256 fee = msg.value * feeBps / 10000;
        proceeds[feeRecipient] += fee;
        uint256 net = msg.value - fee; uint256 allocated;
        for (uint256 i = 1; i < recipients.length; ++i) { uint256 part = net * shares[i] / 10000; proceeds[recipients[i]] += part; allocated += part; }
        proceeds[recipients[0]] += net - allocated;
    }
    function withdraw(address payable to) external nonReentrant {
        require(to != address(0), 'Recipient'); uint256 amount = proceeds[msg.sender]; require(amount > 0, 'No proceeds');
        proceeds[msg.sender] = 0; (bool ok,) = to.call{value:amount}(''); require(ok, 'Payment failed'); emit ProceedsWithdrawn(msg.sender, amount);
    }
    function setPrice(uint256 price) external onlyOwner { cfg.price = price; }
    function setAllowlistRoot(bytes32 root) external onlyOwner { cfg.allowlistRoot = root; }
    function setPaused(bool value) external onlyOwner { require(cfg.pausable, 'Pause disabled'); paused = value; }
    function reveal() external onlyOwner { revealed = true; emit Revealed(); }
    function setMetadata(uint256 index, string calldata uri_) external onlyOwner {
        require(!cfg.frozen && index < artworkCount && bytes(uri_).length > 0 && bytes(uri_).length <= 512, 'Metadata locked'); metadataOverrides[index] = uri_;
    }
    function freezeMetadata() external onlyOwner { cfg.frozen = true; emit MetadataFrozen(); }
}

contract MintForge721 is ERC721, ERC2981, DropCore {
    constructor() ERC721('', '') {}
    function initializeBase(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee, uint256 count) external {
        _initialize(creator, c, uris, payees, bps, feeTo, fee);
        require(uris.length == 1, 'One base'); _initializeBase(uris[0], count);
        if(c.royaltyBps > 0) _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps);
    }
    function initialize(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee) external {
        _initialize(creator, c, uris, payees, bps, feeTo, fee);
        if(c.royaltyBps > 0) _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps);
    }
    function name() public view override returns(string memory) { return cfg.name; }
    function symbol() public view override returns(string memory) { return cfg.symbol; }
    function tokenURI(uint256 id) public view override returns(string memory) { _requireOwned(id); return _uri(id - 1); }
    function mint(uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        require(totalMinted + quantity <= cfg.supply, 'Sold out'); uint256 first = totalMinted + 1;
        _purchase(quantity, proof);
        for(uint256 i; i < quantity; ++i) _safeMint(msg.sender, first + i);
        emit Minted(msg.sender, first, quantity, msg.value);
    }
    function burn(uint256 id) external { require(ownerOf(id) == msg.sender, 'Not owner'); _burn(id); }
    function _update(address to, uint256 id, address auth) internal override returns(address) {
        address from = _ownerOf(id);
        if (from != address(0) && to != address(0)) require(!cfg.soulbound, 'Soulbound');
        // Owner can pause new mints, never custody withdrawals or holder transfers.
        return super._update(to, id, auth);
    }
    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns(bool) { return super.supportsInterface(id); }
}

contract MintForge1155 is ERC1155, ERC2981, DropCore {
    mapping(uint256 => uint256) public mintedById;
    constructor() ERC1155('') {}
    function initializeBase(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee, uint256 count) external {
        _initialize(creator, c, uris, payees, bps, feeTo, fee);
        require(uris.length == 1, 'One base'); _initializeBase(uris[0], count);
        if(c.royaltyBps > 0) _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps);
    }
    function initialize(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee) external {
        _initialize(creator, c, uris, payees, bps, feeTo, fee);
        if(c.royaltyBps > 0) _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps);
    }
    function name() external view returns(string memory) { return cfg.name; }
    function symbol() external view returns(string memory) { return cfg.symbol; }
    function uri(uint256 id) public view override returns(string memory) { require(id > 0 && id <= artworkCount, 'Token ID'); return _uri(id - 1); }
    function mint(uint256 id, uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        require(id > 0 && id <= artworkCount && mintedById[id] + quantity <= cfg.supply, 'Sold out/token ID');
        mintedById[id] += quantity; _purchase(quantity, proof); _mint(msg.sender, id, quantity, ''); emit Minted(msg.sender, id, quantity, msg.value);
    }
    function burn(uint256 id, uint256 amount) external { _burn(msg.sender, id, amount); }
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if(from != address(0) && to != address(0)) require(!cfg.soulbound, 'Soulbound'); super._update(from, to, ids, values);
    }
    function supportsInterface(bytes4 id) public view override(ERC1155, ERC2981) returns(bool) { return super.supportsInterface(id); }
}

contract MintForge404 is ERC404, ERC2981, DropCore {
    constructor() ERC404('', '', 18) {}
    function initializeBase(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee, uint256 count) external {
        require(!c.soulbound && c.supply <= 10000, '404 supply/transfer');
        _initialize(creator, c, uris, payees, bps, feeTo, fee);
        require(uris.length == 1, 'One base'); _initializeBase(uris[0], count);
        name = c.name; symbol = c.symbol;
        if(c.royaltyBps > 0) _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps);
    }
    // A clone must never reuse the implementation's EIP-2612 domain.
    function DOMAIN_SEPARATOR() public view override returns(bytes32) { return _computeDomainSeparator(); }
    function tokenURI(uint256 id) public view override returns(string memory) {
        ownerOf(id); return _uri(id - ID_ENCODING_PREFIX - 1);
    }
    function mint(uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        require(totalMinted + quantity <= cfg.supply, 'Sold out');
        _purchase(quantity, proof); _mintERC20(msg.sender, quantity * units);
        emit Minted(msg.sender, 0, quantity, msg.value);
    }
    // Configure new DEX pools before liquidity. The owner cannot bank another holder's NFTs.
    function setERC721TransferExempt(address account, bool exempt) external onlyOwner {
        require(balanceOf[account] == 0 && erc721BalanceOf(account) == 0, 'Account has balance');
        _setERC721TransferExempt(account, exempt);
    }
    function supportsInterface(bytes4 id) public view override(ERC404, ERC2981) returns(bool) {
        return ERC404.supportsInterface(id) || ERC2981.supportsInterface(id);
    }
}

interface IForgeDrop {
    function initializeBase(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee, uint256 count) external;
    function initialize(address creator, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps, address feeTo, uint16 fee) external;
}
contract MintForgeFactory {
    address public immutable implementation721;
    address public immutable implementation1155;
    address public immutable implementation404;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;
    address[] public collections;
    mapping(address => address[]) private created;
    mapping(address => uint16) public standard;
    event CollectionCreated(address indexed creator, address indexed collection, uint16 standard);
    constructor(address template721, address template1155, address template404, address feeTo, uint16 fee) {
        require(template721.code.length > 0 && template1155.code.length > 0 && template404.code.length > 0 && feeTo != address(0) && fee <= 1000, 'Config');
        implementation721 = template721; implementation1155 = template1155; implementation404 = template404; feeRecipient = feeTo; feeBps = fee;
    }
    function createCollection(bool is1155, DropConfig calldata c, string[] calldata uris, address[] calldata payees, uint16[] calldata bps) external returns(address collection) {
        collection = Clones.clone(is1155 ? implementation1155 : implementation721);
        IForgeDrop(collection).initialize(msg.sender,c,uris,payees,bps,feeRecipient,feeBps);
        collections.push(collection); created[msg.sender].push(collection); standard[collection] = is1155 ? 1155 : 721;
        emit CollectionCreated(msg.sender,collection,is1155 ? 1155 : 721);
    }
    function createCollectionBase(uint16 kind, DropConfig calldata c, string calldata base, uint256 count, address[] calldata payees, uint16[] calldata bps) external returns(address collection) {
        require(kind == 721 || kind == 1155 || kind == 404, 'Standard');
        collection = Clones.clone(kind == 721 ? implementation721 : kind == 1155 ? implementation1155 : implementation404);
        string[] memory uris = new string[](1); uris[0] = base;
        IForgeDrop(collection).initializeBase(msg.sender,c,uris,payees,bps,feeRecipient,feeBps,count);
        collections.push(collection); created[msg.sender].push(collection); standard[collection] = kind;
        emit CollectionCreated(msg.sender,collection,kind);
    }
    function collectionCount() external view returns(uint256) { return collections.length; }
    function creatorCount(address creator) external view returns(uint256) { return created[creator].length; }
    function creatorCollection(address creator,uint256 index) external view returns(address) { return created[creator][index]; }
}
