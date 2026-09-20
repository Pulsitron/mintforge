// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import './vendor/erc404/interfaces/IERC404.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// Fixed-duration, fully reserved rewards. NFT withdrawals do not call the reward token.
contract MintForgeStaking is ReentrancyGuard, IERC721Receiver, IERC1155Receiver {
    using SafeERC20 for IERC20;
    struct Pool { address creator; address nft; address reward; uint256 dailyRate; uint64 duration; uint16 earlyPenaltyBps; bool is1155; bool open; uint256 available; }
    struct Position { address holder; uint256 poolId; uint256 tokenId; uint256 quantity; uint64 start; uint256 reserved; uint256 claimed; bool active; }
    Pool[] public pools; Position[] public positions;
    mapping(address=>uint256[]) private holderPositions;
    mapping(uint256=>mapping(address=>uint256)) public credit;
    address private expectedNft; address private expectedFrom; uint256 private expectedId; uint256 private expectedQuantity;
    string public constant protocol='MintForge/1';
    event PoolCreated(uint256 indexed poolId,address indexed creator,address indexed nft);
    event Staked(uint256 indexed positionId,address indexed holder,uint256 indexed poolId);
    event Unstaked(uint256 indexed positionId);
    function poolCount() external view returns(uint256){return pools.length;}
    function positionCount(address holder) external view returns(uint256){return holderPositions[holder].length;}
    function holderPosition(address holder,uint256 index) external view returns(uint256){return holderPositions[holder][index];}
    function createPool(address nft,address reward,uint256 dailyRate,uint64 duration,uint16 penalty,bool is1155) external returns(uint256 id){
        require(nft.code.length>0 && (reward==address(0) || reward.code.length>0) && dailyRate>0 && duration>=1 days && duration<=365 days && penalty<=10000,'Pool configuration');
        require(IERC165(nft).supportsInterface(is1155 ? bytes4(0xd9b67a26) : bytes4(0x80ac58cd)) || (!is1155 && IERC165(nft).supportsInterface(type(IERC404).interfaceId)), 'Standard');
        id=pools.length;pools.push(Pool(msg.sender,nft,reward,dailyRate,duration,penalty,is1155,true,0));emit PoolCreated(id,msg.sender,nft);
    }
    function fund(uint256 id,uint256 amount) external payable nonReentrant {
        Pool storage p=pools[id];require(amount>0,'Amount');
        if(p.reward==address(0)) require(msg.value==amount,'Value');
        else {require(msg.value==0,'Native value');uint256 beforeBalance=IERC20(p.reward).balanceOf(address(this));IERC20(p.reward).safeTransferFrom(msg.sender,address(this),amount);require(IERC20(p.reward).balanceOf(address(this))-beforeBalance==amount,'Fee tokens unsupported');}
        p.available+=amount;
    }
    function setOpen(uint256 id,bool value) external {Pool storage p=pools[id];require(msg.sender==p.creator,'Creator');p.open=value;}
    function withdrawUnused(uint256 id,uint256 amount,address payable to) external nonReentrant {
        Pool storage p=pools[id];require(msg.sender==p.creator && !p.open && amount<=p.available && to!=address(0),'Unavailable');p.available-=amount;_pay(p.reward,to,amount);
    }
    function stake(uint256 poolId,uint256 tokenId,uint256 quantity) external nonReentrant returns(uint256 id){
        Pool storage p=pools[poolId];require(p.open && quantity>0 && (p.is1155 || quantity==1),'Pool closed/quantity');
        uint256 reserve=p.dailyRate*quantity*p.duration/1 days;require(reserve>0 && p.available>=reserve,'Pool needs funding');p.available-=reserve;
        id=positions.length;positions.push(Position(msg.sender,poolId,tokenId,quantity,uint64(block.timestamp),reserve,0,true));holderPositions[msg.sender].push(id);
        expectedNft=p.nft;expectedFrom=msg.sender;expectedId=tokenId;expectedQuantity=quantity;
        if(p.is1155) IERC1155(p.nft).safeTransferFrom(msg.sender,address(this),tokenId,quantity,'');else IERC721(p.nft).safeTransferFrom(msg.sender,address(this),tokenId);
        expectedNft=address(0);expectedFrom=address(0);emit Staked(id,msg.sender,poolId);
    }
    function earned(uint256 id) public view returns(uint256){
        Position memory s=positions[id];if(!s.active)return 0;Pool memory p=pools[s.poolId];uint256 elapsed=block.timestamp-s.start;if(elapsed>p.duration)elapsed=p.duration;
        // Before maturity, rewards are shown but are paid on exit with the configured penalty.
        return s.reserved*elapsed/p.duration;
    }
    function claim(uint256 id) external nonReentrant {
        Position storage s=positions[id];Pool storage p=pools[s.poolId];require(s.active && s.holder==msg.sender && block.timestamp>=s.start+p.duration,'Position not mature');
        uint256 amount=s.reserved-s.claimed;s.claimed=s.reserved;credit[s.poolId][msg.sender]+=amount;
    }
    function unstake(uint256 id,address to) external nonReentrant {
        Position storage s=positions[id];require(s.active && s.holder==msg.sender && to!=address(0),'Holder');Pool storage p=pools[s.poolId];
        uint256 accrued=earned(id);if(block.timestamp<s.start+p.duration) accrued=accrued*(10000-p.earlyPenaltyBps)/10000;
        uint256 due=accrued-s.claimed;credit[s.poolId][msg.sender]+=due;p.available+=s.reserved-accrued;s.active=false;
        if(p.is1155)IERC1155(p.nft).safeTransferFrom(address(this),to,s.tokenId,s.quantity,'');else IERC721(p.nft).safeTransferFrom(address(this),to,s.tokenId);
        emit Unstaked(id);
    }
    function withdrawReward(uint256 poolId,address payable to) external nonReentrant {
        uint256 amount=credit[poolId][msg.sender];require(amount>0 && to!=address(0),'No reward');credit[poolId][msg.sender]=0;_pay(pools[poolId].reward,to,amount);
    }
    function _pay(address token,address payable to,uint256 amount) internal {if(token==address(0)){(bool ok,)=to.call{value:amount}('');require(ok,'Payment failed');}else IERC20(token).safeTransfer(to,amount);}
    function onERC721Received(address operator,address from,uint256 id,bytes calldata) external view returns(bytes4){require(operator==address(this) && msg.sender==expectedNft && from==expectedFrom && id==expectedId,'Use stake');return this.onERC721Received.selector;}
    function onERC1155Received(address operator,address from,uint256 id,uint256 value,bytes calldata) external view returns(bytes4){require(operator==address(this) && msg.sender==expectedNft && from==expectedFrom && id==expectedId && value==expectedQuantity,'Use stake');return this.onERC1155Received.selector;}
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external pure returns(bytes4){revert('Use stake');}
    function supportsInterface(bytes4 id) external pure returns(bool){return id==type(IERC165).interfaceId || id==type(IERC1155Receiver).interfaceId || id==type(IERC721Receiver).interfaceId;}
}
