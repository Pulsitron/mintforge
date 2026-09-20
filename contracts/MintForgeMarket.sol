// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import './vendor/erc404/interfaces/IERC404.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/interfaces/IERC2981.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// Non-custodial fixed-price or offers-only listings. Zero price disables direct purchases.
/// Offers escrow native currency; all payouts are pull payments.
contract MintForgeMarket is ReentrancyGuard {
    struct Listing { address seller; address nft; uint256 tokenId; uint256 quantity; uint256 price; uint64 expiry; bool is1155; bool active; }
    struct Offer { address bidder; uint256 listingId; uint256 amount; uint64 expiry; bool active; }
    Listing[] public listings;
    Offer[] public offers;
    mapping(uint256 => uint256[]) private bids;
    mapping(address => uint256[]) private userOffers;
    mapping(address => uint256[]) private userListings;
    mapping(address => uint256) public proceeds;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;
    string public constant protocol = 'MintForge/1';
    event Listed(uint256 indexed listingId,address indexed seller,address indexed nft,uint256 tokenId);
    event Sale(uint256 indexed listingId,address indexed buyer,uint256 price);
    event Cancelled(uint256 indexed listingId);
    event PriceUpdated(uint256 indexed listingId,uint256 price);
    event Offered(uint256 indexed offerId,uint256 indexed listingId,address indexed bidder);
    constructor(address feeTo,uint16 fee) { require(feeTo != address(0) && fee <= 1000,'Fee'); feeRecipient=feeTo; feeBps=fee; }
    function userListingCount(address user) external view returns(uint256){return userListings[user].length;}
    function userListing(address user,uint256 index) external view returns(uint256){return userListings[user][index];}
    function listingCount() external view returns(uint256){ return listings.length; }
    function offerCount(uint256 id) external view returns(uint256){ return bids[id].length; }
    function listingOffer(uint256 id,uint256 index) external view returns(uint256){return bids[id][index];}
    function userOfferCount(address user) external view returns(uint256){return userOffers[user].length;}
    function userOffer(address user,uint256 index) external view returns(uint256){return userOffers[user][index];}
    function list(address nft,uint256 tokenId,uint256 quantity,uint256 price,uint64 expiry,bool is1155) external nonReentrant returns(uint256 id) {
        require(nft.code.length>0 && quantity>0 && expiry>block.timestamp,'Listing');
        require(is1155 || quantity==1,'ERC721 quantity');
        require(IERC165(nft).supportsInterface(is1155 ? bytes4(0xd9b67a26) : bytes4(0x80ac58cd)) || (!is1155 && IERC165(nft).supportsInterface(type(IERC404).interfaceId)), 'Standard');
        Listing memory l=Listing(msg.sender,nft,tokenId,quantity,price,expiry,is1155,true);
        require(_validOwner(l),'Ownership/approval');
        id=listings.length; listings.push(l); userListings[msg.sender].push(id); emit Listed(id,msg.sender,nft,tokenId);
    }
    function _validOwner(Listing memory l) internal view returns(bool) {
        if(l.is1155) return IERC1155(l.nft).balanceOf(l.seller,l.tokenId)>=l.quantity && IERC1155(l.nft).isApprovedForAll(l.seller,address(this));
        return IERC721(l.nft).ownerOf(l.tokenId)==l.seller && (IERC721(l.nft).getApproved(l.tokenId)==address(this) || IERC721(l.nft).isApprovedForAll(l.seller,address(this)));
    }
    function isAvailable(uint256 id) external view returns(bool) {
        Listing memory l=listings[id];
        if(!l.active || l.expiry<=block.timestamp) return false;
        try this.hasOwnership(id) returns(bool valid){ return valid; } catch {return false;}
    }
    function hasOwnership(uint256 id) external view returns(bool){return _validOwner(listings[id]);}
    function cancel(uint256 id) external { Listing storage l=listings[id];require(l.seller==msg.sender && l.active,'Seller');l.active=false;emit Cancelled(id); }
    function updatePrice(uint256 id,uint256 price) external {
        Listing storage l=listings[id];require(l.seller==msg.sender && l.active && l.expiry>block.timestamp,'Seller');
        l.price=price;emit PriceUpdated(id,price);
    }
    function buy(uint256 id,uint256 expectedPrice) external payable nonReentrant {
        Listing storage l=listings[id];require(l.price>0,'Offers only');require(expectedPrice==l.price && msg.value==l.price,'Price changed');_settle(id,msg.sender,msg.value);
    }
    function makeOffer(uint256 id,uint64 expiry) external payable nonReentrant returns(uint256 offerId) {
        Listing storage l=listings[id];require(l.active && l.expiry>block.timestamp && expiry>block.timestamp && expiry<=l.expiry && msg.value>0 && msg.sender!=l.seller,'Offer');
        offerId=offers.length;offers.push(Offer(msg.sender,id,msg.value,expiry,true));bids[id].push(offerId);userOffers[msg.sender].push(offerId);emit Offered(offerId,id,msg.sender);
    }
    function cancelOffer(uint256 id) external nonReentrant {
        Offer storage o=offers[id];require(o.bidder==msg.sender && o.active,'Bidder');o.active=false;proceeds[msg.sender]+=o.amount;
    }
    function acceptOffer(uint256 id) external nonReentrant {
        Offer storage o=offers[id];require(o.active && o.expiry>block.timestamp && listings[o.listingId].seller==msg.sender,'Offer unavailable');o.active=false;_settle(o.listingId,o.bidder,o.amount);
    }
    function _settle(uint256 id,address buyer,uint256 price) internal {
        Listing storage l=listings[id];require(l.active && l.expiry>block.timestamp && buyer!=l.seller && _validOwner(l),'Listing unavailable');
        l.active=false;uint256 fee=price*feeBps/10000;uint256 royalty;
        // Cap gas and tolerate NFTs without royalty support. Excessive royalty quotes fail atomically.
        (bool ok,bytes memory result)=l.nft.staticcall{gas:50000}(abi.encodeCall(IERC2981.royaltyInfo,(l.tokenId,price)));
        if(ok && result.length==64){(address receiver,uint256 amount)=abi.decode(result,(address,uint256));if(receiver!=address(0)){royalty=amount;require(royalty<=price-fee,'Royalty too high');proceeds[receiver]+=royalty;}}
        proceeds[feeRecipient]+=fee;proceeds[l.seller]+=price-fee-royalty;
        if(l.is1155) IERC1155(l.nft).safeTransferFrom(l.seller,buyer,l.tokenId,l.quantity,'');
        else IERC721(l.nft).safeTransferFrom(l.seller,buyer,l.tokenId);
        emit Sale(id,buyer,price);
    }
    function withdraw(address payable to) external nonReentrant {
        require(to!=address(0),'Recipient');uint256 amount=proceeds[msg.sender];require(amount>0,'No proceeds');proceeds[msg.sender]=0;
        (bool ok,)=to.call{value:amount}('');require(ok,'Payment failed');
    }
}
