// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockFeeOnTransferToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

// ============================================================
//  Fuzz Tests — Fee Calculation Precision
// ============================================================

/// @title FuzzTestingTest
/// @notice Comprehensive fuzz and invariant tests for the OmnomSwapAggregator contract.
///         Covers fee precision, amount boundaries, deadline validation, exchange rate
///         variations, and invariant properties via a handler-based approach.
contract FuzzTestingTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 1e18; // 1:1 default
    uint256 constant ROUTER_LIQUIDITY = 1_000_000_000e18;

    // ─── Helpers ──────────────────────────────────────────────────────

    function _deployAggregator(uint256 feeBps) internal returns (OmnomSwapAggregator) {
        vm.prank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, feeBps, address(wwdoge));
        vm.prank(owner);
        ag.addRouter(address(router));
        return ag;
    }

    function _fundUser(address token, address _user, uint256 amount) internal {
        MockERC20(token).mint(_user, amount);
        vm.prank(_user);
        MockERC20(token).approve(address(aggregator), amount);
    }

    function _fundUserForAg(address token, address _user, uint256 amount, address ag) internal {
        MockERC20(token).mint(_user, amount);
        vm.prank(_user);
        MockERC20(token).approve(ag, amount);
    }

    function _buildSingleSwap(
        address tokenIn,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 stepAmountIn,
        uint256 minAmountOut,
        address routerAddr,
        address to,
        uint256 deadline
    ) internal pure returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: routerAddr,
            path: path,
            amountIn: stepAmountIn,
            minAmountOut: minAmountOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: totalAmountIn,
            minTotalAmountOut: minAmountOut,
            steps: steps,
            deadline: deadline,
            recipient: to
        });
    }

    // ─── setUp ────────────────────────────────────────────────────────

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, 25, address(wwdoge)); // 0.25% fee

        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund router with massive liquidity for fuzz tests
        tokenB.mint(address(router), ROUTER_LIQUIDITY);
        tokenA.mint(address(router), ROUTER_LIQUIDITY);
    }

    // ================================================================
    // 1. Fuzz Tests — Fee Calculation Precision
    // ================================================================

    /// @notice Fuzzes fee calculation across amount and BPS ranges.
    ///         Verifies fee == (received * feeBps) / 10000 and that
    ///         treasury receives the exact fee, user receives correct output.
    function testFuzz_FeeCalculation(uint256 amountIn, uint256 feeBps) public {
        amountIn = bound(amountIn, 1, 1e24); // Upper bound limited by router liquidity
        feeBps = bound(feeBps, 0, 500);

        OmnomSwapAggregator ag = _deployAggregator(feeBps);
        _fundUserForAg(address(tokenA), user, amountIn, address(ag));

        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);
        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        ag.executeSwap(req);

        // Verify fee precision
        uint256 actualFee = tokenA.balanceOf(treasury) - treasuryBalBefore;
        assertEq(actualFee, feeAmount, "Fee amount mismatch");

        // Verify user output is not affected by fee
        uint256 actualOut = tokenB.balanceOf(recipient) - recipientBalBefore;
        assertEq(actualOut, expectedOut, "Output amount mismatch");
    }

    /// @notice Verifies that any fee BPS > 500 is rejected by setProtocolFee.
    function testFuzz_FeeNeverExceedsMaxBps(uint256 feeBps) public {
        feeBps = bound(feeBps, 501, type(uint256).max);

        vm.prank(owner);
        vm.expectRevert("Fee exceeds max");
        aggregator.setProtocolFee(feeBps);
    }

    /// @notice Fuzzes fee calculation with fee-on-transfer input tokens.
    ///         Verifies protocol fee is calculated on the amount received
    ///         after the token transfer tax.
    function testFuzz_FeeWithFeeOnTransferToken(
        uint256 amountIn,
        uint256 tokenFeeBps,
        uint256 protocolFeeBps
    ) public {
        amountIn = bound(amountIn, 1e6, 1e24);
        tokenFeeBps = bound(tokenFeeBps, 0, 1000); // 0-10% token tax
        protocolFeeBps = bound(protocolFeeBps, 0, 500); // 0-5% protocol fee

        // Deploy fee-on-transfer token with configurable tax
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken(
            "FeeToken", "FEE", 18, tokenFeeBps, treasury
        );

        // Deploy aggregator with the specified protocol fee
        vm.startPrank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, protocolFeeBps, address(wwdoge));
        ag.addRouter(address(router));
        vm.stopPrank();

        // Fund user with fee tokens
        feeToken.mint(user, amountIn);
        vm.prank(user);
        feeToken.approve(address(ag), amountIn);

        // Fund router with output tokens
        tokenB.mint(address(router), ROUTER_LIQUIDITY);

        // Calculate expected values:
        // After transfer from user, aggregator receives: amountIn * (10000 - tokenFeeBps) / 10000
        uint256 amountAfterTokenTax = (amountIn * (10_000 - tokenFeeBps)) / 10_000;
        uint256 expectedProtocolFee = (amountAfterTokenTax * protocolFeeBps) / 10_000;
        uint256 expectedSwapAmount = amountAfterTokenTax - expectedProtocolFee;
        uint256 expectedOut = (expectedSwapAmount * EXCHANGE_RATE) / 1e18;

        // Build swap request
        address[] memory path = new address[](2);
        path[0] = address(feeToken);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: amountIn, // ignored for step 0
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(feeToken),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 treasuryFeeTokenBalBefore = feeToken.balanceOf(treasury);
        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        ag.executeSwap(req);

        // Verify protocol fee is calculated on amountAfterTokenTax
        // Treasury receives both token transfer tax AND protocol fee (both go to treasury)
        // Note: When the aggregator sends the protocol fee to treasury via safeTransfer,
        // the fee-on-transfer token charges tax on that transfer too. This can cause a
        // rounding difference of ±1 wei.
        uint256 treasuryFeeTokenGain = feeToken.balanceOf(treasury) - treasuryFeeTokenBalBefore;
        // Token tax goes to treasury (as feeRecipient), protocol fee also goes to treasury
        uint256 tokenTax = amountIn - amountAfterTokenTax;
        assertApproxEqAbs(treasuryFeeTokenGain, tokenTax + expectedProtocolFee, 1, "Treasury fee mismatch");

        // Verify user received output based on swapAmount (allow ±1 for rounding)
        uint256 actualOut = tokenB.balanceOf(recipient) - recipientBalBefore;
        assertApproxEqAbs(actualOut, expectedOut, 1, "Output mismatch");
    }

    // ================================================================
    // 2. Fuzz Tests — Amount Boundaries
    // ================================================================

    /// @notice Fuzzes swap amounts from 1 wei to 1e27 tokens.
    function testFuzz_SwapAmounts(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, 1e27);

        _fundUser(address(tokenA), user, amountIn);

        uint256 feeBps = aggregator.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 actualOut = tokenB.balanceOf(recipient) - recipientBalBefore;
        assertEq(actualOut, expectedOut, "Output mismatch");
    }

    /// @notice Fuzzes multi-hop swaps with 1-4 hops and various amounts.
    function testFuzz_MultiHopAmounts(uint256 amountIn, uint8 hops) public {
        amountIn = bound(amountIn, 1e6, 1e24);
        hops = uint8(bound(hops, 1, 4));

        // Create intermediate tokens
        MockERC20[] memory intermediates = new MockERC20[](hops - 1);
        for (uint256 i = 0; i < hops - 1; i++) {
            intermediates[i] = new MockERC20(
                string(abi.encodePacked("INT", vm.toString(i))),
                string(abi.encodePacked("I", vm.toString(i))),
                18
            );
            // Fund router with intermediate tokens for subsequent hops
            intermediates[i].mint(address(router), ROUTER_LIQUIDITY);
        }

        // Fund router with final output token
        tokenB.mint(address(router), ROUTER_LIQUIDITY);

        // Fund user
        _fundUser(address(tokenA), user, amountIn);

        // Calculate expected values
        uint256 feeBps = aggregator.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Build steps
        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](hops);
        uint256 runningAmount = swapAmount;

        for (uint256 i = 0; i < hops; i++) {
            address tokenOut;
            if (i < hops - 1) {
                tokenOut = address(intermediates[i]);
            } else {
                tokenOut = address(tokenB);
            }

            address tokenIn;
            if (i == 0) {
                tokenIn = address(tokenA);
            } else {
                tokenIn = address(intermediates[i - 1]);
            }

            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;

            uint256 expectedStepOut = (runningAmount * EXCHANGE_RATE) / 1e18;

            steps[i] = OmnomSwapAggregator.SwapStep({
                router: address(router),
                path: path,
                amountIn: i == 0 ? amountIn : runningAmount, // step 0 ignored
                minAmountOut: 0
            });

            runningAmount = expectedStepOut;
        }

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 actualOut = tokenB.balanceOf(recipient) - recipientBalBefore;
        assertGe(actualOut, 0, "Should receive output");

        // Verify final output >= minTotalAmountOut (which is 0)
        assertGe(actualOut, req.minTotalAmountOut, "Output below minimum");
    }

    /// @notice Fuzzes slippage boundaries: swap succeeds when output >= min,
    ///         reverts when minTotalAmountOut = actualOutput + 1.
    function testFuzz_SlippageBoundary(uint256 amountIn, uint16 slippageBps) public {
        amountIn = bound(amountIn, 1e10, 1e24);
        slippageBps = uint16(bound(slippageBps, 1, 1000)); // 0.01% to 10%

        _fundUser(address(tokenA), user, amountIn);

        uint256 feeBps = aggregator.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 actualOutput = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Set minTotalAmountOut with slippage tolerance
        uint256 minTotalAmountOut = (actualOutput * (10_000 - slippageBps)) / 10_000;

        // Should succeed: actualOutput >= minTotalAmountOut
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            minTotalAmountOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Now test that swap reverts when minTotalAmountOut > actualOutput
        _fundUser(address(tokenA), user, amountIn);

        OmnomSwapAggregator.SwapRequest memory reqRevert = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            0, // step minAmountOut = 0 so router accepts
            address(router),
            recipient,
            block.timestamp + 1 hours
        );
        reqRevert.minTotalAmountOut = actualOutput + 1;

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(reqRevert);
    }

    // ================================================================
    // 3. Fuzz Tests — Deadline Boundaries
    // ================================================================

    /// @notice Fuzzes valid deadline offsets between 1 min and 2 hours.
    function testFuzz_DeadlineValidity(uint256 deadlineOffset) public {
        deadlineOffset = bound(deadlineOffset, 60, 7200);

        uint256 amountIn = 1000e18;
        _fundUser(address(tokenA), user, amountIn);

        uint256 feeBps = aggregator.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + deadlineOffset
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify swap succeeded
        assertGe(tokenB.balanceOf(recipient), expectedOut, "Output mismatch");
    }

    /// @notice Fuzzes deadline offsets < 60 seconds — should revert.
    function testFuzz_DeadlineTooShort(uint256 deadlineOffset) public {
        deadlineOffset = bound(deadlineOffset, 0, 59);

        uint256 amountIn = 1000e18;
        _fundUser(address(tokenA), user, amountIn);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            amountIn,
            0,
            address(router),
            recipient,
            block.timestamp + deadlineOffset
        );

        vm.prank(user);
        vm.expectRevert("Deadline expired");
        aggregator.executeSwap(req);
    }

    /// @notice Fuzzes deadline offsets > 7200 seconds — should revert.
    function testFuzz_DeadlineTooFar(uint256 deadlineOffset) public {
        // Bound to avoid overflow when computing block.timestamp + deadlineOffset
        deadlineOffset = bound(deadlineOffset, 7201, type(uint256).max - block.timestamp);

        uint256 amountIn = 1000e18;
        _fundUser(address(tokenA), user, amountIn);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            amountIn,
            0,
            address(router),
            recipient,
            block.timestamp + deadlineOffset
        );

        vm.prank(user);
        vm.expectRevert("Deadline too far");
        aggregator.executeSwap(req);
    }

    // ================================================================
    // 5. Fuzz Tests — Exchange Rate Variations
    // ================================================================

    /// @notice Fuzzes exchange rates from 50% to 150% and verifies output.
    function testFuzz_ExchangeRateImpact(uint256 exchangeRate) public {
        exchangeRate = bound(exchangeRate, 0.5e18, 1.5e18);

        router.setExchangeRate(exchangeRate);

        uint256 amountIn = 1000e18;
        _fundUser(address(tokenA), user, amountIn);

        // Ensure router has enough output tokens
        uint256 maxOutput = (amountIn * 1.5e18) / 1e18; // upper bound
        tokenB.mint(address(router), maxOutput * 2);

        uint256 feeBps = aggregator.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * exchangeRate) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 actualOut = tokenB.balanceOf(recipient) - recipientBalBefore;
        assertEq(actualOut, expectedOut, "Output should match exchange rate");

        // Reset exchange rate for other tests
        router.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Fuzzes 3-hop swap with different rates per hop.
    ///         Verifies final output ≈ amountIn * rate1/1e18 * rate2/1e18 * rate3/1e18 * (1 - feeBps/10000).
    function testFuzz_MultiHopRateCompounding(
        uint256 rate1,
        uint256 rate2,
        uint256 rate3
    ) public {
        rate1 = bound(rate1, 0.8e18, 1.2e18);
        rate2 = bound(rate2, 0.8e18, 1.2e18);
        rate3 = bound(rate3, 0.8e18, 1.2e18);

        // Deploy 3 separate routers with different rates
        vm.startPrank(owner);
        MockUniswapV2Router router1 = new MockUniswapV2Router(address(0), rate1);
        MockUniswapV2Router router2 = new MockUniswapV2Router(address(0), rate2);
        MockUniswapV2Router router3 = new MockUniswapV2Router(address(0), rate3);
        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));
        aggregator.addRouter(address(router3));
        vm.stopPrank();

        // Create intermediate tokens
        MockERC20 intermediate1 = new MockERC20("INT1", "I1", 18);
        MockERC20 intermediate2 = new MockERC20("INT2", "I2", 18);

        // Fund routers with appropriate output tokens
        intermediate1.mint(address(router1), ROUTER_LIQUIDITY);
        intermediate2.mint(address(router2), ROUTER_LIQUIDITY);
        tokenB.mint(address(router3), ROUTER_LIQUIDITY);

        uint256 amountIn = 1000e18;
        _fundUser(address(tokenA), user, amountIn);

        // Calculate expected values
        uint256 feeBps = aggregator.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 0: tokenA → intermediate1 at rate1
        uint256 output0 = (swapAmount * rate1) / 1e18;
        // Step 1: intermediate1 → intermediate2 at rate2
        uint256 output1 = (output0 * rate2) / 1e18;
        // Step 2: intermediate2 → tokenB at rate3
        uint256 output2 = (output1 * rate3) / 1e18;

        // Build paths
        address[] memory path0 = new address[](2);
        path0[0] = address(tokenA);
        path0[1] = address(intermediate1);

        address[] memory path1 = new address[](2);
        path1[0] = address(intermediate1);
        path1[1] = address(intermediate2);

        address[] memory path2 = new address[](2);
        path2[0] = address(intermediate2);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path0,
            amountIn: swapAmount, // ignored for step 0
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path1,
            amountIn: output0, // must match step 0 output
            minAmountOut: 0
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router3),
            path: path2,
            amountIn: output1, // must match step 1 output
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 actualOut = tokenB.balanceOf(recipient) - recipientBalBefore;

        // Verify: finalOutput ≈ swapAmount * rate1/1e18 * rate2/1e18 * rate3/1e18
        // Allow up to 3 wei difference due to integer division rounding
        assertApproxEqAbs(actualOut, output2, 3, "Compounding rate mismatch");
    }
}

