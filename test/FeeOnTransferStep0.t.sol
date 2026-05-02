// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockFeeOnTransferToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title FeeOnTransferStep0Test
/// @notice Tests that the aggregator handles fee-on-transfer tokens correctly
///         in step 0 by using swapAmount (balance-diff computed) instead of
///         validating step.amountIn.
contract FeeOnTransferStep0Test is Test {
    OmnomSwapAggregator public aggregator;
    MockFeeOnTransferToken public feeToken;
    MockERC20 public outputToken;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 25; // 0.25% protocol fee
    uint256 constant TOKEN_FEE_BPS = 300; // 3% token transfer tax

    function setUp() public {
        vm.startPrank(owner);

        // Deploy WWDOGE mock
        wwdoge = new MockWWDOGE();

        // Deploy aggregator
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        // Deploy tokens
        feeToken = new MockFeeOnTransferToken("FeeToken", "FEE", 18, TOKEN_FEE_BPS, treasury);
        outputToken = new MockERC20("Output", "OUT", 18);

        // Deploy router and register
        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user with fee tokens
        feeToken.mint(user, SWAP_AMOUNT * 100);

        // Fund router with output tokens
        outputToken.mint(address(router), SWAP_AMOUNT * 1000);
    }

    /// @dev Helper: build a single-step SwapRequest
    function _buildRequest(
        uint256 totalAmountIn,
        uint256 stepAmountIn,
        uint256 minAmountOut
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path = new address[](2);
        path[0] = address(feeToken);
        path[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: stepAmountIn,
            minAmountOut: minAmountOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: address(feeToken),
            tokenOut: address(outputToken),
            amountIn: totalAmountIn,
            minTotalAmountOut: minAmountOut,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });
    }

    // ─── Test 1: Fee-on-transfer swap succeeds with any step.amountIn ───────
    // The contract should ignore step.amountIn for step 0 and use swapAmount.
    function test_feeOnTransfer_swapSucceeds() public {
        uint256 amount = 1000e18;

        // Approve aggregator
        vm.prank(user);
        feeToken.approve(address(aggregator), amount);

        // Calculate expected values:
        // User sends 1000 tokens, contract receives 970 (3% fee)
        // Protocol fee: 970 * 25 / 10000 = 2.425
        // swapAmount: 970 - 2.425 = 967.575
        // Router output: 967.575 * 2 = 1935.15
        uint256 minOut = 1900e18; // well below expected

        // Pass totalAmountIn as step.amountIn (the contract ignores it for step 0)
        OmnomSwapAggregator.SwapRequest memory req = _buildRequest(amount, amount, minOut);

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received output tokens");

        // Verify: received ≈ 967.575 * 2 = 1935.15 tokens
        // Allow small rounding difference
        assertApproxEqAbs(received, 1935.15e18, 0.01e18, "Output amount mismatch");
    }

    // ─── Test 2: step.amountIn is ignored for step 0 ───────────────────────
    // Even a wildly wrong step.amountIn should work since contract uses swapAmount.
    function test_feeOnTransfer_wrongStepAmountInStillWorks() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        feeToken.approve(address(aggregator), amount);

        // Deliberately pass 1 as step.amountIn (completely wrong)
        OmnomSwapAggregator.SwapRequest memory req = _buildRequest(amount, 1, 0);
        req.minTotalAmountOut = 0;

        vm.prank(user);
        aggregator.executeSwap(req);

        // Should succeed — step.amountIn is ignored for step 0
        assertGt(outputToken.balanceOf(recipient), 0, "Should have received tokens");
    }

    // ─── Test 3: Non-fee token still works correctly ────────────────────────
    function test_normalToken_swapSucceeds() public {
        MockERC20 normalToken = new MockERC20("Normal", "NRM", 18);
        normalToken.mint(user, SWAP_AMOUNT * 100);

        // Fund router
        outputToken.mint(address(router), SWAP_AMOUNT * 1000);

        vm.prank(user);
        normalToken.approve(address(aggregator), SWAP_AMOUNT);

        address[] memory path = new address[](2);
        path[0] = address(normalToken);
        path[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: SWAP_AMOUNT, // doesn't matter for step 0
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(normalToken),
            tokenOut: address(outputToken),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // For normal token: no transfer fee, so received = SWAP_AMOUNT
        // swapAmount = SWAP_AMOUNT - fee = 1000 - 2.5 = 997.5
        // output = 997.5 * 2 = 1995
        assertApproxEqAbs(outputToken.balanceOf(recipient), 1995e18, 0.01e18);
    }

    // ─── Test 4: Integer rounding doesn't cause mismatch ────────────────────
    // Test with an amount that creates rounding issues.
    function test_feeOnTransfer_roundingEdgeCase() public {
        // Use 999 wei — tiny amount that causes rounding edge cases
        uint256 amount = 999;

        feeToken.mint(user, amount);
        vm.prank(user);
        feeToken.approve(address(aggregator), amount);

        OmnomSwapAggregator.SwapRequest memory req = _buildRequest(amount, amount, 0);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Just verify it doesn't revert
        assertGt(outputToken.balanceOf(recipient), 0);
    }

    // ─── Test 5: Treasury receives correct fee from fee-on-transfer token ───
    function test_feeOnTransfer_treasuryFeeCorrect() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        feeToken.approve(address(aggregator), amount);

        uint256 treasuryBefore = feeToken.balanceOf(treasury);

        OmnomSwapAggregator.SwapRequest memory req = _buildRequest(amount, amount, 0);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Token transfer tax: 1000 * 3% = 30 tokens go to feeRecipient (treasury)
        // Protocol fee: received=970, fee = 970 * 25 / 10000 = 2.425 tokens
        // Total treasury fee tokens = 30 (from transfer tax, goes to feeRecipient=treasury)
        // + 2.425 (protocol fee) = 32.425
        uint256 treasuryFee = feeToken.balanceOf(treasury) - treasuryBefore;
        assertApproxEqAbs(treasuryFee, 32.425e18, 0.01e18, "Treasury fee mismatch");
    }

    // ─── Test 6: Multi-hop with fee-on-transfer input ──────────────────────
    // Step 0 uses swapAmount (contract-computed), step 1 uses step.amountIn.
    // For step > 0, the frontend must provide the expected amountIn from the
    // previous step's output.
    function test_feeOnTransfer_multiHopSucceeds() public {
        MockERC20 intermediateToken = new MockERC20("Intermediate", "INT", 18);
        intermediateToken.mint(address(router), SWAP_AMOUNT * 1000);
        outputToken.mint(address(router), SWAP_AMOUNT * 1000);

        uint256 amount = 1000e18;

        vm.prank(user);
        feeToken.approve(address(aggregator), amount);

        // Calculate expected step 0 output:
        // received = 1000 - 3% = 970, fee = 970 * 0.25% = 2.425, swapAmount = 967.575
        // Step 0 output = 967.575 * 2 = 1935.15
        uint256 expectedStep0Output = 967575000000000000000 * 2; // 1935.15e18

        address[] memory path1 = new address[](2);
        path1[0] = address(feeToken);
        path1[1] = address(intermediateToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(intermediateToken);
        path2[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path1,
            amountIn: amount, // ignored for step 0
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path2,
            amountIn: expectedStep0Output, // must match actual output from step 0
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(feeToken),
            tokenOut: address(outputToken),
            amountIn: amount,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertGt(outputToken.balanceOf(recipient), 0, "Should receive output from multi-hop");
    }

    // ─── Test 7: Step > 0 uses step.amountIn from request ─────────────────
    // For steps > 0, the contract uses step.amountIn directly. The frontend
    // must correctly predict the output of each step.
    function test_step1_usesProvidedAmountIn() public {
        MockERC20 normalToken = new MockERC20("Normal", "NRM", 18);
        normalToken.mint(user, SWAP_AMOUNT * 100);

        MockERC20 intermediate = new MockERC20("INT", "INT", 18);
        intermediate.mint(address(router), SWAP_AMOUNT * 1000);
        outputToken.mint(address(router), SWAP_AMOUNT * 1000);

        vm.prank(user);
        normalToken.approve(address(aggregator), SWAP_AMOUNT);

        // Normal token: no transfer fee, fee = SWAP_AMOUNT * 0.25% = 2.5
        // swapAmount = 1000 - 2.5 = 997.5
        // Step 0 output = 997.5 * 2 = 1995
        uint256 expectedStep0Output = 1995e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(normalToken);
        path1[1] = address(intermediate);

        address[] memory path2 = new address[](2);
        path2[0] = address(intermediate);
        path2[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path1,
            amountIn: SWAP_AMOUNT,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path2,
            amountIn: expectedStep0Output,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(normalToken),
            tokenOut: address(outputToken),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // Step 0 output: 1995 intermediate tokens
        // Step 1 output: 1995 * 2 = 3990 output tokens
        assertApproxEqAbs(outputToken.balanceOf(recipient), 3990e18, 0.01e18);
    }
}
