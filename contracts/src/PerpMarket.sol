// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import {IndexOracle} from "./IndexOracle.sol";

contract PerpMarket is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 public constant MM_BPS = 500;
    uint256 public constant FEE_BPS = 10;
    uint256 public constant LIQ_BPS = 50;
    uint256 public constant MAX_STALENESS = 600;

    struct Market {
        uint256 maxLeverage;
        uint256 maxOiTokens;
        int256 fundingK;
        uint256 longOi;
        uint256 shortOi;
        int256 cumFunding;
        uint64 lastAccrual;
        bool listed;
    }

    struct Position {
        int256 size;
        uint256 margin;
        uint256 entryPrice;
        int256 entryCumFunding;
    }

    IERC20 public immutable usdc;
    IndexOracle public immutable oracle;
    address public immutable treasury;
    uint256 public vault;
    mapping(bytes32 => Market) public markets;
    mapping(address => mapping(bytes32 => Position)) private book;

    event MarketListed(bytes32 indexed market, uint256 maxLeverage, uint256 maxOiTokens, int256 fundingK);
    event PositionModified(
        address indexed account,
        bytes32 indexed market,
        int256 size,
        uint256 margin,
        uint256 price,
        int256 realizedPnl,
        uint256 fee
    );
    event Liquidated(address indexed account, bytes32 indexed market, address indexed liquidator, uint256 reward);
    event VaultFunded(uint256 amount);

    error MarketUnknown();
    error AlreadyListed();
    error StalePrice();
    error FlipNotAllowed();
    error OiCapExceeded();
    error InsufficientMargin();
    error NotLiquidatable();
    error VaultInsufficient();

    constructor(IERC20 usdc_, IndexOracle oracle_, address treasury_) Ownable(msg.sender) {
        usdc = usdc_;
        oracle = oracle_;
        treasury = treasury_;
    }

    function listMarket(bytes32 market, uint256 maxLeverage, uint256 maxOiTokens, int256 fundingK) external onlyOwner {
        if (markets[market].listed) revert AlreadyListed();
        markets[market] = Market(maxLeverage, maxOiTokens, fundingK, 0, 0, 0, uint64(block.timestamp), true);
        emit MarketListed(market, maxLeverage, maxOiTokens, fundingK);
    }

    function fundVault(uint256 amount) external nonReentrant {
        vault += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit VaultFunded(amount);
    }

    function modify(bytes32 market, int256 sizeDelta, int256 marginDelta) external nonReentrant {
        Market storage m = markets[market];
        if (!m.listed) revert MarketUnknown();
        uint256 price = freshPrice(market);
        accrue(m, price);

        Position storage p = book[msg.sender][market];
        int256 oldSize = p.size;
        int256 newSize = oldSize + sizeDelta;
        if ((oldSize > 0 && newSize < 0) || (oldSize < 0 && newSize > 0)) revert FlipNotAllowed();

        int256 owed = fundingOwed(oldSize, m.cumFunding, p.entryCumFunding);
        int256 margin = int256(p.margin) - owed;
        int256 vaultBal = int256(vault) + owed;
        int256 realizedPnl;
        uint256 oldAbs = SignedMath.abs(oldSize);
        uint256 newAbs = SignedMath.abs(newSize);
        if (newAbs > oldAbs) {
            p.entryPrice = (oldAbs * p.entryPrice + (newAbs - oldAbs) * price) / newAbs;
        } else if (newAbs < oldAbs) {
            realizedPnl = pnl(oldSize - newSize, p.entryPrice, price);
            margin += realizedPnl;
            vaultBal -= realizedPnl;
        }
        p.entryCumFunding = m.cumFunding;

        uint256 fee = Math.ceilDiv(SignedMath.abs(sizeDelta) * price * FEE_BPS, 1e6 * 10_000);
        margin = margin - int256(fee) + marginDelta;

        if (oldSize > 0 || newSize > 0) m.longOi = m.longOi + newAbs - oldAbs;
        else m.shortOi = m.shortOi + newAbs - oldAbs;
        if (newAbs > oldAbs && (newSize > 0 ? m.longOi : m.shortOi) > m.maxOiTokens) revert OiCapExceeded();

        uint256 payout;
        if (newSize == 0) {
            if (margin < 0) {
                if (marginDelta < 0) revert InsufficientMargin();
                vaultBal += margin;
            } else {
                payout = uint256(margin);
            }
            delete book[msg.sender][market];
        } else {
            if (margin < 0) revert InsufficientMargin();
            p.size = newSize;
            p.margin = uint256(margin);
            int256 eq = margin + pnl(newSize, p.entryPrice, price);
            if ((newAbs > oldAbs || marginDelta < 0) && eq * int256(m.maxLeverage) < int256(notional(newSize, price))) {
                revert InsufficientMargin();
            }
        }
        if (vaultBal < 0) revert VaultInsufficient();
        vault = uint256(vaultBal);

        if (marginDelta > 0) usdc.safeTransferFrom(msg.sender, address(this), uint256(marginDelta));
        if (fee > 0) usdc.safeTransfer(treasury, fee);
        uint256 out = payout + (marginDelta < 0 ? uint256(-marginDelta) : 0);
        if (out > 0) usdc.safeTransfer(msg.sender, out);
        emit PositionModified(msg.sender, market, newSize, p.margin, price, realizedPnl, fee);
    }

    function liquidate(address account, bytes32 market) external nonReentrant {
        Market storage m = markets[market];
        if (!m.listed) revert MarketUnknown();
        uint256 price = freshPrice(market);
        accrue(m, price);

        Position memory p = book[account][market];
        if (p.size == 0) revert NotLiquidatable();
        int256 eq = equityAt(p, price, m.cumFunding);
        uint256 n = notional(p.size, price);
        if (eq * 10_000 >= int256(n * MM_BPS)) revert NotLiquidatable();

        uint256 reward = eq > 0 ? Math.min(uint256(eq), n * LIQ_BPS / 10_000) : 0;
        int256 vaultBal = int256(vault) + int256(p.margin) - int256(reward);
        if (vaultBal < 0) revert VaultInsufficient();
        vault = uint256(vaultBal);
        if (p.size > 0) m.longOi -= uint256(p.size);
        else m.shortOi -= uint256(-p.size);
        delete book[account][market];

        if (reward > 0) usdc.safeTransfer(msg.sender, reward);
        emit Liquidated(account, market, msg.sender, reward);
    }

    function positions(address account, bytes32 market) external view returns (Position memory) {
        return book[account][market];
    }

    function equity(address account, bytes32 market) external view returns (int256) {
        (uint256 price,) = oracle.latest(market);
        return equityAt(book[account][market], price, cumFundingAt(markets[market], price));
    }

    function canLiquidate(address account, bytes32 market) external view returns (bool) {
        Position memory p = book[account][market];
        if (p.size == 0) return false;
        (uint256 price,) = oracle.latest(market);
        int256 eq = equityAt(p, price, cumFundingAt(markets[market], price));
        return eq * 10_000 < int256(notional(p.size, price) * MM_BPS);
    }

    function fundingRate(bytes32 market) external view returns (int256) {
        return rate(markets[market]);
    }

    function rate(Market storage m) private view returns (int256) {
        uint256 total = Math.max(m.longOi + m.shortOi, 1e6);
        return m.fundingK * (int256(m.longOi) - int256(m.shortOi)) / int256(total);
    }

    function freshPrice(bytes32 market) private view returns (uint256) {
        (uint256 price, uint64 updatedAt) = oracle.latest(market);
        if (updatedAt == 0 || block.timestamp - updatedAt > MAX_STALENESS) revert StalePrice();
        return price;
    }

    function cumFundingAt(Market storage m, uint256 price) private view returns (int256) {
        return m.cumFunding + rate(m) * int256(block.timestamp - m.lastAccrual) * int256(price);
    }

    function accrue(Market storage m, uint256 price) private {
        m.cumFunding = cumFundingAt(m, price);
        m.lastAccrual = uint64(block.timestamp);
    }

    function equityAt(Position memory p, uint256 price, int256 cum) private pure returns (int256) {
        return int256(p.margin) + pnl(p.size, p.entryPrice, price) - fundingOwed(p.size, cum, p.entryCumFunding);
    }

    function fundingOwed(int256 size, int256 cum, int256 entryCum) private pure returns (int256) {
        return size * (cum - entryCum) / 1e24;
    }

    function pnl(int256 size, uint256 entryPrice, uint256 price) private pure returns (int256) {
        return size * (int256(price) - int256(entryPrice)) / 1e6;
    }

    function notional(int256 size, uint256 price) private pure returns (uint256) {
        return SignedMath.abs(size) * price / 1e6;
    }
}
