// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IndexOracle is Ownable {
    uint256 public constant MAX_MOVE_BPS = 1000;

    struct Price {
        uint256 priceMicroPerMTok;
        uint64 updatedAt;
    }

    address public keeper;
    mapping(bytes32 => Price) public latest;

    event IndexPosted(bytes32 indexed market, uint256 priceMicroPerMTok, uint64 hcsSeqFrom, uint64 hcsSeqTo);

    error PriceMoveTooLarge();
    error NotKeeper();
    error ZeroPrice();

    constructor(address keeper_) Ownable(msg.sender) {
        keeper = keeper_;
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
    }

    function post(bytes32 market, uint256 priceMicroPerMTok, uint64 hcsSeqFrom, uint64 hcsSeqTo) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (priceMicroPerMTok == 0) revert ZeroPrice();
        uint256 last = latest[market].priceMicroPerMTok;
        if (last != 0) {
            uint256 move = priceMicroPerMTok > last ? priceMicroPerMTok - last : last - priceMicroPerMTok;
            if (move * 10_000 > last * MAX_MOVE_BPS) revert PriceMoveTooLarge();
        }
        latest[market] = Price(priceMicroPerMTok, uint64(block.timestamp));
        emit IndexPosted(market, priceMicroPerMTok, hcsSeqFrom, hcsSeqTo);
    }
}
