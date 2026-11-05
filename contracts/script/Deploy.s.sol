// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IndexOracle} from "../src/IndexOracle.sol";
import {PerpMarket} from "../src/PerpMarket.sol";

contract Deploy is Script {
    uint256 constant VAULT = 50_000e6;
    uint256 constant MAX_LEVERAGE = 5;
    uint256 constant MAX_OI_TOKENS = 10_000e6;
    int256 constant FUNDING_K = 277_777_777_777;

    function run() external {
        uint256 key = vm.envUint("KEEPER_PRIVATE_KEY");
        address keeper = vm.addr(key);
        vm.startBroadcast(key);
        MockUSDC usdc = new MockUSDC(VAULT);
        IndexOracle oracle = new IndexOracle(keeper);
        PerpMarket market = new PerpMarket(usdc, oracle, keeper);
        market.listMarket(keccak256(bytes("glm-5.3")), MAX_LEVERAGE, MAX_OI_TOKENS, FUNDING_K);
        market.listMarket(keccak256(bytes("deepseek-v4.1-flash")), MAX_LEVERAGE, MAX_OI_TOKENS, FUNDING_K);
        usdc.approve(address(market), VAULT);
        market.fundVault(VAULT);
        vm.stopBroadcast();
        console.log("NEXT_PUBLIC_MOCK_USDC=%s", address(usdc));
        console.log("NEXT_PUBLIC_INDEX_ORACLE=%s", address(oracle));
        console.log("NEXT_PUBLIC_PERP_MARKET=%s", address(market));
        console.log("PERP_DEPLOY_BLOCK=%s", block.number);
    }
}
