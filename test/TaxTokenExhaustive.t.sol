// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockDynamicFeeToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/**
 * @title TaxTokenExhaustiveTest
 * @notice Exhaustive tests for tax-based (dynamic fee) tokens covering every scenario:
 *
 *         A. Dynamic Fee Changes Mid-Transaction
 *         B. Tax Rate Edge Cases (0% -> 99%)
 *         C. Fee Exemption Scenarios
 *         D. Rounding-Dependent Fee Calculations
 *         E. Fee-on-Transfer in All Positions with Dynamic Fee
 *         F. Protocol Fee + Token Tax Interaction
 *
 *         The aggregator handles fee-on-transfer tokens via:
 *         - Balance-diff measurement (balanceBefore / balanceAfter)
 *         - Step 0 uses contract-computed swapAmount (received - feeAmount)
 *         - Steps > 0 use step.amountIn from the request (frontend-predicted)
 *         - Uses swapExactTokensForTokensSupportingFeeOnTransferTokens
 *
 *         MockDynamicFeeToken notes:
 *         - forceTransferFrom DOES charge fees (unlike MockFeeOnTransferToken)
 *         - Auto-fee-change mechanism enables mid-swap fee transitions
 *         - Rounding modes affect small-amount fee calculations
 */
contract TaxTokenExhaustiveTest is Test {
    OmnomSwapAggregator public aggregator;
    MockWWDOGE public wwdoge;

    // Standard tokens
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    // Dynamic fee tokens with different rates
    MockDynamicFeeToken public dyn3Pct;
    MockDynamicFeeToken public dyn5Pct;
    MockDynamicFeeToken public dyn10Pct;
    MockDynamicFeeToken public dyn50Pct;
    MockDynamicFeeToken public dyn99Pct;
    MockDynamicFeeToken public dyn0Pct;
    MockDynamicFeeToken public dyn1Pct;

    // Routers
    MockUniswapV2Router public router1;
    MockUniswapV2Router public router2;
    MockUniswapV2Router public router3;

    // Actors
    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);
    address public feeRecipient = address(0x600);

    // Constants
    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant PROTOCOL_FEE_BPS = 25;
    uint256 constant BPS = 10000;

    // ============================================================
    // SetUp
    // ============================================================

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, PROTOCOL_FEE_BPS, address(wwdoge));

        // Standard tokens
        tokenA = new MockERC20("TokenA", "TKA", 18);
        tokenB = new MockERC20("TokenB", "TKB", 18);

        // Dynamic fee tokens with varying rates (all use Floor rounding by default)
        dyn0Pct  = new MockDynamicFeeToken("Dyn0",  "D0",  18, 0,    feeRecipient);
        dyn1Pct  = new MockDynamicFeeToken("Dyn1",  "D1",  18, 100,  feeRecipient);
        dyn3Pct  = new MockDynamicFeeToken("Dyn3",  "D3",  18, 300,  feeRecipient);
        dyn5Pct  = new MockDynamicFeeToken("Dyn5",  "D5",  18, 500,  feeRecipient);
        dyn10Pct = new MockDynamicFeeToken("Dyn10", "D10", 18, 1000, feeRecipient);
        dyn50Pct = new MockDynamicFeeToken("Dyn50", "D50", 18, 5000, feeRecipient);
        dyn99Pct = new MockDynamicFeeToken("Dyn99", "D99", 18, 9900, feeRecipient);

        // Routers
        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router3 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));
        aggregator.addRouter(address(router3));

        vm.stopPrank();

        // Fund user with all tokens
        tokenA.mint(user, SWAP_AMOUNT * 1000);
        tokenB.mint(user, SWAP_AMOUNT * 1000);
        dyn0Pct.mint(user, SWAP_AMOUNT * 1000);
        dyn1Pct.mint(user, SWAP_AMOUNT * 1000);
        dyn3Pct.mint(user, SWAP_AMOUNT * 1000);
        dyn5Pct.mint(user, SWAP_AMOUNT * 1000);
        dyn10Pct.mint(user, SWAP_AMOUNT * 1000);
        dyn50Pct.mint(user, SWAP_AMOUNT * 1000);
        dyn99Pct.mint(user, SWAP_AMOUNT * 1000);

        // Fund routers with all tokens
        _fundRouter(address(router1));
        _fundRouter(address(router2));
        _fundRouter(address(router3));
    }

    // ============================================================
    // Helpers
    // ============================================================

    function _fundRouter(address rtr) internal {
        tokenA.mint(rtr, SWAP_AMOUNT * 10000);
        tokenB.mint(rtr, SWAP_AMOUNT * 10000);
        dyn0Pct.mint(rtr, SWAP_AMOUNT * 10000);
        dyn1Pct.mint(rtr, SWAP_AMOUNT * 10000);
        dyn3Pct.mint(rtr, SWAP_AMOUNT * 10000);
        dyn5Pct.mint(rtr, SWAP_AMOUNT * 10000);
        dyn10Pct.mint(rtr, SWAP_AMOUNT * 10000);
        dyn50Pct.mint(rtr, SWAP_AMOUNT * 10000);
        dyn99Pct.mint(rtr, SWAP_AMOUNT * 10000);
    }

    /// @dev Calculates amount after fee (floor rounding).
    function _afterFee(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        return amount - (amount * feeBps) / BPS;
    }

    /// @dev Calculates amount after fee with ceil rounding.
    function _afterFeeCeil(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        uint256 fee = (amount * feeBps) / BPS;
        uint256 remainder = (amount * feeBps) % BPS;
        if (remainder > 0) fee += 1;
        return amount - fee;
    }

    /// @dev Calculates protocol fee on a given amount.
    function _protocolFee(uint256 received) internal pure returns (uint256) {
        return (received * PROTOCOL_FEE_BPS) / BPS;
    }

    function _buildSingleHop(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 stepAmountIn,
        uint256 minOut,
        address rtr
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: rtr,
            path: path,
            amountIn: stepAmountIn,
            minAmountOut: minOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });
    }

    function _buildTwoHop(
        address tokenIn,
        address midToken,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 step1AmountIn,
        uint256 minTotalOut,
        address rtr0,
        address rtr1
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path0 = new address[](2);
        path0[0] = tokenIn;
        path0[1] = midToken;

        address[] memory path1 = new address[](2);
        path1[0] = midToken;
        path1[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: rtr0,
            path: path0,
            amountIn: totalAmountIn,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: rtr1,
            path: path1,
            amountIn: step1AmountIn,
            minAmountOut: 0
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: totalAmountIn,
            minTotalAmountOut: minTotalOut,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });
    }

    function _buildThreeHop(
        address tokenIn,
        address mid1,
        address mid2,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 step1AmountIn,
        uint256 step2AmountIn,
        uint256 minTotalOut,
        address rtr0,
        address rtr1,
        address rtr2
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path0 = new address[](2);
        path0[0] = tokenIn;
        path0[1] = mid1;

        address[] memory path1 = new address[](2);
        path1[0] = mid1;
        path1[1] = mid2;

        address[] memory path2 = new address[](2);
        path2[0] = mid2;
        path2[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep(rtr0, path0, totalAmountIn, 0);
        steps[1] = OmnomSwapAggregator.SwapStep(rtr1, path1, step1AmountIn, 0);
        steps[2] = OmnomSwapAggregator.SwapStep(rtr2, path2, step2AmountIn, 0);

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: totalAmountIn,
            minTotalAmountOut: minTotalOut,
            steps: steps,
            deadline: block.timestamp + 600,
            recipient: recipient
        });
    }

    // ============================================================
    // A. Dynamic Fee Changes Mid-Transaction
    // ============================================================

    /// @notice Fee changes from 3% to 10% between user approval and swap execution.
    ///         The aggregator's balance-diff measurement handles the higher fee.
    function test_dynamicFee_changeBetweenApprovalAndExecution() public {
        uint256 amount = 1000e18;

        // Fee is 3% at approval time
        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        // Fee changes to 10% before swap executes
        dyn3Pct.setFeeBps(1000); // 10%

        // Calculate expected values with 10% fee:
        // received = 1000e18 * 9000/10000 = 900e18
        // protocolFee = 900e18 * 25/10000 = 2.25e18
        // swapAmount = 900e18 - 2.25e18 = 897.75e18
        // Router uses swapAmount for output: 897.75e18 * 2 = 1795.5e18
        uint256 received = _afterFee(amount, 1000);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn3Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output tokens");
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch after fee change");
    }

    /// @notice Fee increases from 3% to 10% between step 0 and step 1 of a multi-hop swap.
    ///         Uses auto-fee-change mechanism: after 1 transfer of dyn token, fee changes.
    function test_dynamicFee_feeIncreasesDuringSwap() public {
        uint256 amount = 1000e18;

        // Configure auto-fee-change: after 1 transfer, fee goes from 3% to 10%
        dyn3Pct.setAutoFeeChange(1, 1000);

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // Step 0: TokenA (standard) -> Router0 -> DynToken(3%) -> Aggregator
        //   swapAmount = 1000 - 0.25% = 997.5 TokenA
        //   Router output: 997.5 * 2 = 1995 DynToken
        //   Transfer fee (3%): aggregator receives 1995 * 0.97 = 1935.15
        //   transferCount becomes 1 -> auto-change fires, fee becomes 10%
        // Step 1: DynToken -> Router1 -> TokenB -> Aggregator
        //   forceTransferFrom with 10% fee: router receives 1935.15 * 0.90
        //   Router output based on stepAmountIn: 1935.15 * 2 = 3870.30 TokenB
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 300); // 3% fee on step0 output
        uint256 expectedOutput = (aggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(tokenA), address(dyn3Pct), address(tokenB),
            amount, aggReceives, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output tokens");
        assertApproxEqAbs(userReceived, expectedOutput, 0.02e18, "Output mismatch");
    }

    /// @notice Fee decreases from 10% to 3% between step 0 and step 1.
    function test_dynamicFee_feeDecreasesDuringSwap() public {
        uint256 amount = 1000e18;

        // Configure auto-fee-change: after 1 transfer, fee goes from 10% to 3%
        dyn10Pct.setAutoFeeChange(1, 300);

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // Step 0: TokenA -> Router0 -> DynToken(10%) -> Aggregator
        //   swapAmount = 997.5 TokenA
        //   Router output: 1995 DynToken
        //   Transfer fee (10%): aggregator receives 1995 * 0.90 = 1795.5
        //   transferCount = 1 -> fee changes to 3%
        // Step 1: DynToken(3% on forceTransferFrom) -> Router1 -> TokenB
        //   Router output based on stepAmountIn: 1795.5 * 2 = 3591 TokenB
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 1000); // 10% fee on step0 output
        uint256 expectedOutput = (aggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(tokenA), address(dyn10Pct), address(tokenB),
            amount, aggReceives, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output tokens");
        assertApproxEqAbs(userReceived, expectedOutput, 0.02e18, "Output mismatch");
    }

    /// @notice Fee was 5%, auto-changes to 0% mid-swap (after step 0 output).
    function test_dynamicFee_feeSetToZero_midSwap() public {
        uint256 amount = 1000e18;

        // Configure auto-fee-change: after 1 transfer, fee goes from 5% to 0%
        dyn5Pct.setAutoFeeChange(1, 0);

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // Step 0: TokenA -> Router0 -> DynToken(5%) -> Aggregator
        //   swapAmount = 997.5 TokenA
        //   Router output: 1995 DynToken
        //   Transfer fee (5%): aggregator receives 1995 * 0.95 = 1895.25
        //   transferCount = 1 -> fee changes to 0%
        // Step 1: DynToken(0% on forceTransferFrom) -> Router1 -> TokenB
        //   No fee on forceTransferFrom
        //   Router output based on stepAmountIn: 1895.25 * 2 = 3790.5 TokenB
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 500); // 5% fee on step0 output
        uint256 expectedOutput = (aggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(tokenA), address(dyn5Pct), address(tokenB),
            amount, aggReceives, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output tokens");
        assertApproxEqAbs(userReceived, expectedOutput, 0.02e18, "Output mismatch");

        // Verify fee is now 0%
        assertEq(dyn5Pct.feeBps(), 0, "Fee should be 0 after auto-change");
    }

    /// @notice Fee was 1%, auto-changes to 99% mid-swap.
    function test_dynamicFee_feeSetToMax_midSwap() public {
        uint256 amount = 1000e18;

        // Configure auto-fee-change: after 1 transfer, fee goes from 1% to 99%
        dyn1Pct.setAutoFeeChange(1, 9900);

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // Step 0: TokenA -> Router0 -> DynToken(1%) -> Aggregator
        //   swapAmount = 997.5 TokenA
        //   Router output: 1995 DynToken
        //   Transfer fee (1%): aggregator receives 1995 * 0.99 = 1975.05
        //   transferCount = 1 -> fee changes to 99%
        // Step 1: DynToken(99% on forceTransferFrom) -> Router1 -> TokenB
        //   Router output based on stepAmountIn: 1975.05 * 2 = 3950.1 TokenB
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 100); // 1% fee on step0 output
        uint256 expectedOutput = (aggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(tokenA), address(dyn1Pct), address(tokenB),
            amount, aggReceives, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output tokens");
        assertApproxEqAbs(userReceived, expectedOutput, 0.02e18, "Output mismatch");

        // Verify fee is now 99%
        assertEq(dyn1Pct.feeBps(), 9900, "Fee should be 99% after auto-change");
    }

    // ============================================================
    // B. Tax Rate Edge Cases
    // ============================================================

    /// @notice 0% fee — exact amount transferred, no deduction.
    function test_taxRate_0percent_noFeeCharged() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn0Pct.approve(address(aggregator), amount);

        // With 0% token fee: received = 1000e18, protocolFee = 2.5e18
        // swapAmount = 997.5e18, output = 997.5 * 2 = 1995e18
        uint256 received = amount; // no fee
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn0Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertEq(userReceived, expectedOutput, "Should receive exact expected output");
    }

    /// @notice 1% fee — swap succeeds with correct output.
    function test_taxRate_1percent_normalOperation() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn1Pct.approve(address(aggregator), amount);

        // received = 1000 * 0.99 = 990e18
        // protocolFee = 990 * 0.0025 = 2.475e18
        // swapAmount = 987.525e18
        // output = 987.525 * 2 = 1975.05e18
        uint256 received = _afterFee(amount, 100);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn1Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch at 1%");
    }

    /// @notice 5% fee — swap succeeds with correct output.
    function test_taxRate_5percent_normalOperation() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn5Pct.approve(address(aggregator), amount);

        uint256 received = _afterFee(amount, 500);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn5Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch at 5%");
    }

    /// @notice 10% fee — swap succeeds with correct output.
    function test_taxRate_10percent_normalOperation() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn10Pct.approve(address(aggregator), amount);

        uint256 received = _afterFee(amount, 1000);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn10Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch at 10%");
    }

    /// @notice 50% fee — slippage protection catches excessive deduction.
    ///         The router's own "Insufficient output" check fires first because
    ///         the exchange rate can't produce enough output tokens to meet
    ///         the minimum. This validates that slippage protection works.
    function test_taxRate_50percent_slippageCatches() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn50Pct.approve(address(aggregator), amount);

        // With 50% fee: received = 500e18
        // output = (500 - 1.25) * 2 = 997.5e18
        // Set minTotalAmountOut higher than actual output
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn50Pct), address(tokenB),
            amount, amount, 1500e18, // higher than actual ~997.5
            address(router1)
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice 99% fee — only 1% of tokens arrive at destination.
    function test_taxRate_99percent_minimalOutput() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn99Pct.approve(address(aggregator), amount);

        // With 99% fee: received = 10e18
        // protocolFee = 10 * 0.0025 = 0.025e18
        // swapAmount = 9.975e18
        // output = 9.975 * 2 = 19.95e18
        uint256 received = _afterFee(amount, 9900);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn99Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive some output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch at 99%");

        // Verify output is approximately 1% of what it would be without tax
        // Without tax: 1995e18. With 99% tax: ~19.95e18
        assertLt(userReceived, 25e18, "Output should be minimal at 99% tax");
    }

    // ============================================================
    // C. Fee Exemption Scenarios
    // ============================================================

    /// @notice Aggregator is fee-exempt — no fee on aggregator's transfers (forceTransferFrom).
    function test_feeExempt_aggregatorAddress() public {
        uint256 amount = 1000e18;

        // Make aggregator fee-exempt
        dyn3Pct.setFeeExempt(address(aggregator), true);

        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        // User->Aggregator (transferFrom): user is sender, NOT exempt -> fee charged
        // received = 1000 * 0.97 = 970e18
        // protocolFee = 970 * 0.0025 = 2.425e18
        // swapAmount = 967.575e18
        // Aggregator->Router (forceTransferFrom): aggregator is sender, EXEMPT -> no fee
        // Router receives full 967.575e18
        // output = 967.575 * 2 = 1935.15e18
        uint256 received = _afterFee(amount, 300);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn3Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch with exempt aggregator");
    }

    /// @notice Router is fee-exempt — no fee on router's output transfer.
    function test_feeExempt_routerAddress() public {
        uint256 amount = 1000e18;

        // Make router1 fee-exempt
        dyn3Pct.setFeeExempt(address(router1), true);

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // TokenA (standard) -> Router1 -> DynToken(3%) -> Aggregator -> Recipient
        // Router1 sends DynToken via transfer: router1 is sender, EXEMPT -> no fee
        // Aggregator receives full output: 997.5 * 2 = 1995e18
        // Aggregator sends to recipient via safeTransfer: aggregator NOT exempt -> fee charged
        // Recipient receives: 1995 * 0.97 = 1935.15e18
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        // No fee on router output (router is exempt)
        // But fee on aggregator->recipient transfer
        uint256 recipientReceives = _afterFee(routerOut, 300);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(tokenA), address(dyn3Pct),
            amount, amount, 0, address(router1)
        );

        uint256 before = dyn3Pct.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = dyn3Pct.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive fee tokens");
        assertApproxEqAbs(userReceived, recipientReceives, 0.02e18, "Output mismatch with exempt router");
    }

    /// @notice Fee exemption removed mid-swap (auto-exempt-change after 1 transfer).
    ///         Aggregator starts exempt, loses exemption after step 0 output.
    function test_feeExempt_removedMidSwap() public {
        uint256 amount = 1000e18;

        // Start with aggregator exempt
        dyn3Pct.setFeeExempt(address(aggregator), true);

        // Auto-remove exemption after 1 transfer of dyn token
        dyn3Pct.setAutoExemptChange(1, address(aggregator), false);

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // Step 0: TokenA -> Router0 -> DynToken(3%) -> Aggregator
        //   Router0 sends DynToken via transfer: router0 is sender, NOT exempt -> fee charged
        //   transferCount = 1 -> auto-change fires, aggregator exemption REMOVED
        //   Aggregator receives: 1995 * 0.97 = 1935.15
        // Step 1: DynToken -> Router1 -> TokenB
        //   forceTransferFrom: aggregator is sender, exemption REMOVED -> fee charged
        //   Router output based on stepAmountIn: 1935.15 * 2 = 3870.30 TokenB
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 300); // fee on step0 output
        uint256 expectedOutput = (aggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(tokenA), address(dyn3Pct), address(tokenB),
            amount, aggReceives, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.02e18, "Output mismatch");

        // Verify aggregator is no longer exempt
        assertFalse(dyn3Pct.feeExempt(address(aggregator)), "Aggregator should not be exempt");
    }

    /// @notice Fee exemption added mid-swap (auto-exempt-change after 1 transfer).
    ///         Aggregator starts non-exempt, gains exemption after step 0 output.
    function test_feeExempt_addedMidSwap() public {
        uint256 amount = 1000e18;

        // Aggregator starts NOT exempt (default)

        // Auto-add exemption after 1 transfer of dyn token
        dyn3Pct.setAutoExemptChange(1, address(aggregator), true);

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // Step 0: TokenA -> Router0 -> DynToken(3%) -> Aggregator
        //   Router0 sends DynToken via transfer: router0 is sender, NOT exempt -> fee charged
        //   transferCount = 1 -> auto-change fires, aggregator BECOMES exempt
        //   Aggregator receives: 1995 * 0.97 = 1935.15
        // Step 1: DynToken -> Router1 -> TokenB
        //   forceTransferFrom: aggregator is sender, NOW EXEMPT -> no fee
        //   Router output based on stepAmountIn: 1935.15 * 2 = 3870.30 TokenB
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 300); // fee on step0 output
        uint256 expectedOutput = (aggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(tokenA), address(dyn3Pct), address(tokenB),
            amount, aggReceives, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.02e18, "Output mismatch");

        // Verify aggregator is now exempt
        assertTrue(dyn3Pct.feeExempt(address(aggregator)), "Aggregator should be exempt");
    }

    // ============================================================
    // D. Rounding-Dependent Fee Calculations
    // ============================================================

    /// @notice Floor rounding with 1 wei amount — fee rounds down to 0.
    function test_rounding_floor_smallAmount() public {
        uint256 amount = 1; // 1 wei

        // dyn3Pct uses Floor rounding by default
        // fee = (1 * 300) / 10000 = 0 (floor)
        // amountAfterFee = 1 - 0 = 1
        uint256 fee = (amount * 300) / BPS;
        assertEq(fee, 0, "Floor fee should be 0 for 1 wei");

        // Transfer 1 wei and verify no fee charged
        dyn3Pct.mint(user, amount);
        uint256 balBefore = dyn3Pct.balanceOf(recipient);

        vm.prank(user);
        dyn3Pct.transfer(recipient, amount);

        assertEq(dyn3Pct.balanceOf(recipient) - balBefore, 1, "Recipient should get full 1 wei");
    }

    /// @notice Ceil rounding with 1 wei amount — fee rounds up to 1.
    function test_rounding_ceil_smallAmount() public {
        uint256 amount = 1; // 1 wei

        // Switch to Ceil rounding
        dyn3Pct.setRoundingMode(MockDynamicFeeToken.RoundingMode.Ceil);

        // fee = (1 * 300) / 10000 = 0, remainder = 300 > 0, ceil -> fee = 1
        // amountAfterFee = 1 - 1 = 0!
        dyn3Pct.mint(user, amount);
        uint256 recipientBefore = dyn3Pct.balanceOf(recipient);
        uint256 feeRecipientBefore = dyn3Pct.balanceOf(feeRecipient);

        vm.prank(user);
        dyn3Pct.transfer(recipient, amount);

        // Recipient gets 0 (entire 1 wei consumed as fee)
        assertEq(dyn3Pct.balanceOf(recipient) - recipientBefore, 0, "Recipient gets 0 with ceil rounding");
        // Fee recipient gets 1
        assertEq(dyn3Pct.balanceOf(feeRecipient) - feeRecipientBefore, 1, "Fee recipient gets 1");
    }

    /// @notice Round mode at exactly 0.5 threshold — remainder == 5000 rounds up.
    function test_rounding_round_threshold() public {
        // Find amount where remainder is exactly 5000 with 300 bps fee:
        // (amount * 300) % 10000 = 5000
        // amount * 300 = k * 10000 + 5000
        // For k=1: amount = 15000 / 300 = 50
        uint256 amount = 50;
        uint256 expectedFee = (amount * 300) / BPS; // 15000 / 10000 = 1
        uint256 remainder = (amount * 300) % BPS;   // 5000

        assertEq(expectedFee, 1, "Base fee should be 1");
        assertEq(remainder, 5000, "Remainder should be exactly 5000");

        // With Floor: fee = 1
        dyn3Pct.mint(user, amount);
        uint256 recipientFloor = dyn3Pct.balanceOf(recipient);

        vm.prank(user);
        dyn3Pct.transfer(recipient, amount);

        uint256 floorReceived = dyn3Pct.balanceOf(recipient) - recipientFloor;
        assertEq(floorReceived, amount - 1, "Floor: recipient gets 49");

        // Reset: switch to Round mode
        dyn3Pct.setRoundingMode(MockDynamicFeeToken.RoundingMode.Round);
        dyn3Pct.mint(user, amount);
        recipientFloor = dyn3Pct.balanceOf(recipient);

        vm.prank(user);
        dyn3Pct.transfer(recipient, amount);

        uint256 roundReceived = dyn3Pct.balanceOf(recipient) - recipientFloor;
        // Round: remainder >= 5000, so fee rounds up to 2
        assertEq(roundReceived, amount - 2, "Round: recipient gets 48 (fee rounded up)");
    }

    /// @notice Compare outputs with floor vs ceil rounding on the same amount.
    function test_rounding_floor_vs_ceil_comparison() public {
        // Floor: fee = (100 * 300) / 10000 = 3, remainder = 0
        // Ceil:  fee = 3 (remainder = 0, no ceil adjustment needed)
        // For a more interesting comparison, use 101 wei:
        // Floor: fee = (101 * 300) / 10000 = 3, remainder = 300
        // Ceil:  fee = 3 + 1 = 4 (remainder > 0)
        uint256 testAmount = 101;

        // Floor transfer
        dyn3Pct.mint(user, testAmount);
        uint256 recipientBefore = dyn3Pct.balanceOf(recipient);

        vm.prank(user);
        dyn3Pct.transfer(recipient, testAmount);

        uint256 floorReceived = dyn3Pct.balanceOf(recipient) - recipientBefore;

        // Ceil transfer
        dyn3Pct.setRoundingMode(MockDynamicFeeToken.RoundingMode.Ceil);
        dyn3Pct.mint(user, testAmount);
        recipientBefore = dyn3Pct.balanceOf(recipient);

        vm.prank(user);
        dyn3Pct.transfer(recipient, testAmount);

        uint256 ceilReceived = dyn3Pct.balanceOf(recipient) - recipientBefore;

        // Floor: 101 - 3 = 98
        assertEq(floorReceived, 98, "Floor: should receive 98");
        // Ceil: 101 - 4 = 97
        assertEq(ceilReceived, 97, "Ceil: should receive 97");
        // Difference is 1 wei
        assertEq(floorReceived - ceilReceived, 1, "Difference should be 1 wei");
    }

    /// @notice Rounding difference causes slippage revert.
    ///         Frontend calculates with Floor, but token uses Ceil.
    ///         Uses 101 wei: 101*300=30300, remainder=300>0, so Ceil adds 1.
    function test_rounding_effectOnSlippage() public {
        uint256 amount = 101 wei;

        // Use Ceil rounding — higher fee than Floor
        dyn3Pct.setRoundingMode(MockDynamicFeeToken.RoundingMode.Ceil);

        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        // Calculate expected output with FLOOR rounding (what frontend would predict):
        // fee = (101 * 300) / 10000 = 3, remainder = 300 (ignored in floor)
        // received = 101 - 3 = 98
        // protocolFee = 98 * 25 / 10000 = 0
        // swapAmount = 98
        // output = 98 * 2 = 196
        uint256 floorReceived = amount - (amount * 300) / BPS;
        uint256 floorSwapAmt = floorReceived - _protocolFee(floorReceived);
        uint256 floorOutput = (floorSwapAmt * EXCHANGE_RATE) / 1e18;

        // But ACTUAL with Ceil rounding:
        // fee = 3 + 1 = 4 (remainder = 300 > 0)
        // received = 101 - 4 = 97
        // protocolFee = 97 * 25 / 10000 = 0
        // swapAmount = 97
        // output = 97 * 2 = 194

        // Set minTotalAmountOut based on Floor expectation (196)
        // Actual output will be 194 -> revert.
        // The router's "Insufficient output" fires before the aggregator's "Slippage"
        // because _buildSingleHop sets step.minAmountOut = minTotalAmountOut.
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn3Pct), address(tokenB),
            amount, amount, floorOutput, // 196, but actual will be 194
            address(router1)
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    // ============================================================
    // E. Fee-on-Transfer in All Positions with Dynamic Fee
    // ============================================================

    /// @notice Dynamic fee token as input to single-hop swap.
    function test_dynamicFeeInput_singleHop() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        // User->Aggregator: 3% fee, received = 970e18
        // protocolFee = 970 * 0.0025 = 2.425e18
        // swapAmount = 967.575e18
        // forceTransferFrom: 3% fee (router receives less)
        // Router output based on swapAmount: 967.575 * 2 = 1935.15e18
        uint256 received = _afterFee(amount, 300);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn3Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch");
    }

    /// @notice Dynamic fee token as input to multi-hop (first hop).
    function test_dynamicFeeInput_multiHop_firstHop() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        // Step 0: DynToken(3%) -> Router0 -> TokenA -> Aggregator
        //   received = 970e18, protocolFee = 2.425e18, swapAmount = 967.575e18
        //   forceTransferFrom: 3% fee on DynToken
        //   Router output: 967.575 * 2 = 1935.15 TokenA (standard, no fee)
        //   Aggregator receives: 1935.15 TokenA
        // Step 1: TokenA -> Router1 -> TokenB -> Aggregator
        //   Router output: 1935.15 * 2 = 3870.30 TokenB
        uint256 received = _afterFee(amount, 300);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 step0Output = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 expectedFinal = (step0Output * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(dyn3Pct), address(tokenA), address(tokenB),
            amount, step0Output, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedFinal, 0.02e18, "Output mismatch");
    }

    /// @notice Dynamic fee token as intermediate in multi-hop swap.
    function test_dynamicFeeIntermediate_multiHop() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // Step 0: TokenA (standard) -> Router0 -> DynToken(3%) -> Aggregator
        //   swapAmount = 997.5 TokenA
        //   Router output: 1995 DynToken
        //   Transfer fee (3%): aggregator receives 1935.15 DynToken
        // Step 1: DynToken -> Router1 -> TokenB -> Aggregator
        //   forceTransferFrom: 3% fee
        //   Router output based on stepAmountIn: 1935.15 * 2 = 3870.30 TokenB
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 300);
        uint256 expectedOutput = (aggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHop(
            address(tokenA), address(dyn3Pct), address(tokenB),
            amount, aggReceives, 0,
            address(router1), address(router2)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.02e18, "Output mismatch");
    }

    /// @notice Dynamic fee token as output — user receives less due to double fee.
    ///         Fee on router->aggregator transfer AND aggregator->recipient transfer.
    function test_dynamicFeeOutput_singleHop() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        tokenA.approve(address(aggregator), amount);

        // TokenA (standard) -> Router -> DynToken(3%) -> Aggregator -> Recipient
        // swapAmount = 997.5 TokenA
        // Router output: 1995 DynToken
        // Router->Aggregator (transfer): 3% fee, aggregator receives 1935.15
        // Aggregator->Recipient (safeTransfer): 3% fee AGAIN, recipient receives 1877.0955
        uint256 swapAmt = amount - _protocolFee(amount);
        uint256 routerOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 aggReceives = _afterFee(routerOut, 300);
        uint256 recipientReceives = _afterFee(aggReceives, 300);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(tokenA), address(dyn3Pct),
            amount, amount, 0, address(router1)
        );

        uint256 before = dyn3Pct.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = dyn3Pct.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive fee tokens");
        assertApproxEqAbs(userReceived, recipientReceives, 0.02e18, "Recipient amount mismatch");
    }

    /// @notice Dynamic fee tokens in all 3 positions of a 3-hop swap.
    ///         DynTokenA (input, 3%) -> DynTokenB (mid, 5%) -> DynTokenC (mid, 3%) -> TokenB (output)
    function test_dynamicFeeAllPositions_threeHop() public {
        uint256 amount = 1000e18;

        // Create additional dynamic fee tokens for the 3-hop
        MockDynamicFeeToken dynTokenA = dyn3Pct; // 3% fee (reuse existing)
        MockDynamicFeeToken dynTokenB = dyn5Pct; // 5% fee (reuse existing)
        MockDynamicFeeToken dynTokenC = dyn10Pct; // 10% fee (reuse existing)

        vm.prank(user);
        dynTokenA.approve(address(aggregator), amount);

        // Step 0: DynTokenA(3%) -> Router0 -> DynTokenB(5%) -> Aggregator
        //   received = 1000 * 0.97 = 970e18
        //   protocolFee = 970 * 0.0025 = 2.425e18
        //   swapAmount = 967.575e18
        //   forceTransferFrom: 3% fee on DynTokenA
        //   Router output: 967.575 * 2 = 1935.15 DynTokenB
        //   DynTokenB transfer (5% fee): aggregator receives 1935.15 * 0.95 = 1838.3925
        uint256 received = _afterFee(amount, 300);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 step0RouterOut = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 step0AggReceives = _afterFee(step0RouterOut, 500);

        // Step 1: DynTokenB(5%) -> Router1 -> DynTokenC(10%) -> Aggregator
        //   forceTransferFrom: 5% fee on DynTokenB
        //   Router output: step0AggReceives * 2 = 3676.785 DynTokenC
        //   DynTokenC transfer (10% fee): aggregator receives 3676.785 * 0.90 = 3309.1065
        uint256 step1RouterOut = (step0AggReceives * EXCHANGE_RATE) / 1e18;
        uint256 step1AggReceives = _afterFee(step1RouterOut, 1000);

        // Step 2: DynTokenC(10%) -> Router2 -> TokenB (standard) -> Aggregator
        //   forceTransferFrom: 10% fee on DynTokenC
        //   Router output: step1AggReceives * 2 TokenB (standard, no fee)
        uint256 expectedOutput = (step1AggReceives * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildThreeHop(
            address(dynTokenA), address(dynTokenB), address(dynTokenC), address(tokenB),
            amount, step0AggReceives, step1AggReceives, 0,
            address(router1), address(router2), address(router3)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertGt(userReceived, 0, "Should receive output");
        assertApproxEqAbs(userReceived, expectedOutput, 0.1e18, "Output mismatch in 3-hop");
    }

    // ============================================================
    // F. Protocol Fee + Token Tax Interaction
    // ============================================================

    /// @notice Protocol fee (25 bps) + token tax (3%) = combined deduction from input.
    function test_combinedFees_protocolPlusTokenTax() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        // Token tax: 3% on transfer -> received = 970e18
        // Protocol fee: 0.25% on received -> feeAmount = 2.425e18
        // Total deduction from user's perspective: 30e18 + 2.425e18 = 32.425e18
        // swapAmount = 967.575e18
        uint256 received = _afterFee(amount, 300);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;

        // Verify combined deduction
        assertEq(amount - swapAmt, 32.425e18, "Combined deduction mismatch");

        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn3Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch");
    }

    /// @notice Verify exact calculation: protocolFee = (postTaxAmount * 25) / 10000.
    function test_combinedFees_exactCalculation() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        // Step 1: Token tax deducted on user->aggregator transfer
        uint256 tokenTax = (amount * 300) / BPS; // 30e18
        uint256 postTaxAmount = amount - tokenTax; // 970e18

        // Step 2: Protocol fee calculated on post-tax amount
        uint256 expectedProtocolFee = (postTaxAmount * PROTOCOL_FEE_BPS) / BPS; // 2.425e18
        uint256 expectedSwapAmount = postTaxAmount - expectedProtocolFee; // 967.575e18

        // Verify the math
        assertEq(tokenTax, 30e18, "Token tax should be 30e18");
        assertEq(postTaxAmount, 970e18, "Post-tax should be 970e18");
        assertEq(expectedProtocolFee, 2.425e18, "Protocol fee should be 2.425e18");
        assertEq(expectedSwapAmount, 967.575e18, "Swap amount should be 967.575e18");

        // Use dyn3Pct as input, tokenB as output
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn3Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Protocol fee is in dyn3Pct (the input token), not tokenA.
        // Note: The aggregator sends the protocol fee via safeTransfer, which triggers
        // the dynamic fee token's fee mechanism AGAIN. So treasury receives:
        // expectedProtocolFee * (1 - feeBps/10000) = 2.425 * 0.97 = 2.35225
        uint256 treasuryDynBalance = dyn3Pct.balanceOf(treasury);
        uint256 treasuryExpected = _afterFee(expectedProtocolFee, 300);
        assertApproxEqAbs(treasuryDynBalance, treasuryExpected, 0.01e18, "Treasury should receive protocol fee minus token tax");
    }

    /// @notice 50% token tax + 0.25% protocol fee — extreme combined deduction.
    function test_combinedFees_highTax_plusProtocolFee() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        dyn50Pct.approve(address(aggregator), amount);

        // Token tax: 50% -> received = 500e18
        // Protocol fee: 0.25% on 500 -> 1.25e18
        // swapAmount = 498.75e18
        // output = 498.75 * 2 = 997.5e18
        uint256 received = _afterFee(amount, 5000);
        uint256 pFee = _protocolFee(received);
        uint256 swapAmt = received - pFee;
        uint256 expectedOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        assertEq(received, 500e18, "Should receive 50% after tax");
        assertEq(pFee, 1.25e18, "Protocol fee on post-tax amount");
        assertEq(swapAmt, 498.75e18, "Swap amount after both fees");

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn50Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        uint256 before = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 userReceived = tokenB.balanceOf(recipient) - before;
        assertApproxEqAbs(userReceived, expectedOutput, 0.01e18, "Output mismatch at 50% + protocol fee");
    }

    /// @notice Rounding in token tax affects the protocol fee base.
    ///         Ceil rounding gives higher fee -> lower received -> lower protocol fee base.
    function test_combinedFees_roundingInteraction() public {
        uint256 amount = 10001 wei;

        // --- Floor rounding ---
        // fee = (10001 * 300) / 10000 = 300, remainder = 300
        // received = 10001 - 300 = 9701
        // protocolFee = 9701 * 25 / 10000 = 24
        uint256 floorFee = (amount * 300) / BPS;
        uint256 floorReceived = amount - floorFee;
        uint256 floorProtocolFee = (floorReceived * PROTOCOL_FEE_BPS) / BPS;

        // --- Ceil rounding ---
        // fee = 300 + 1 = 301 (remainder 300 > 0)
        // received = 10001 - 301 = 9700
        // protocolFee = 9700 * 25 / 10000 = 24
        uint256 ceilFee = (amount * 300) / BPS + 1;
        uint256 ceilReceived = amount - ceilFee;
        uint256 ceilProtocolFee = (ceilReceived * PROTOCOL_FEE_BPS) / BPS;

        // The token tax rounding affects the received amount
        assertEq(floorReceived - ceilReceived, 1, "Ceil reduces received by 1 wei");

        // Protocol fee MAY or MAY NOT differ depending on integer division
        // In this case both are 24, but the BASE is different
        // The key insight: protocol fee is calculated on post-tax (post-rounding) amount
        // So rounding in token tax directly affects the protocol fee base
        assertEq(floorProtocolFee, ceilProtocolFee, "Same protocol fee in this case, but base differs");

        // Verify with actual transfers using Ceil rounding
        dyn3Pct.setRoundingMode(MockDynamicFeeToken.RoundingMode.Ceil);
        dyn3Pct.mint(user, amount);

        vm.prank(user);
        dyn3Pct.approve(address(aggregator), amount);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleHop(
            address(dyn3Pct), address(tokenB),
            amount, amount, 0, address(router1)
        );

        // Treasury should receive the protocol fee calculated on ceil-reduced amount
        uint256 treasuryBefore = dyn3Pct.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 treasuryReceived = dyn3Pct.balanceOf(treasury) - treasuryBefore;
        assertApproxEqAbs(treasuryReceived, ceilProtocolFee, 1, "Treasury fee should match ceil-based calculation");
    }
}
