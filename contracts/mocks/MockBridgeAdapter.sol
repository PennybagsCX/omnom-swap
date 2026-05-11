// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @title MockBridgeAdapter
 * @notice A simple mock bridge adapter that simulates cross-chain bridging for testing.
 *         Supports configurable bridge fees, request tracking, and failure injection.
 */
contract MockBridgeAdapter {
    // ============================================================
    // Types
    // ============================================================

    enum BridgeStatus { Pending, Completed, Failed }

    struct BridgeRequest {
        address token;
        uint256 amount;
        uint256 targetChainId;
        address recipient;
        BridgeStatus status;
    }

    // ============================================================
    // State
    // ============================================================

    mapping(uint256 => BridgeRequest) public bridgeRequests;
    uint256 public nextRequestId = 1;

    /// @notice When true, bridge() reverts on the next call.
    bool public shouldFail;

    /// @notice Bridge fee in basis points (default 0.1%).
    uint256 public bridgeFeeBps = 10;

    /// @notice Address that receives bridge fees.
    address public feeRecipient;

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param feeRecipient_ The address that receives bridge fees.
     */
    constructor(address feeRecipient_) {
        feeRecipient = feeRecipient_;
    }

    // ============================================================
    // External Functions
    // ============================================================

    /**
     * @notice Initiates a bridge transfer, deducting a fee.
     * @param token         The ERC20 token to bridge.
     * @param amount        The amount of tokens to bridge.
     * @param targetChainId The destination chain ID.
     * @param recipient     The recipient address on the target chain.
     * @return requestId    The unique bridge request ID.
     */
    function bridge(
        address token,
        uint256 amount,
        uint256 targetChainId,
        address recipient
    ) external returns (uint256 requestId) {
        if (shouldFail) revert("Bridge: operation failed");

        // Calculate fee
        uint256 fee = (amount * bridgeFeeBps) / 10000;
        uint256 amountAfterFee = amount - fee;

        // Transfer tokens from sender to this contract
        IERC20(token).transferFrom(msg.sender, address(this), amount);

        // Send fee to fee recipient
        if (fee > 0) {
            IERC20(token).transfer(feeRecipient, fee);
        }

        requestId = nextRequestId++;
        bridgeRequests[requestId] = BridgeRequest({
            token: token,
            amount: amountAfterFee,
            targetChainId: targetChainId,
            recipient: recipient,
            status: BridgeStatus.Pending
        });
    }

    /**
     * @notice Marks a bridge request as completed and transfers tokens to the recipient.
     * @param requestId The bridge request ID to complete.
     */
    function completeBridge(uint256 requestId) external {
        BridgeRequest storage req = bridgeRequests[requestId];
        require(req.status == BridgeStatus.Pending, "Bridge: not pending");
        req.status = BridgeStatus.Completed;
        IERC20(req.token).transfer(req.recipient, req.amount);
    }

    /**
     * @notice Marks a bridge request as failed. Tokens remain in the contract.
     * @param requestId The bridge request ID to fail.
     */
    function failBridge(uint256 requestId) external {
        BridgeRequest storage req = bridgeRequests[requestId];
        require(req.status == BridgeStatus.Pending, "Bridge: not pending");
        req.status = BridgeStatus.Failed;
        // Tokens remain locked in the contract (in a real scenario, would refund the original sender)
    }

    // ============================================================
    // Configuration Functions
    // ============================================================

    /**
     * @notice Sets whether the bridge should fail on the next call.
     * @param fail True to force failure, false for normal operation.
     */
    function setShouldFail(bool fail) external {
        shouldFail = fail;
    }

    /**
     * @notice Sets the bridge fee in basis points.
     * @param bps The new fee in basis points (e.g., 10 = 0.1%).
     */
    function setBridgeFee(uint256 bps) external {
        bridgeFeeBps = bps;
    }
}
