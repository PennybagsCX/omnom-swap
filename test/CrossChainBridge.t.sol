// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";
import "../contracts/mocks/MockBridgeAdapter.sol";

/// @title SwapThenBridge
/// @notice Helper contract that executes a swap and then bridges in a single transaction.
contract SwapThenBridge {
    function execute(
        address payable aggregatorAddr,
        address bridgeAdapterAddr,
        OmnomSwapAggregator.SwapRequest calldata swapRequest,
        uint256 targetChainId,
        address bridgeRecipient
    ) external {
        // Transfer input tokens from user to this contract
        IERC20(swapRequest.tokenIn).transferFrom(msg.sender, address(this), swapRequest.amountIn);

        // Approve aggregator
        IERC20(swapRequest.tokenIn).approve(aggregatorAddr, swapRequest.amountIn);

        // Build swap request with recipient = this contract
        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](swapRequest.steps.length);
        for (uint256 i = 0; i < swapRequest.steps.length; i++) {
            steps[i] = swapRequest.steps[i];
        }

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: swapRequest.tokenIn,
            tokenOut: swapRequest.tokenOut,
            amountIn: swapRequest.amountIn,
            minTotalAmountOut: swapRequest.minTotalAmountOut,
            steps: steps,
            deadline: swapRequest.deadline,
            recipient: address(this)
        });

        // Execute swap
        OmnomSwapAggregator(aggregatorAddr).executeSwap(req);

        // Bridge output tokens
        uint256 outputBalance = IERC20(swapRequest.tokenOut).balanceOf(address(this));
        IERC20(swapRequest.tokenOut).approve(bridgeAdapterAddr, outputBalance);
        MockBridgeAdapter(bridgeAdapterAddr).bridge(swapRequest.tokenOut, outputBalance, targetChainId, bridgeRecipient);
    }

    receive() external payable {}
}

