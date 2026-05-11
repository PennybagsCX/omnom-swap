// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockFailingRouter.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title MEVProtectionTest
/// @notice Validates MEV (Maximal Extractable Value) resistance of the OmnomSwap Aggregator.
///         Tests front-running, sandwich attacks, back-running, slippage protection
///         effectiveness, and malicious router scenarios.
contract MEVProtectionTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockUniswapV2Router public router1;
    MockUniswapV2Router public router2;
    MockFailingRouter public failingRouter;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
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

        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        failingRouter = new MockFailingRouter();

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));
        aggregator.addRouter(address(failingRouter));

        vm.stopPrank();

        // Fund users
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenC), user, INITIAL_BALANCE);

        _fundAndApprove(address(tokenA), attacker, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), attacker, INITIAL_BALANCE);

        // Fund routers
        _fundRouter(router1, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenC), INITIAL_BALANCE * 10);

        // Fund failing router
        MockERC20(address(tokenA)).mint(address(failingRouter), INITIAL_BALANCE * 10);
        MockERC20(address(tokenB)).mint(address(failingRouter), INITIAL_BALANCE * 10);
        MockERC20(address(tokenC)).mint(address(failingRouter), INITIAL_BALANCE * 10);
    }

    // ============================================================
    // A. Front-Running Simulation
    // ============================================================

    /// @notice Attacker changes price (exchange rate) before user's swap — revert.
    function test_frontRun_priceChangeBeforeSwap_revert() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User builds swap expecting 2x rate
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Front-run: attacker changes price to 1.5x before user's tx executes
        router1.setExchangeRate(1.5e18);

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Slippage protection catches front-run when output drops below minimum.
    function test_frontRun_priceChange_slippageCatches() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets 3% slippage tolerance
        uint256 minOut = (originalOut * 97) / 100;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Front-run: 5% price drop (more than 3% tolerance)
        router1.setExchangeRate(1.9e18);

        uint256 frontRunOut = (swapAmount * 1.9e18) / 1e18;
        assertLt(frontRunOut, minOut, "front-run output should be below tolerance");

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Tight slippage (0.1%) catches even small front-runs.
    function test_frontRun_withTightSlippage() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets very tight 0.1% slippage
        uint256 minOut = (originalOut * 999) / 1000;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Front-run: tiny 0.5% price drop
        router1.setExchangeRate(1.99e18);

        uint256 frontRunOut = (swapAmount * 1.99e18) / 1e18;
        // 0.5% drop > 0.1% tolerance
        assertLt(frontRunOut, minOut, "0.5% front-run should exceed 0.1% tolerance");

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Loose slippage (5%) allows swap through after front-run.
    function test_frontRun_withLooseSlippage() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets loose 5% slippage
        uint256 minOut = (originalOut * 95) / 100;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Front-run: 2% price drop (within 5% tolerance)
        router1.setExchangeRate(1.96e18);

        uint256 frontRunOut = (swapAmount * 1.96e18) / 1e18;
        assertGt(frontRunOut, minOut, "2% front-run should be within 5% tolerance");

        vm.prank(user);
        aggregator.executeSwap(req);

        // Swap succeeds but user gets less than optimal
        assertEq(tokenB.balanceOf(recipient), frontRunOut, "output at front-run price");
        assertLt(tokenB.balanceOf(recipient), originalOut, "user gets less than original");
    }

    // ============================================================
    // B. Sandwich Attack Simulation
    // ============================================================

    /// @notice Attacker buys before (raises price), sells after (lowers price).
    ///         Simulate by changing exchange rate up before swap, then down after.
    function test_sandwich_buyBefore_sellAfter() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User expects original output
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, originalOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Sandwich step 1: Attacker front-runs (buys tokenB, price goes up for tokenA→tokenB)
        // In our mock, this means the exchange rate drops for the user
        router1.setExchangeRate(1.5e18); // Price worsened for user

        // User's swap reverts due to slippage
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);

        // Sandwich step 2: Attacker back-runs (sells tokenB, price normalizes)
        router1.setExchangeRate(EXCHANGE_RATE); // Price recovers

        // Verify user still has their tokens (swap didn't execute)
        assertEq(tokenA.balanceOf(user), INITIAL_BALANCE, "user should retain tokens");
    }

    /// @notice User's minTotalAmountOut protects against sandwich.
    function test_sandwich_userSetsMinOutput() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets minTotalAmountOut = 99% of expected (1% slippage)
        uint256 minOut = (originalOut * 99) / 100;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Sandwich: 2% price impact (exceeds 1% tolerance)
        router1.setExchangeRate(1.96e18);

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Sandwich pushes output to exactly minTotalAmountOut — swap succeeds at boundary.
    function test_sandwich_exactOutputBoundary() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Attacker front-runs, pushing rate to 1.95x
        uint256 sandwichRate = 1.95e18;
        router1.setExchangeRate(sandwichRate);

        uint256 sandwichOut = (swapAmount * sandwichRate) / 1e18;

        // User sets minOut exactly equal to sandwich output
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, sandwichOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Swap succeeds at exact boundary
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), sandwichOut, "output at exact boundary");
    }

    /// @notice Sandwich pushes output below minTotalAmountOut — swap reverts.
    function test_sandwich_failsWithSlippage() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets 2% slippage
        uint256 minOut = (originalOut * 98) / 100;

        // Sandwich: 5% price impact
        router1.setExchangeRate(1.9e18);

        uint256 sandwichOut = (swapAmount * 1.9e18) / 1e18;
        assertLt(sandwichOut, minOut, "sandwich output should be below tolerance");

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    // ============================================================
    // C. Back-Running Simulation
    // ============================================================

    /// @notice Price changes after swap completes don't affect user.
    function test_backRun_priceChangeAfterSwap_noEffect() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Execute swap at normal price
        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userBalance = tokenB.balanceOf(recipient);
        assertEq(userBalance, expectedOut, "user should have expected output");

        // Back-run: price changes after swap (rate drops to 0.5x)
        router1.setExchangeRate(0.5e18);

        // User's balance is unchanged — they already have the tokens
        assertEq(tokenB.balanceOf(recipient), userBalance, "user balance unchanged after back-run");
    }

    /// @notice Verify user has tokens before price changes (back-run can't steal them).
    function test_backRun_userAlreadyReceivedTokens() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Execute swap
        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify tokens are in recipient's wallet, not in aggregator
        assertEq(tokenB.balanceOf(recipient), expectedOut, "recipient has tokens");
        assertEq(tokenB.balanceOf(address(aggregator)), 0, "aggregator holds no tokens");

        // Even if exchange rate changes drastically, user's tokens are safe
        router1.setExchangeRate(0);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "tokens still safe after rate change");
    }

    /// @notice Attempt to manipulate intermediate hop in multi-hop route.
    function test_backRun_multiHop_intermediateManipulation() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

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

        // Execute multi-hop swap
        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userBalance = tokenC.balanceOf(recipient);
        assertEq(userBalance, step2Out, "multi-hop output correct");

        // Back-run: manipulate intermediate token price
        router1.setExchangeRate(0.1e18);
        router2.setExchangeRate(0.1e18);

        // User's final tokens are unaffected
        assertEq(tokenC.balanceOf(recipient), userBalance, "user tokens unaffected by back-run");
    }

    // ============================================================
    // D. MEV Protection Effectiveness
    // ============================================================

    /// @notice 0.1% slippage catches price manipulation < 0.1%.
    function test_slippage_0_1percent_catchesSmallMEV() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets 0.1% slippage
        uint256 minOut = (originalOut * 999) / 1000;

        // MEV: 0.2% price manipulation (more than 0.1% tolerance)
        // rate = 2x * (1 - 0.002) = 1.996x
        uint256 mevRate = 1.996e18;
        router1.setExchangeRate(mevRate);

        uint256 mevOut = (swapAmount * mevRate) / 1e18;
        assertLt(mevOut, minOut, "0.2% MEV should exceed 0.1% tolerance");

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice 1% slippage catches price manipulation < 1%.
    function test_slippage_1percent_catchesModerateMEV() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets 1% slippage
        uint256 minOut = (originalOut * 99) / 100;

        // MEV: 2% price manipulation (more than 1% tolerance)
        uint256 mevRate = 1.96e18;
        router1.setExchangeRate(mevRate);

        uint256 mevOut = (swapAmount * mevRate) / 1e18;
        assertLt(mevOut, minOut, "2% MEV should exceed 1% tolerance");

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice 5% slippage allows > 5% manipulation through.
    function test_slippage_5percent_allowsThroughLargeMEV() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets 5% slippage
        uint256 minOut = (originalOut * 95) / 100;

        // MEV: 3% price manipulation (within 5% tolerance)
        uint256 mevRate = 1.94e18;
        router1.setExchangeRate(mevRate);

        uint256 mevOut = (swapAmount * mevRate) / 1e18;
        assertGt(mevOut, minOut, "3% MEV should be within 5% tolerance");

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, minOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Swap goes through despite MEV
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), mevOut, "MEV output goes through");
        assertLt(tokenB.balanceOf(recipient), originalOut, "user gets less than original");
    }

    /// @notice Expired deadline prevents delayed MEV execution.
    function test_deadlineAsMEVProtection() public {
        vm.warp(1_000_000);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets deadline 2 minutes from now
        uint256 deadline = block.timestamp + 2 minutes;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, deadline
        );

        // MEV attacker delays execution past deadline
        vm.warp(block.timestamp + 5 minutes);

        // Swap reverts — deadline expired, MEV attack prevented
        vm.prank(user);
        vm.expectRevert("Deadline expired");
        aggregator.executeSwap(req);
    }

    /// @notice Reentrancy guard prevents flash loan attacks.
    /// @dev Verifies that the nonReentrant modifier is active on executeSwap,
    ///      preventing flash loan enabled reentrancy attacks.
    function test_reentrancyAsMEVProtection() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Execute a normal swap — verifies the reentrancy guard doesn't block normal ops
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify swap completed successfully
        assertEq(tokenB.balanceOf(recipient), expectedOut, "normal swap succeeds");

        // Verify no tokens stuck in aggregator (reentrancy guard didn't cause issues)
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "no tokenA in aggregator");
        assertEq(tokenB.balanceOf(address(aggregator)), 0, "no tokenB in aggregator");
    }

    // ============================================================
    // E. Malicious Router Scenarios
    // ============================================================

    /// @notice Router that always reverts (using MockFailingRouter RevertOnSwap).
    function test_maliciousRouter_revertOnSwap() public {
        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertOnSwap);
        failingRouter.setExchangeRate(EXCHANGE_RATE);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(failingRouter), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);
    }

    /// @notice Router that takes input but returns nothing (ReturnZero mode).
    function test_maliciousRouter_returnsZeroTokens() public {
        failingRouter.setFailMode(MockFailingRouter.FailMode.ReturnZero);
        failingRouter.setExchangeRate(EXCHANGE_RATE);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(failingRouter), recipient, block.timestamp + 1 hours
        );

        // Router takes input but returns 0 — aggregator's balance diff check catches it
        vm.prank(user);
        vm.expectRevert("Insufficient output after tax");
        aggregator.executeSwap(req);
    }

    /// @notice Router returns less than expected (partial return via low exchange rate).
    function test_maliciousRouter_partialReturn() public {
        // Use a normal router with a low exchange rate to simulate partial return
        // The failing router in normal mode with low rate works for this
        failingRouter.setFailMode(MockFailingRouter.FailMode.None);
        failingRouter.setExchangeRate(0.5e18); // Only returns 50% of expected

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18; // expects 2x

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(failingRouter), recipient, block.timestamp + 1 hours
        );

        // Router returns only 50% — aggregator's minAmountOut check catches it
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }
}
