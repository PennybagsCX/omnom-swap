// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {MockERC20} from "./MockERC20.sol";

/**
 * @title MockWWDOGE
 * @notice A mock WWDOGE (wrapped native DOGE) contract for testing.
 *         Mimics the WETH9/WWDOGE deposit/withdraw pattern.
 *         NOT for production use.
 */
contract MockWWDOGE is MockERC20 {
    // ============================================================
    // Constructor
    // ============================================================

    constructor() MockERC20("Wrapped DOGE", "WWDOGE", 18) {}

    // ============================================================
    // External Functions
    // ============================================================

    /// @notice Wraps native DOGE into WWDOGE.
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    /// @notice Unwraps WWDOGE into native DOGE.
    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "Insufficient balance");
        balanceOf[msg.sender] -= wad;
        totalSupply -= wad;
        emit Transfer(msg.sender, address(0), wad);

        (bool success, ) = msg.sender.call{value: wad}("");
        require(success, "Transfer failed");
    }

    /// @notice Allow receiving native DOGE via deposit.
    receive() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }
}