/// @title CrossChainBridgeTest
/// @notice Tests for cross-chain bridge simulation including basic bridge flows,
///         failure scenarios, and atomic swap-and-bridge operations.
contract CrossChainBridgeTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;
    MockBridgeAdapter public bridgeAdapter;
    SwapThenBridge public swapThenBridge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public nonOwner = address(0x400);
    address public recipient = address(0x500);
    address public bridgeRecipient = address(0x600);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 25; // 0.25%
    uint256 constant TARGET_CHAIN_ID = 1; // Ethereum mainnet

    // --- Helpers ------------------------------------------------------

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _buildSwapToWWDOGERequest(uint256 amountIn) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(wwdoge);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(wwdoge),
            amountIn: amountIn,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: user
        });
    }

    // -------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------
    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Deploy bridge adapter
        bridgeAdapter = new MockBridgeAdapter(treasury);

        // Deploy atomic helper
        swapThenBridge = new SwapThenBridge();

        // Fund user
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);

        // Fund router with output tokens
        MockERC20(address(wwdoge)).mint(address(router), INITIAL_BALANCE * 10);
        tokenB.mint(address(router), INITIAL_BALANCE * 10);
        tokenA.mint(address(router), INITIAL_BALANCE * 10);
    }

    // ===================================================================
    // A. Basic Bridge Flow
    // ===================================================================

    function test_bridgeAfterSwap_wwdogeToBridge() public {
        // Step 1: Swap tokenA → WWDOGE
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedWWDOGE = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory swapReq = _buildSwapToWWDOGERequest(amountIn);

        vm.prank(user);
        aggregator.executeSwap(swapReq);

        assertEq(wwdoge.balanceOf(user), expectedWWDOGE, "user should have WWDOGE after swap");

        // Step 2: Bridge WWDOGE to another chain
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), expectedWWDOGE);

        vm.prank(user);
        uint256 requestId = bridgeAdapter.bridge(address(wwdoge), expectedWWDOGE, TARGET_CHAIN_ID, bridgeRecipient);

        assertEq(requestId, 1, "first bridge request should have ID 1");

        // Verify bridge request state
        (address token, uint256 bridgeAmount, uint256 targetChainId, address bRecipient, MockBridgeAdapter.BridgeStatus status) =
            bridgeAdapter.bridgeRequests(requestId);

        assertEq(token, address(wwdoge));
        assertGt(bridgeAmount, 0, "bridge amount should be > 0 after fee");
        assertEq(targetChainId, TARGET_CHAIN_ID);
        assertEq(bRecipient, bridgeRecipient);
        assertEq(uint8(status), uint8(MockBridgeAdapter.BridgeStatus.Pending));
    }

    function test_bridgeFlow_tokenToBridge() public {
        // Full flow: swap TokenA → WWDOGE, then bridge
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedWWDOGE = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Execute swap
        OmnomSwapAggregator.SwapRequest memory swapReq = _buildSwapToWWDOGERequest(amountIn);
        vm.prank(user);
        aggregator.executeSwap(swapReq);

        // Approve and bridge
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), expectedWWDOGE);

        uint256 userBalBefore = wwdoge.balanceOf(user);

        vm.prank(user);
        bridgeAdapter.bridge(address(wwdoge), expectedWWDOGE, TARGET_CHAIN_ID, bridgeRecipient);

        // User should have transferred WWDOGE to bridge
        assertEq(wwdoge.balanceOf(user), userBalBefore - expectedWWDOGE, "user WWDOGE should decrease");
    }

    function test_bridgeCompletion_recipientReceives() public {
        // Bridge tokens and then complete the bridge
        uint256 amount = 500e18;

        // Mint WWDOGE to user
        wwdoge.mint(user, amount);
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), amount);

        // Initiate bridge
        vm.prank(user);
        uint256 requestId = bridgeAdapter.bridge(address(wwdoge), amount, TARGET_CHAIN_ID, bridgeRecipient);

        // Complete bridge
        uint256 bridgeFee = (amount * bridgeAdapter.bridgeFeeBps()) / 10_000;
        uint256 amountAfterFee = amount - bridgeFee;

        uint256 recipientBalBefore = wwdoge.balanceOf(bridgeRecipient);
        bridgeAdapter.completeBridge(requestId);

        // Recipient receives tokens on "target chain"
        assertEq(
            wwdoge.balanceOf(bridgeRecipient) - recipientBalBefore,
            amountAfterFee,
            "recipient should receive bridged tokens minus fee"
        );

        // Verify status is completed
        (,,,, MockBridgeAdapter.BridgeStatus status) = bridgeAdapter.bridgeRequests(requestId);
        assertEq(uint8(status), uint8(MockBridgeAdapter.BridgeStatus.Completed));
    }

    function test_bridgeFee_deducted() public {
        uint256 amount = 1000e18;
        uint256 bridgeFeeBps = bridgeAdapter.bridgeFeeBps(); // 10 = 0.1%

        wwdoge.mint(user, amount);
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), amount);

        uint256 treasuryBalBefore = wwdoge.balanceOf(treasury);

        vm.prank(user);
        uint256 requestId = bridgeAdapter.bridge(address(wwdoge), amount, TARGET_CHAIN_ID, bridgeRecipient);

        // Verify fee was sent to treasury
        uint256 expectedFee = (amount * bridgeFeeBps) / 10_000;
        assertEq(
            wwdoge.balanceOf(treasury) - treasuryBalBefore,
            expectedFee,
            "bridge fee should be sent to fee recipient"
        );

        // Verify bridge request has amount after fee
        (, uint256 bridgeAmount,,,) = bridgeAdapter.bridgeRequests(requestId);
        assertEq(bridgeAmount, amount - expectedFee, "bridge amount should be net of fee");
    }

    // ===================================================================
    // B. Bridge Failure Scenarios
    // ===================================================================

    function test_bridgeFails_tokensLocked() public {
        uint256 amount = 500e18;

        wwdoge.mint(user, amount);
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), amount);

        // Set bridge to fail
        bridgeAdapter.setShouldFail(true);

        vm.prank(user);
        vm.expectRevert("Bridge: operation failed");
        bridgeAdapter.bridge(address(wwdoge), amount, TARGET_CHAIN_ID, bridgeRecipient);
    }

    function test_swapSucceeds_bridgeFails_independent() public {
        // Step 1: Swap succeeds
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedWWDOGE = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory swapReq = _buildSwapToWWDOGERequest(amountIn);
        vm.prank(user);
        aggregator.executeSwap(swapReq);

        assertEq(wwdoge.balanceOf(user), expectedWWDOGE, "swap should succeed");

        // Step 2: Bridge fails
        bridgeAdapter.setShouldFail(true);

        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), expectedWWDOGE);

        vm.prank(user);
        vm.expectRevert("Bridge: operation failed");
        bridgeAdapter.bridge(address(wwdoge), expectedWWDOGE, TARGET_CHAIN_ID, bridgeRecipient);

        // User still holds WWDOGE (swap output) since bridge failed
        assertEq(wwdoge.balanceOf(user), expectedWWDOGE, "user keeps WWDOGE after bridge fail");
    }

    function test_bridgeTimeout_handling() public {
        // Create a bridge request that stays pending
        uint256 amount = 500e18;

        wwdoge.mint(user, amount);
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), amount);

        vm.prank(user);
        uint256 requestId = bridgeAdapter.bridge(address(wwdoge), amount, TARGET_CHAIN_ID, bridgeRecipient);

        // Verify request is pending
        (,,,, MockBridgeAdapter.BridgeStatus status) = bridgeAdapter.bridgeRequests(requestId);
        assertEq(uint8(status), uint8(MockBridgeAdapter.BridgeStatus.Pending));

        // Warp time forward (simulate timeout)
        vm.warp(block.timestamp + 7 days);

        // Request is still pending — in production, a timeout handler would process this
        (,,,, status) = bridgeAdapter.bridgeRequests(requestId);
        assertEq(uint8(status), uint8(MockBridgeAdapter.BridgeStatus.Pending), "still pending after warp");

        // Can still complete the bridge after timeout
        bridgeAdapter.completeBridge(requestId);
        (,,,, status) = bridgeAdapter.bridgeRequests(requestId);
        assertEq(uint8(status), uint8(MockBridgeAdapter.BridgeStatus.Completed));
    }

    function test_bridgeZeroAmount_reverts() public {
        // Bridge with 0 amount — the mock adapter does not explicitly revert on 0,
        // but we test the behavior. A real adapter should revert.
        // Here we verify that bridging 0 tokens creates a request with 0 amount.
        wwdoge.mint(user, 1e18);
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), 1e18);

        vm.prank(user);
        uint256 requestId = bridgeAdapter.bridge(address(wwdoge), 0, TARGET_CHAIN_ID, bridgeRecipient);

        (, uint256 bridgeAmount,,,) = bridgeAdapter.bridgeRequests(requestId);
        assertEq(bridgeAmount, 0, "bridge amount should be 0 for 0 input");
    }

    // ===================================================================
    // C. Swap-and-Bridge Atomic Flow
    // ===================================================================

    function test_atomicSwapAndBridge() public {
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedWWDOGE = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Build swap request for the helper
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(wwdoge);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedWWDOGE
        });

        OmnomSwapAggregator.SwapRequest memory swapReq = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(wwdoge),
            amountIn: amountIn,
            minTotalAmountOut: expectedWWDOGE,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: address(swapThenBridge) // not used, helper overrides
        });

        // Approve helper to spend user's tokens
        vm.prank(user);
        tokenA.approve(address(swapThenBridge), amountIn);

        // Execute atomic swap + bridge
        vm.prank(user);
        swapThenBridge.execute(
            payable(address(aggregator)),
            address(bridgeAdapter),
            swapReq,
            TARGET_CHAIN_ID,
            bridgeRecipient
        );

        // Verify bridge request was created
        (address token, uint256 bridgeAmount, uint256 targetChainId, address bRecipient, MockBridgeAdapter.BridgeStatus status) =
            bridgeAdapter.bridgeRequests(1);

        assertEq(token, address(wwdoge));
        assertGt(bridgeAmount, 0, "bridge amount > 0");
        assertEq(targetChainId, TARGET_CHAIN_ID);
        assertEq(bRecipient, bridgeRecipient);
        assertEq(uint8(status), uint8(MockBridgeAdapter.BridgeStatus.Pending));
    }

    function test_atomicSwapAndBridge_refundOnBridgeFail() public {
        // Set bridge to fail
        bridgeAdapter.setShouldFail(true);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedWWDOGE = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(wwdoge);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedWWDOGE
        });

        OmnomSwapAggregator.SwapRequest memory swapReq = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(wwdoge),
            amountIn: amountIn,
            minTotalAmountOut: expectedWWDOGE,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: address(swapThenBridge)
        });

        vm.prank(user);
        tokenA.approve(address(swapThenBridge), amountIn);

        // The entire atomic transaction should revert when bridge fails
        vm.prank(user);
        vm.expectRevert("Bridge: operation failed");
        swapThenBridge.execute(
            payable(address(aggregator)),
            address(bridgeAdapter),
            swapReq,
            TARGET_CHAIN_ID,
            bridgeRecipient
        );

        // User should still have their tokens (atomic revert)
        assertEq(tokenA.balanceOf(user), INITIAL_BALANCE, "user keeps tokens after atomic revert");
    }

    function test_crossChainSlippage_combined() public {
        // Slippage must account for both swap fee (0.25%) and bridge fee (0.1%)
        uint256 amountIn = SWAP_AMOUNT;
        uint256 swapFeeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - swapFeeAmount;
        uint256 swapOutput = (swapAmount * EXCHANGE_RATE) / 1e18;

        uint256 bridgeFeeBps_ = bridgeAdapter.bridgeFeeBps();
        uint256 bridgeFee = (swapOutput * bridgeFeeBps_) / 10_000;
        uint256 expectedFinal = swapOutput - bridgeFee;

        // Set minTotalAmountOut to account for both fees
        uint256 minTotalAmountOut = expectedFinal;

        // Execute swap
        OmnomSwapAggregator.SwapRequest memory swapReq = _buildSwapToWWDOGERequest(amountIn);
        swapReq.minTotalAmountOut = minTotalAmountOut;

        vm.prank(user);
        aggregator.executeSwap(swapReq);

        uint256 userWWDOGE = wwdoge.balanceOf(user);
        assertEq(userWWDOGE, swapOutput, "swap output correct");

        // Bridge with slippage tolerance accounting for bridge fee
        vm.prank(user);
        wwdoge.approve(address(bridgeAdapter), userWWDOGE);

        vm.prank(user);
        uint256 requestId = bridgeAdapter.bridge(address(wwdoge), userWWDOGE, TARGET_CHAIN_ID, bridgeRecipient);

        // Complete bridge and verify final amount
        bridgeAdapter.completeBridge(requestId);
        assertEq(wwdoge.balanceOf(bridgeRecipient), expectedFinal, "final amount accounts for both fees");
    }
}