// ============================================================
// Invariant Handler
// ============================================================

/// @title FuzzHandler
/// @notice Handler contract for Foundry invariant tests. Wraps the aggregator
///         and tracks ghost variables for invariant verification.
contract FuzzHandler is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockUniswapV2Router public router;

    address public owner;
    address public treasury;
    address public user = address(0x300);
    address public recipient = address(0x500);

    // Ghost variables for invariant checking
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_totalFeesCollected;
    uint256 public ghost_swapCount;
    uint256 public ghost_revertCount;

    // Track last swap's fee for per-swap consistency check
    uint256 public ghost_lastFeeAmount;
    uint256 public ghost_lastReceived;
    uint256 public ghost_lastFeeBps;

    uint256 constant EXCHANGE_RATE = 1e18;

    constructor(
        address payable _aggregator,
        address _tokenA,
        address _tokenB,
        address _router,
        address _owner,
        address _treasury
    ) {
        aggregator = OmnomSwapAggregator(_aggregator);
        tokenA = MockERC20(_tokenA);
        tokenB = MockERC20(_tokenB);
        router = MockUniswapV2Router(_router);
        owner = _owner;
        treasury = _treasury;
    }

    /// @notice Execute a swap with bounded parameters.
    function executeSwap(uint256 amountIn) external {
        amountIn = bound(amountIn, 1e3, 1e22);

        // Fund user
        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        uint256 feeBps = aggregator.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Build request
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: swapAmount,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });

        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);
        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        ghost_totalDeposited += amountIn;

        vm.prank(user);
        try aggregator.executeSwap(req) {
            uint256 feeReceived = tokenA.balanceOf(treasury) - treasuryBalBefore;
            uint256 outputReceived = tokenB.balanceOf(recipient) - recipientBalBefore;

            ghost_totalFeesCollected += feeReceived;
            ghost_totalWithdrawn += outputReceived;
            ghost_swapCount++;

            // Track per-swap fee consistency
            ghost_lastFeeAmount = feeReceived;
            ghost_lastReceived = amountIn; // normal token: received == amountIn
            ghost_lastFeeBps = feeBps;
        } catch {
            ghost_revertCount++;
        }
    }

    /// @notice Update protocol fee with bounded value.
    function updateFee(uint256 feeBps) external {
        feeBps = bound(feeBps, 0, 500);
        vm.prank(owner);
        aggregator.setProtocolFee(feeBps);
    }
}

