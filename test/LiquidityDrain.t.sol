// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockFailingRouter.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title LiquidityDrainTest
/// @notice Tests simulating sudden liquidity drain scenarios including pool drainage
///         between submission and execution, empty pools, sandwich attack aftermath,
///         and multi-user liquidity crises.
contract LiquidityDrainTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockERC20 public tokenD;
    MockUniswapV2Router public router1;
    MockUniswapV2Router public router2;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public user2 = address(0x400);
    address public recipient = address(0x500);
    address public attacker = address(0x600);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 100_000_000e18;
    uint256 constant FEE_BPS = 25; // 0.25%

    // ============================================================
    // Helpers
    // ============================================================

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _fundRouter(MockUniswapV2Router _router, address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(_router), amount);
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
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
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

    // ============================================================
    // setUp
    // ============================================================

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);
        tokenC = new MockERC20("Token C", "TKC", 18);
        tokenD = new MockERC20("Token D", "TKD", 18);

        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));

        vm.stopPrank();

        // Fund users
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenC), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenD), user, INITIAL_BALANCE);

        _fundAndApprove(address(tokenA), user2, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user2, INITIAL_BALANCE);

        _fundAndApprove(address(tokenA), attacker, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), attacker, INITIAL_BALANCE);

        // Fund routers with output tokens
        _fundRouter(router1, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenD), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenD), INITIAL_BALANCE * 10);
    }

    // ============================================================
    // A. Pool Drainage Between Submission and Execution
    // ============================================================

    /// @notice Drain router liquidity before swap executes — router can't transfer out.
    function test_drainBeforeSwap_insufficientLiquidity() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Drain router's tokenB balance to 0
        uint256 routerBalance = tokenB.balanceOf(address(router1));
        MockERC20(address(tokenB)).mint(address(0xdead), routerBalance); // dilute
        // Actually drain by transferring all out
        vm.prank(address(router1));
        // We can't directly drain from router, so instead set exchange rate to 0
        // which simulates 0 liquidity (0 output)
        router1.setExchangeRate(0);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // With 0 exchange rate, the router will try to transfer 0 tokens
        // but minAmountOut check in router will fail
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Partial drain reduces output, slippage protection catches it.
    function test_partialDrain_slippageProtection() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Simulate partial drain by reducing exchange rate to 1.5x (25% reduction)
        router1.setExchangeRate(1.5e18);

        uint256 reducedOut = (swapAmount * 1.5e18) / 1e18;

        // User expects full output — slippage should catch the reduction
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);

        // But with appropriate slippage tolerance, swap succeeds
        _fundAndApprove(address(tokenA), user, amountIn);

        OmnomSwapAggregator.SwapRequest memory req2 = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, reducedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req2);

        assertEq(tokenB.balanceOf(recipient), reducedOut, "reduced output should match");
    }

    /// @notice Drain intermediate liquidity after first hop completes in multi-hop.
    function test_drainAfterFirstHop_multiHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1 at 2x rate
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Step 2 will have drained liquidity — set very low rate
        uint256 drainedRate = 0.01e18; // nearly empty pool
        router2.setExchangeRate(drainedRate);
        uint256 step2Out = (step1Out * drainedRate) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA); path1[1] = address(tokenB);
        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB); path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1), path: path1, amountIn: swapAmount, minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2), path: path2, amountIn: step1Out, minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenC), amountIn: amountIn,
            minTotalAmountOut: step2Out, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // Output reflects drained second hop
        assertEq(tokenC.balanceOf(recipient), step2Out, "drained second hop output mismatch");
        assertLt(tokenC.balanceOf(recipient), step1Out, "output should be much less than step1");
    }

    /// @notice Gradually decrease exchange rate, verify slippage catches it.
    function test_slowDrain_exchangeRateDecrease() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Set minTotalAmountOut to 95% of original (5% slippage tolerance)
        uint256 minOut = (originalOut * 95) / 100;

        // Gradually decrease rate: 2x → 1.9x → 1.8x → ...
        // At 1.9x: output = swapAmount * 1.9 / 1 = 1895.25, minOut = 1895.25
        // They're equal because 1.9/2.0 = 0.95 exactly. Use assertGe.
        uint256 rate1 = 1.9e18;
        uint256 out1 = (swapAmount * rate1) / 1e18;
        assertGe(out1, minOut, "1.9x should be at or above slippage");

        // Test at 1.9x — should succeed
        router1.setExchangeRate(rate1);

        OmnomSwapAggregator.SwapRequest memory req1 = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req1);
        assertEq(tokenB.balanceOf(recipient), out1, "1.9x output mismatch");

        // Re-fund and test at 1.8x — should fail (10% drop > 5% tolerance)
        // 1.8/2.0 = 0.9, which is a 10% decrease, exceeding the 5% slippage tolerance
        _fundAndApprove(address(tokenA), user, amountIn);
        router1.setExchangeRate(1.8e18);
        uint256 out2 = (swapAmount * 1.8e18) / 1e18;
        assertLt(out2, minOut, "1.8x should be below slippage threshold");

        OmnomSwapAggregator.SwapRequest memory req2 = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req2);
    }

    // ============================================================
    // B. Empty Pool Scenarios
    // ============================================================

    /// @notice Router has 0 output token balance — exchange rate is 0.
    function test_emptyPool_swapReverts() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Set exchange rate to 0 — simulates empty pool
        router1.setExchangeRate(0);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, 1,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Router has minimal liquidity — exchange rate produces tiny output.
    /// @dev With swapAmount = 997.5e18, rate = 1e18/swapAmount rounds to 0 in integer math.
    ///      We use rate = 1 instead, producing ~997 wei output (still very small).
    function test_nearEmptyPool_1weiLiquidity() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Set exchange rate to 1 (minimum non-zero rate)
        // output = swapAmount * 1 / 1e18 = 997 wei (very small output)
        uint256 tinyRate = 1;
        router1.setExchangeRate(tinyRate);

        uint256 expectedOut = (swapAmount * tinyRate) / 1e18;
        assertGt(expectedOut, 0, "should produce non-zero output");

        // Fund router with enough tokenB for the expected output
        _fundRouter(router1, address(tokenB), expectedOut);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "should receive expected tiny output");
    }

    /// @notice First hop pool is empty in a multi-hop route.
    function test_emptyPool_multiHop_firstHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // First hop: empty pool (rate = 0)
        router1.setExchangeRate(0);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA); path1[1] = address(tokenB);
        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB); path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1), path: path1, amountIn: swapAmount, minAmountOut: 1
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2), path: path2, amountIn: 1, minAmountOut: 1
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenC), amountIn: amountIn,
            minTotalAmountOut: 1, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Second hop pool is empty (first succeeds, second fails).
    function test_emptyPool_multiHop_secondHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // First hop: normal rate
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Second hop: empty pool (rate = 0)
        router2.setExchangeRate(0);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA); path1[1] = address(tokenB);
        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB); path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1), path: path1, amountIn: swapAmount, minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2), path: path2, amountIn: step1Out, minAmountOut: 1
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenC), amountIn: amountIn,
            minTotalAmountOut: 1, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        // First hop succeeds but second hop fails due to empty pool
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    // ============================================================
    // C. Sandwich Attack Aftermath
    // ============================================================

    /// @notice Exchange rate changed unfavorably (simulating sandwich), swap reverts.
    function test_sandwich_priceAlreadyMoved_revert() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User expects original output
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, originalOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Sandwich: price moved unfavorably (rate dropped to 1.5x)
        router1.setExchangeRate(1.5e18);

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Price moved but within slippage tolerance — swap succeeds.
    function test_sandwich_priceMoved_withinSlippage() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets 5% slippage tolerance
        uint256 minOut = (originalOut * 95) / 100;

        // Sandwich: price moves 3% (rate drops to 1.94x ≈ 3% drop from 2x)
        uint256 sandwichRate = 1.94e18;
        router1.setExchangeRate(sandwichRate);

        uint256 sandwichOut = (swapAmount * sandwichRate) / 1e18;
        assertGt(sandwichOut, minOut, "3% move should be within 5% tolerance");

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), sandwichOut, "output should match sandwich price");
    }

    /// @notice Using high slippage tolerance after sandwich — swap goes through.
    function test_sandwich_recovery_highSlippage() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Sandwich: significant price impact (rate drops to 1.5x = 25% drop)
        router1.setExchangeRate(1.5e18);
        uint256 sandwichOut = (swapAmount * 1.5e18) / 1e18;

        // User sets 50% slippage tolerance — very loose
        uint256 minOut = (sandwichOut * 50) / 100;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Swap succeeds but user gets sandwiched price
        assertEq(tokenB.balanceOf(recipient), sandwichOut, "output at sandwich price");
        assertLt(tokenB.balanceOf(recipient), (swapAmount * EXCHANGE_RATE) / 1e18, "user loses value");
    }

    /// @notice Verify slippage protection acts as sandwich detection.
    function test_sandwich_frontRun_detection() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets tight 1% slippage
        uint256 minOut = (originalOut * 99) / 100;

        // Front-run: attacker moves price by 2%
        router1.setExchangeRate(1.96e18);

        uint256 frontRunOut = (swapAmount * 1.96e18) / 1e18;
        assertLt(frontRunOut, minOut, "front-run output should be below 1% tolerance");

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Swap reverts — slippage protection detected the sandwich
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    // ============================================================
    // D. Liquidity Crisis Multi-User
    // ============================================================

    /// @notice Two users compete for same liquidity, first gets it.
    function test_competingSwaps_firstWins() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address recipient1 = address(0xAAA);
        address recipient2 = address(0xBBB);

        // User 1 swaps first
        OmnomSwapAggregator.SwapRequest memory req1 = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient1, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req1);

        // After user 1's swap, reduce exchange rate (simulating liquidity consumption)
        router1.setExchangeRate(0.5e18);

        // User 2 expects same output but pool is now depleted
        OmnomSwapAggregator.SwapRequest memory req2 = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient2, block.timestamp + 1 hours
        );

        vm.prank(user2);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req2);

        // User 1 got the tokens
        assertEq(tokenB.balanceOf(recipient1), expectedOut, "first user should get full output");
        assertEq(tokenB.balanceOf(recipient2), 0, "second user should get nothing");
    }

    /// @notice First user takes most liquidity, second gets reduced output.
    function test_competingSwaps_partialFill() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        address recipient1 = address(0xAAA);
        address recipient2 = address(0xBBB);

        // User 1 swaps at full rate
        uint256 fullOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req1 = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, fullOut,
            address(router1), recipient1, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req1);

        // After user 1, rate drops to 1.5x (partial liquidity remaining)
        router1.setExchangeRate(1.5e18);
        uint256 reducedOut = (swapAmount * 1.5e18) / 1e18;

        // User 2 sets appropriate slippage for reduced liquidity
        OmnomSwapAggregator.SwapRequest memory req2 = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, reducedOut,
            address(router1), recipient2, block.timestamp + 1 hours
        );

        vm.prank(user2);
        aggregator.executeSwap(req2);

        // User 1 got full output, user 2 got reduced
        assertEq(tokenB.balanceOf(recipient1), fullOut, "first user full output");
        assertEq(tokenB.balanceOf(recipient2), reducedOut, "second user reduced output");
        assertGt(tokenB.balanceOf(recipient1), tokenB.balanceOf(recipient2), "user1 > user2");
    }

    /// @notice Drain causes multi-hop failure cascade.
    function test_cascadingFailure_drainageChain() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // 3-hop route: A → B → C → D
        uint256 s1 = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Drain the middle hop (B → C) by setting rate to 0
        router2.setExchangeRate(0);

        address[] memory p1 = new address[](2);
        p1[0] = address(tokenA); p1[1] = address(tokenB);
        address[] memory p2 = new address[](2);
        p2[0] = address(tokenB); p2[1] = address(tokenC);
        address[] memory p3 = new address[](2);
        p3[0] = address(tokenC); p3[1] = address(tokenD);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p1, amountIn: swapAmount, minAmountOut: s1});
        steps[1] = OmnomSwapAggregator.SwapStep({router: address(router2), path: p2, amountIn: s1, minAmountOut: 1});
        steps[2] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p3, amountIn: 1, minAmountOut: 1});

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenD), amountIn: amountIn,
            minTotalAmountOut: 1, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        // First hop succeeds, second hop fails (drained), entire tx reverts
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }
}
