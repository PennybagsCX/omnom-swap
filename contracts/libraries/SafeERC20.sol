// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @title SafeERC20
 * @notice Wraps ERC20 token operations with safety checks.
 *         Handles non-standard tokens that do not return bool on transfer/approve.
 */
library SafeERC20 {
    // ============================================================
    // Errors
    // ============================================================

    /// @notice Emitted when a token `transferFrom` call fails.
    error SafeTransferFromFailed(address from, address to, uint256 amount);

    /// @notice Emitted when a token `transfer` call fails.
    error SafeTransferFailed(address to, uint256 amount);

    /// @notice Emitted when a token `approve` call fails.
    error SafeApproveFailed(address spender, uint256 amount);

    // ============================================================
    // Internal Helpers
    // ============================================================

    /**
     * @notice Safely transfers tokens from `from` to `to` using `transferFrom`.
     * @param token The ERC20 token address.
     * @param from  The sender address.
     * @param to    The recipient address.
     * @param amount The number of tokens to transfer.
     */
    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        bool success = IERC20(token).transferFrom(from, to, amount);
        if (!success) {
            revert SafeTransferFromFailed(from, to, amount);
        }
    }

    /**
     * @notice Safely transfers tokens from the caller to `to`.
     * @param token  The ERC20 token address.
     * @param to     The recipient address.
     * @param amount The number of tokens to transfer.
     */
    function safeTransfer(address token, address to, uint256 amount) internal {
        bool success = IERC20(token).transfer(to, amount);
        if (!success) {
            revert SafeTransferFailed(to, amount);
        }
    }

    /**
     * @notice Safely approves `spender` to spend `amount` tokens.
     *         Handles tokens that require resetting approval to 0 first (e.g., USDT).
     * @param token   The ERC20 token address.
     * @param spender The address to approve.
     * @param amount  The allowance to set.
     */
    function safeApprove(address token, address spender, uint256 amount) internal {
        // First, reset approval to 0 if current allowance is non-zero.
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance != 0) {
            bool resetOk = IERC20(token).approve(spender, 0);
            if (!resetOk) {
                revert SafeApproveFailed(spender, 0);
            }
        }
        // Now set the desired allowance.
        bool setOk = IERC20(token).approve(spender, amount);
        if (!setOk) {
            revert SafeApproveFailed(spender, amount);
        }
    }
}
