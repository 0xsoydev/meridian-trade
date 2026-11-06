// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    uint256 public constant MINT_CAP = 1_000e6;

    error MintCapExceeded();

    constructor(uint256 initialSupply) ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, initialSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MINT_CAP) revert MintCapExceeded();
        _mint(to, amount);
    }
}
