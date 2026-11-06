// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IndexOracle} from "../src/IndexOracle.sol";
import {PerpMarket} from "../src/PerpMarket.sol";

contract PerpMarketTest is Test {
    int256 constant FUNDING_K = 277_777_777_777;
    uint256 constant P0 = 5_000_000;
    bytes32 constant M = keccak256(bytes("glm-5.3"));

    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MockUSDC usdc;
    IndexOracle oracle;
    PerpMarket pm;

    function setUp() public {
        usdc = new MockUSDC(1_000_000e6);
        oracle = new IndexOracle(keeper);
        pm = deployMarket(50_000e6);
        post(M, P0);
        fund(alice, address(pm));
        fund(bob, address(pm));
    }

    function deployMarket(uint256 vaultAmount) internal returns (PerpMarket market) {
        market = new PerpMarket(usdc, oracle, treasury);
        market.listMarket(M, 5, 1_000e6, FUNDING_K);
        usdc.approve(address(market), vaultAmount);
        if (vaultAmount > 0) market.fundVault(vaultAmount);
    }

    function fund(address who, address spender) internal {
        usdc.transfer(who, 10_000e6);
        vm.prank(who);
        usdc.approve(spender, type(uint256).max);
    }

    function post(bytes32 market, uint256 price) internal {
        vm.prank(keeper);
        oracle.post(market, price, 1, 1);
    }

    function trade(address who, int256 sizeDelta, int256 marginDelta) internal {
        vm.prank(who);
        pm.modify(M, sizeDelta, marginDelta);
    }

    function assertSolvent() internal view {
        uint256 margins = pm.positions(alice, M).margin + pm.positions(bob, M).margin;
        assertEq(usdc.balanceOf(address(pm)), pm.vault() + margins);
    }

    function fee(uint256 size, uint256 price) internal pure returns (uint256) {
        return (size * price * 10 + 1e10 - 1) / 1e10;
    }

    function test_LongPnlAndFeeToTreasury() public {
        uint256 before = usdc.balanceOf(alice);
        trade(alice, 100e6, 200e6);
        post(M, 5_250_000);
        trade(alice, -100e6, 0);
        assertEq(usdc.balanceOf(alice), before - 200e6 + 200e6 - 500_000 + 25e6 - 525_000);
        assertEq(usdc.balanceOf(treasury), 500_000 + 525_000);
        assertEq(pm.positions(alice, M).size, 0);
        assertEq(pm.vault(), 50_000e6 - 25e6);
        assertSolvent();
    }

    function test_ShortPnl() public {
        uint256 before = usdc.balanceOf(bob);
        trade(bob, -100e6, 200e6);
        post(M, 4_750_000);
        trade(bob, 100e6, 0);
        assertEq(usdc.balanceOf(bob), before + 25e6 - 500_000 - 475_000);
        assertSolvent();
    }

    function test_ReduceRealizesPnlAndKeepsEntry() public {
        trade(alice, 100e6, 200e6);
        post(M, 5_500_000);
        trade(alice, -50e6, 0);
        PerpMarket.Position memory p = pm.positions(alice, M);
        assertEq(p.size, 50e6);
        assertEq(p.entryPrice, P0);
        assertEq(p.margin, 200e6 - 500_000 + 25e6 - fee(50e6, 5_500_000));
        assertSolvent();
    }

    function test_IncreaseAveragesEntry() public {
        trade(alice, 100e6, 300e6);
        post(M, 5_500_000);
        trade(alice, 100e6, 0);
        assertEq(pm.positions(alice, M).entryPrice, 5_250_000);
    }

    function test_FundingLongPaysShortReceives() public {
        trade(alice, 100e6, 200e6);
        trade(bob, -50e6, 100e6);
        int256 aliceEq = pm.equity(alice, M);
        int256 bobEq = pm.equity(bob, M);

        skip(300);
        post(M, P0);

        int256 rate = FUNDING_K * 50e6 / 150e6;
        int256 cum = rate * 300 * int256(P0);
        assertEq(pm.fundingRate(M), rate);
        assertEq(aliceEq - pm.equity(alice, M), 100e6 * cum / 1e24);
        assertEq(pm.equity(bob, M) - bobEq, 50e6 * cum / 1e24);
        assertGt(100e6 * cum / 1e24, 0);
    }

    function test_FundingFullSkewIsPointOnePercentPerHour() public {
        trade(alice, 100e6, 200e6);
        for (uint256 i = 0; i < 12; i++) {
            skip(300);
            post(M, P0);
        }
        int256 owed = int256(200e6 - 500_000) - pm.equity(alice, M);
        assertApproxEqAbs(owed, 500_000, 1);

        uint256 before = usdc.balanceOf(alice);
        trade(alice, -100e6, 0);
        assertEq(usdc.balanceOf(alice) - before, uint256(200e6 - 500_000 - owed) - fee(100e6, P0));
        assertSolvent();
    }

    function test_InitialMarginRejected() public {
        vm.prank(alice);
        vm.expectRevert(PerpMarket.InsufficientMargin.selector);
        pm.modify(M, 100e6, 100e6);
        trade(alice, 100e6, 100e6 + 500_000);
        assertEq(pm.equity(alice, M), 100e6);
    }

    function test_WithdrawBelowInitialMarginRejected() public {
        trade(alice, 100e6, 200e6);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.InsufficientMargin.selector);
        pm.modify(M, 0, -100e6);
        trade(alice, 0, -99e6);
        assertSolvent();
    }

    function test_LosingTraderCanAddMarginAndReduce() public {
        trade(alice, 100e6, 101e6);
        post(M, 4_500_000);
        trade(alice, 0, 10e6);
        trade(alice, -10e6, 0);
        assertEq(pm.positions(alice, M).size, 90e6);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.InsufficientMargin.selector);
        pm.modify(M, 0, -1);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.InsufficientMargin.selector);
        pm.modify(M, 1e6, 0);
        assertSolvent();
    }

    function test_LiquidationBoundaryAndReward() public {
        trade(alice, 100e6, 101e6);
        post(M, 4_600_000);
        post(M, 4_205_264);
        assertFalse(pm.canLiquidate(alice, M));
        vm.prank(bob);
        vm.expectRevert(PerpMarket.NotLiquidatable.selector);
        pm.liquidate(alice, M);

        post(M, 4_205_263);
        assertTrue(pm.canLiquidate(alice, M));
        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 vaultBefore = pm.vault();
        vm.prank(bob);
        pm.liquidate(alice, M);

        uint256 reward = 2_102_631;
        assertEq(usdc.balanceOf(bob) - bobBefore, reward);
        assertEq(pm.vault(), vaultBefore + 100_500_000 - reward);
        assertEq(pm.positions(alice, M).size, 0);
        (,,, uint256 longOi,,,,) = pm.markets(M);
        assertEq(longOi, 0);
        assertSolvent();
    }

    function test_ShortLiquidationBoundary() public {
        trade(bob, -100e6, 101e6);
        post(M, 5_500_000);
        post(M, 5_719_047);
        assertFalse(pm.canLiquidate(bob, M));
        post(M, 5_719_048);
        assertTrue(pm.canLiquidate(bob, M));
    }

    function test_StalePriceReverts() public {
        skip(600);
        trade(alice, 10e6, 20e6);
        skip(1);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.StalePrice.selector);
        pm.modify(M, 10e6, 20e6);
    }

    function test_UnpostedMarketIsStale() public {
        bytes32 other = keccak256(bytes("deepseek-v4.1-flash"));
        pm.listMarket(other, 5, 1_000e6, FUNDING_K);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.StalePrice.selector);
        pm.modify(other, 10e6, 10e6);
    }

    function test_FlipReverts() public {
        trade(alice, 10e6, 20e6);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.FlipNotAllowed.selector);
        pm.modify(M, -20e6, 0);
    }

    function test_OiCap() public {
        trade(alice, 1_000e6, 2_000e6);
        vm.prank(bob);
        vm.expectRevert(PerpMarket.OiCapExceeded.selector);
        pm.modify(M, 1, 1e6);
        trade(bob, -1_000e6, 2_000e6);
    }

    function test_VaultInsufficient() public {
        pm = deployMarket(0);
        fund(alice, address(pm));
        trade(alice, 100e6, 200e6);
        post(M, 5_250_000);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.VaultInsufficient.selector);
        pm.modify(M, -100e6, 0);
    }

    function test_UnderwaterClosePaysZero() public {
        trade(alice, 100e6, 101e6);
        post(M, 4_600_000);
        post(M, 4_200_000);
        post(M, 3_900_000);
        assertLt(pm.equity(alice, M), 0);
        uint256 before = usdc.balanceOf(alice);
        trade(alice, -100e6, 0);
        assertEq(usdc.balanceOf(alice), before);
        assertEq(pm.vault(), 50_000e6 + 101e6 - 500_000 - fee(100e6, 3_900_000));
        assertSolvent();
    }

    function test_UnderwaterCloseCannotWithdraw() public {
        trade(alice, 100e6, 101e6);
        post(M, 4_600_000);
        post(M, 4_200_000);
        post(M, 3_900_000);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.InsufficientMargin.selector);
        pm.modify(M, -100e6, -1);
    }

    function test_UnknownMarketReverts() public {
        vm.prank(alice);
        vm.expectRevert(PerpMarket.MarketUnknown.selector);
        pm.modify(keccak256("nope"), 1e6, 1e6);
    }

    function test_ListTwiceReverts() public {
        vm.expectRevert(PerpMarket.AlreadyListed.selector);
        pm.listMarket(M, 5, 1, 1);
    }

    function test_OracleMoveGuardAndFirstPost() public {
        bytes32 fresh = keccak256(bytes("claude-opus-5.5"));
        post(fresh, 123_456_789);
        post(M, 5_500_000);
        vm.prank(keeper);
        vm.expectRevert(IndexOracle.PriceMoveTooLarge.selector);
        oracle.post(M, 6_050_001, 2, 2);
        post(M, 6_050_000);
        (uint256 price, uint64 at) = oracle.latest(M);
        assertEq(price, 6_050_000);
        assertEq(at, block.timestamp);
    }

    function test_OracleRejectsNonKeeperAndZero() public {
        vm.expectRevert(IndexOracle.NotKeeper.selector);
        oracle.post(M, P0, 1, 1);
        vm.prank(keeper);
        vm.expectRevert(IndexOracle.ZeroPrice.selector);
        oracle.post(M, 0, 1, 1);
    }

    function test_MintCap() public {
        usdc.mint(alice, 1_000e6);
        vm.expectRevert(MockUSDC.MintCapExceeded.selector);
        usdc.mint(alice, 1_000e6 + 1);
    }

    function testFuzz_RoundTripConservesCash(
        uint256 size,
        uint256 margin,
        uint256 moveBps,
        bool long,
        bool up,
        uint256 dt
    ) public {
        size = bound(size, 1e6, 1_000e6);
        uint256 minMargin = size * P0 / 1e6 / 5 + fee(size, P0) + 1;
        margin = bound(margin, minMargin, 10_000e6);
        moveBps = bound(moveBps, 0, 1000);
        dt = bound(dt, 0, 600);
        int256 s = long ? int256(size) : -int256(size);
        uint256 total =
            usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(address(pm)) + usdc.balanceOf(treasury);

        trade(alice, s, int256(margin));
        skip(dt);
        post(M, up ? P0 * (10_000 + moveBps) / 10_000 : P0 * (10_000 - moveBps) / 10_000);
        if (pm.canLiquidate(alice, M)) {
            vm.prank(bob);
            pm.liquidate(alice, M);
        } else {
            trade(alice, -s, 0);
        }

        assertEq(
            usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(address(pm)) + usdc.balanceOf(treasury), total
        );
        assertEq(pm.positions(alice, M).size, 0);
        (,,, uint256 longOi, uint256 shortOi,,,) = pm.markets(M);
        assertEq(longOi + shortOi, 0);
        assertSolvent();
    }
}
