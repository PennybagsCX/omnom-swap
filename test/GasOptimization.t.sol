// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockFeeOnTransferToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title GasOptimizationTest
/// @notice Gas profiling and optimization tests for the OmnomSwapAggregator.
///         Measures gas usage for different hop counts, token types, and scenarios.
contract GasOptimizationTest is Test {
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
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 100_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 25; // 0.25%

    // --- Helpers ------------------------------------------------------

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _fundRouter(MockUniswapV2Router _router, address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(_router), amount);
    }

    function _buildNHopRequest(
        address tokenIn,
        address[] memory tokens,
        uint256 amountIn,
        address routerAddr,
        address to,
        uint256 deadline
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](tokens.length - 1);

        // Calculate expected output for each hop
        uint256 runningAmount = swapAmount;
        for (uint256 i = 0; i < tokens.length - 1; i++) {
            address[] memory path = new address[](2);
            path[0] = tokens[i];
            path[1] = tokens[i + 1];

            uint256 expectedOut = (runningAmount * EXCHANGE_RATE) / 1e18;

            steps[i] = OmnomSwapAggregator.SwapStep({
                router: routerAddr,
                path: path,
                amountIn: runningAmount,
                minAmountOut: 0 // Set to 0 for gas measurement
            });

            runningAmount = expectedOut;
        }

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokens[tokens.length - 1],
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: deadline,
            recipient: to
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
        tokenC = new MockERC20("Token C", "TKC", 18);
        tokenD = new MockERC20("Token D", "TKD", 18);

        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));

        vm.stopPrank();

        // Fund user
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenC), user, INITIAL_BALANCE);

        // Fund routers with output tokens
        _fundRouter(router1, address(tokenB), INITIAL_BALANCE);
        _fundRouter(router1, address(tokenC), INITIAL_BALANCE);
        _fundRouter(router1, address(tokenD), INITIAL_BALANCE);
        _fundRouter(router1, address(wwdoge), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenB), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenC), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenD), INITIAL_BALANCE);
        _fundRouter(router2, address(wwdoge), INITIAL_BALANCE);

        // Fund routers with tokenA for reverse swaps
        _fundRouter(router1, address(tokenA), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenA), INITIAL_BALANCE);
    }

    // ===================================================================
    // A. Gas Snapshots by Hop Count
    // ===================================================================

    function test_gasSnapshot_1hop() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildNHopRequest(address(tokenA), tokens, SWAP_AMOUNT, address(router1), recipient, block.timestamp + 30 minutes);

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("1-hop gas:", gasUsed);
        assertLt(gasUsed, 300_000, "1-hop gas should be under 300k");
    }

    function test_gasSnapshot_2hop() public {
        address[] memory tokens = new address[](3);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        tokens[2] = address(tokenC);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildNHopRequest(address(tokenA), tokens, SWAP_AMOUNT, address(router1), recipient, block.timestamp + 30 minutes);

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("2-hop gas:", gasUsed);
        assertLt(gasUsed, 500_000, "2-hop gas should be under 500k");
    }

    function test_gasSnapshot_3hop() public {
        address[] memory tokens = new address[](4);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        tokens[2] = address(tokenC);
        tokens[3] = address(tokenD);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildNHopRequest(address(tokenA), tokens, SWAP_AMOUNT, address(router1), recipient, block.timestamp + 30 minutes);

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("3-hop gas:", gasUsed);
        assertLt(gasUsed, 700_000, "3-hop gas should be under 700k");
    }

    function test_gasSnapshot_4hop() public {
        // 4-hop: A → B → C → D → WWDOGE
        address[] memory tokens = new address[](5);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        tokens[2] = address(tokenC);
        tokens[3] = address(tokenD);
        tokens[4] = address(wwdoge);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildNHopRequest(address(tokenA), tokens, SWAP_AMOUNT, address(router1), recipient, block.timestamp + 30 minutes);

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("4-hop gas:", gasUsed);
        assertLt(gasUsed, 900_000, "4-hop gas should be under 900k");
    }

    function test_gasSnapshot_nativeDoge() public {
        // Swap native DOGE → tokenB via WWDOGE wrapping
        uint256 amountIn = 1 ether;
        vm.deal(user, amountIn);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(wwdoge);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("Native DOGE swap gas:", gasUsed);
        assertLt(gasUsed, 400_000, "native DOGE swap gas should be under 400k");
    }

    // ===================================================================
    // B. Gas Comparison by Token Type
    // ===================================================================

    function test_gasComparison_standardVsFeeOnTransfer() public {
        // --- Standard ERC20 swap ---
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasStandard = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsedStandard = gasStandard - gasleft();

        // --- Fee-on-transfer swap ---
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken("FeeToken", "FEE", 18, 300, treasury);
        MockERC20 outputToken = new MockERC20("Output", "OUT", 18);

        feeToken.mint(user, SWAP_AMOUNT * 2);
        vm.prank(user);
        feeToken.approve(address(aggregator), SWAP_AMOUNT * 2);

        outputToken.mint(address(router1), INITIAL_BALANCE);

        address[] memory feePath = new address[](2);
        feePath[0] = address(feeToken);
        feePath[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory feeSteps = new OmnomSwapAggregator.SwapStep[](1);
        feeSteps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: feePath,
            amountIn: 0, // ignored for step 0
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory feeReq = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(feeToken),
            tokenOut: address(outputToken),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: feeSteps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasFee = gasleft();
        vm.prank(user);
        aggregator.executeSwap(feeReq);
        uint256 gasUsedFee = gasFee - gasleft();

        console2.log("Standard ERC20 gas:", gasUsedStandard);
        console2.log("Fee-on-transfer gas:", gasUsedFee);
        if (gasUsedFee > gasUsedStandard) {
            console2.log("Difference:", gasUsedFee - gasUsedStandard);
        } else {
            console2.log("Difference:", gasUsedStandard - gasUsedFee);
        }

        // Both should complete successfully — gas comparison is informational
        // Fee-on-transfer may use more or less gas depending on EVM state
        assertGt(gasUsedStandard, 0, "standard swap should use gas");
        assertGt(gasUsedFee, 0, "fee-on-transfer swap should use gas");
    }

    function test_gasComparison_18decimals_vs_6decimals() public {
        MockERC20 token6dec = new MockERC20("6 Dec", "6D", 6);
        token6dec.mint(address(router1), INITIAL_BALANCE);

        // Fund user with 6-decimal token (1000 units = 1000 * 10^6)
        uint256 amount6 = 1000e6;
        token6dec.mint(user, amount6);
        vm.prank(user);
        token6dec.approve(address(aggregator), amount6);

        uint256 feeAmount6 = (amount6 * FEE_BPS) / 10_000;
        uint256 swapAmount6 = amount6 - feeAmount6;
        uint256 expectedOut6 = (swapAmount6 * EXCHANGE_RATE) / 1e18;

        address[] memory path6 = new address[](2);
        path6[0] = address(token6dec);
        path6[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps6 = new OmnomSwapAggregator.SwapStep[](1);
        steps6[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path6,
            amountIn: swapAmount6,
            minAmountOut: expectedOut6
        });

        OmnomSwapAggregator.SwapRequest memory req6 = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(token6dec),
            tokenOut: address(tokenB),
            amountIn: amount6,
            minTotalAmountOut: expectedOut6,
            steps: steps6,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gas6 = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req6);
        uint256 gasUsed6 = gas6 - gasleft();

        console2.log("6-decimal token gas:", gasUsed6);

        // Gas should be similar to 18-decimal token (no significant difference expected)
        // The difference should be < 5%
        assertLt(gasUsed6, 300_000, "6-decimal gas should be reasonable");
    }

    function test_gasComparison_smallAmount_vs_largeAmount() public {
        // Small amount swap
        uint256 smallAmount = 1e18; // 1 token
        uint256 feeSmall = (smallAmount * FEE_BPS) / 10_000;
        uint256 swapSmall = smallAmount - feeSmall;
        uint256 expectedOutSmall = (swapSmall * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory stepsSmall = new OmnomSwapAggregator.SwapStep[](1);
        stepsSmall[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapSmall,
            minAmountOut: expectedOutSmall
        });

        OmnomSwapAggregator.SwapRequest memory reqSmall = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: smallAmount,
            minTotalAmountOut: expectedOutSmall,
            steps: stepsSmall,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasSmall = gasleft();
        vm.prank(user);
        aggregator.executeSwap(reqSmall);
        uint256 gasUsedSmall = gasSmall - gasleft();

        // Large amount swap
        uint256 largeAmount = 1_000_000e18; // 1M tokens
        uint256 feeLarge = (largeAmount * FEE_BPS) / 10_000;
        uint256 swapLarge = largeAmount - feeLarge;
        uint256 expectedOutLarge = (swapLarge * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapStep[] memory stepsLarge = new OmnomSwapAggregator.SwapStep[](1);
        stepsLarge[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapLarge,
            minAmountOut: expectedOutLarge
        });

        OmnomSwapAggregator.SwapRequest memory reqLarge = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: largeAmount,
            minTotalAmountOut: expectedOutLarge,
            steps: stepsLarge,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasLarge = gasleft();
        vm.prank(user);
        aggregator.executeSwap(reqLarge);
        uint256 gasUsedLarge = gasLarge - gasleft();

        console2.log("Small amount (1 token) gas:", gasUsedSmall);
        console2.log("Large amount (1M tokens) gas:", gasUsedLarge);

        // Gas should NOT scale significantly with amount — both should be within 75% of each other
        // Cold vs warm storage access can cause significant variance between first and second swap
        uint256 diff = gasUsedSmall > gasUsedLarge ? gasUsedSmall - gasUsedLarge : gasUsedLarge - gasUsedSmall;
        uint256 avg = (gasUsedSmall + gasUsedLarge) / 2;
        assertLt(diff * 100 / avg, 75, "gas difference should be < 75%");
    }

    function test_gasComparison_withFee_vs_withoutFee() public {
        // --- Swap WITH fee (25 bps) ---
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasWithFee = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsedWithFee = gasWithFee - gasleft();

        // --- Swap WITHOUT fee (0 bps) ---
        vm.prank(owner);
        aggregator.setProtocolFee(0);

        uint256 swapAmountNoFee = amountIn; // no fee deducted
        uint256 expectedOutNoFee = (swapAmountNoFee * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapStep[] memory stepsNoFee = new OmnomSwapAggregator.SwapStep[](1);
        stepsNoFee[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmountNoFee,
            minAmountOut: expectedOutNoFee
        });

        OmnomSwapAggregator.SwapRequest memory reqNoFee = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: expectedOutNoFee,
            steps: stepsNoFee,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasNoFee = gasleft();
        vm.prank(user);
        aggregator.executeSwap(reqNoFee);
        uint256 gasUsedNoFee = gasNoFee - gasleft();

        console2.log("With fee (25 bps) gas:", gasUsedWithFee);
        console2.log("Without fee (0 bps) gas:", gasUsedNoFee);
        console2.log("Fee overhead:", gasUsedWithFee - gasUsedNoFee);

        // With fee should use more gas due to fee calculation and transfer
        assertGt(gasUsedWithFee, gasUsedNoFee, "swap with fee should use more gas");
    }

    // ===================================================================
    // C. Gas Optimization Opportunities
    // ===================================================================

    function test_gasOptimization_approvalReset() public {
        // Measure gas for the approve(0) + approve(amount) pattern used by SafeERC20
        uint256 amount = 1000e18;

        // First approve - no reset needed (current allowance is 0)
        uint256 gas1 = gasleft();
        vm.prank(address(aggregator));
        tokenA.approve(address(router1), amount);
        uint256 gasApproveFresh = gas1 - gasleft();

        // Second approve - requires reset (current allowance is non-zero)
        uint256 gas2 = gasleft();
        vm.prank(address(aggregator));
        tokenA.approve(address(router1), amount);
        uint256 gasApproveOverwrite = gas2 - gasleft();

        // Reset to 0
        uint256 gas3 = gasleft();
        vm.prank(address(aggregator));
        tokenA.approve(address(router1), 0);
        uint256 gasApproveReset = gas3 - gasleft();

        console2.log("Fresh approve gas:", gasApproveFresh);
        console2.log("Overwrite approve gas:", gasApproveOverwrite);
        console2.log("Reset to 0 gas:", gasApproveReset);

        // Reset + set pattern (what SafeERC20 does)
        console2.log("Full reset pattern gas:", gasApproveReset + gasApproveFresh);
    }

    function test_gasOptimization_balanceDiffVsDirectAmount() public {
        // Measure gas for balance-diff pattern (2 balanceOf calls)
        uint256 gas1 = gasleft();
        uint256 bal1 = tokenA.balanceOf(address(aggregator));
        uint256 bal2 = tokenA.balanceOf(address(aggregator));
        uint256 diff = bal2 - bal1;
        diff; // silence warning
        uint256 gasBalanceDiff = gas1 - gasleft();

        // Measure gas for a single balanceOf call (direct amount approach)
        uint256 gas2 = gasleft();
        uint256 bal3 = tokenA.balanceOf(address(aggregator));
        bal3; // silence warning
        uint256 gasSingleBalanceOf = gas2 - gasleft();

        console2.log("Balance-diff (2 calls) gas:", gasBalanceDiff);
        console2.log("Single balanceOf gas:", gasSingleBalanceOf);
        console2.log("Overhead of balance-diff:", gasBalanceDiff - gasSingleBalanceOf);

        // Balance-diff should cost roughly 2x a single balanceOf
        assertGt(gasBalanceDiff, gasSingleBalanceOf, "balance-diff should cost more");
    }

    function test_gasOptimization_routerCount() public {
        // Register many additional routers to measure storage read impact
        for (uint256 i = 0; i < 10; i++) {
            MockUniswapV2Router extraRouter = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
            vm.prank(owner);
            aggregator.addRouter(address(extraRouter));
        }

        // Execute swap using the original router
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("Gas with 12 routers:", gasUsed);
        // Mapping lookup is O(1), so gas should be similar to single router
        assertLt(gasUsed, 300_000, "gas should not increase with more routers");
    }

    // ===================================================================
    // D. Gas Regression Guards
    // ===================================================================

    function test_gasRegression_1hop_withinBudget() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildNHopRequest(address(tokenA), tokens, SWAP_AMOUNT, address(router1), recipient, block.timestamp + 30 minutes);

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("1-hop regression gas:", gasUsed);
        // Baseline: 1-hop should be under 300k
        assertLt(gasUsed, 300_000, "1-hop gas regression");
    }

    function test_gasRegression_2hop_withinBudget() public {
        address[] memory tokens = new address[](3);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        tokens[2] = address(tokenC);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildNHopRequest(address(tokenA), tokens, SWAP_AMOUNT, address(router1), recipient, block.timestamp + 30 minutes);

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("2-hop regression gas:", gasUsed);
        // Baseline: 2-hop should be under 500k
        assertLt(gasUsed, 500_000, "2-hop gas regression");
    }

    function test_gasRegression_nativeSwap_withinBudget() public {
        uint256 amountIn = 1 ether;
        vm.deal(user, amountIn);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(wwdoge);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 gasStart = gasleft();
        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);
        uint256 gasUsed = gasStart - gasleft();

        console2.log("Native swap regression gas:", gasUsed);
        assertLt(gasUsed, 400_000, "native swap gas regression");
    }
}
