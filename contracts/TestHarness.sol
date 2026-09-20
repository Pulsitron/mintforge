// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// Test-only contracts. Not included in the website's deployment artifacts.
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
interface ITestMint {function mint(uint256,bytes32[] calldata) external payable;}
contract BlockableReward is ERC20 {
 bool public blocked;
 constructor() ERC20('Test reward','TST'){_mint(msg.sender,1000000 ether);}
 function setBlocked(bool value) external {blocked=value;}
 function _update(address from,address to,uint256 value) internal override {require(!blocked,'Blocked');super._update(from,to,value);}
}
contract MintReentry is IERC721Receiver {
 address private target; bool public blocked;
 function attack(address nft) external {target=nft;ITestMint(nft).mint(1,new bytes32[](0));}
 function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4){try ITestMint(target).mint(1,new bytes32[](0)) {} catch{blocked=true;}return this.onERC721Received.selector;}
}