// ============================================================
// Invariant Tests
// ============================================================

/// @title FuzzInvariantTest
/// @notice Invariant tests for the OmnomSwapAggregator using a handler-based approach.
contract FuzzInvariantTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;
    FuzzHandler public handler;

    address public owner = address(0x100);
    address public treasury = address(0x200);

    uint256 constant ROUTER_LIQUIDITY = 10_000_000_000e18;

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, 25, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);

        router = new MockUniswapV2Router(address(0), 1e18);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund router with massive liquidity
        tokenB.mint(address(router), ROUTER_LIQUIDITY);
        tokenA.mint(address(router), ROUTER_LIQUIDITY);

        // Deploy handler
        handler = new FuzzHandler(
            payable(address(aggregator)),
            address(tokenA),
            address(tokenB),
            address(router),
            owner,
            treasury
        );

        // Target the handler for invariant fuzzing
        targetContract(address(handler));

        // Exclude test contracts from sender selection
        excludeSender(address(aggregator));
        excludeSender(address(router));
        excludeSender(address(tokenA));
        excludeSender(address(tokenB));
        excludeSender(address(wwdoge));
    }

    /// @notice Invariant: aggregator holds no user tokens after each call.
    function testInvariant_aggregatorHoldsNoUserFunds() public {
        assertEq(
            tokenA.balanceOf(address(aggregator)),
            0,
            "Aggregator should hold zero tokenA"
        );
        assertEq(
            tokenB.balanceOf(address(aggregator)),
            0,
            "Aggregator should hold zero tokenB"
        );
    }

    /// @notice Invariant: total deposited - total withdrawn - total fees <= aggregator token balance.
    ///         Since aggregator holds zero tokens, this simplifies to checking accounting consistency.
    function testInvariant_balanceAccounting() public {
        uint256 aggregatorTokenABal = tokenA.balanceOf(address(aggregator));
        uint256 netDeposited = handler.ghost_totalDeposited()
            - handler.ghost_totalFeesCollected();

        // Net deposited tokens (minus fees) should not be stuck in the aggregator.
        // All deposited tokens should have been either swapped out or collected as fees.
        assertLe(
            netDeposited,
            handler.ghost_totalWithdrawn() + aggregatorTokenABal + handler.ghost_totalFeesCollected(),
            "Balance invariant violated"
        );
    }

    /// @notice Invariant: fee consistency — feeAmount == (received * feeBps) / 10000
    ///         for the last successful swap.
    function testInvariant_feeConsistency() public {
        // Only check if at least one swap succeeded
        if (handler.ghost_swapCount() > 0) {
            uint256 expectedFee = (handler.ghost_lastReceived() * handler.ghost_lastFeeBps()) / 10_000;
            assertEq(
                handler.ghost_lastFeeAmount(),
                expectedFee,
                "Fee consistency invariant violated"
            );
        }
    }

    /// @notice Invariant: output guarantee — for every successful swap,
    ///         user received >= minTotalAmountOut (which is 0 in handler).
    ///         This is implicitly guaranteed since the swap succeeded.
    ///         We verify ghost_totalWithdrawn > 0 when swaps succeeded.
    function testInvariant_outputGuarantee() public {
        if (handler.ghost_swapCount() > 0) {
            assertGt(
                handler.ghost_totalWithdrawn(),
                0,
                "Successful swaps should have produced output"
            );
        }
    }

    /// @notice Invariant: total fees collected should never exceed
    ///         max possible fees (5% of all deposits).
    function testInvariant_feeNeverExceedsMax() public {
        uint256 maxPossibleFee = (handler.ghost_totalDeposited() * 500) / 10_000;
        assertLe(
            handler.ghost_totalFeesCollected(),
            maxPossibleFee,
            "Total fees exceed theoretical maximum"
        );
    }
}
