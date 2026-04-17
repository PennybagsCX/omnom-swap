// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ReentrancyGuard
 * @notice Contract module that helps prevent reentrant calls to a function.
 *         Inheriting contracts can use the `nonReentrant` modifier on functions
 *         that should be protected from reentrancy attacks.
 *
 *         This is a simplified inline implementation based on OpenZeppelin's
 *         ReentrancyGuard, avoiding external dependencies.
 */
abstract contract ReentrancyGuard {
    // ============================================================
    // State
    // ============================================================

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    // ============================================================
    // Errors
    // ============================================================

    /// @notice Emitted when a reentrant call is detected.
    error ReentrancyGuardReentrantCall();

    // ============================================================
    // Constructor
    // ============================================================

    constructor() {
        _status = _NOT_ENTERED;
    }

    // ============================================================
    // Modifier
    // ============================================================

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     *      Calling a `nonReentrant` function from another `nonReentrant`
     *      function is not supported. It will revert with ReentrancyGuardReentrantCall.
     */
    modifier nonReentrant() {
        if (_status == _ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}
