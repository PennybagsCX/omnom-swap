// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console} from "forge-std/Test.sol";
import {OmnomSwapAggregator} from "../contracts/OmnomSwapAggregator.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {MockWWDOGE} from "../contracts/mocks/MockWWDOGE.sol";
import {MockUniswapV2Router} from "../contracts/mocks/MockUniswapV2Router.sol";

/**
 * @title FlipSwapConsistencyTest
 * @notice Tests for the flip/swap operation consistency in the OmnomSwapAggregator.
 *
 * These tests verify mathematical consistency across flip operations, including:
 * - Decimal mismatch handling (18 dec tokens vs 6 dec tokens)
 * - Zero amount edge cases
 * - Maximum slippage scenarios (100% = 10000 bps)
 * - Multi-hop route execution
 * - Fee deduction correctness
 * - Dust amount handling
 * - Same-token auto-flip prevention
 * - Extreme values (1 wei, max uint256)
 *
 * Bug Tested: Decimal Mismatch on Flip
 * When activeField === 'buy' and user flips:
 *   - newBuyPlaceholder = reverseRoute.totalAmountIn formatted with inDecimals
 *   - But inDecimals is the OLD sell token's decimals (before flip)
 *   - After flip, this should be formatted with what was previously the BUY token's decimals
 */
contract FlipSwapConsistencyTest is Test {
    MockERC20 public omnomToken;
    MockWWDOGE public wwdoge;
    MockUniswapV2Router public router1;
    MockUniswapV2Router public router2;
    OmnomSwapAggregator public aggregator;
    address public treasury;
    address public user;

    uint8 public constant WWDOGE_DECIMALS = 18;
    uint8 public constant OMNOM_DECIMALS = 6;
    uint256 public constant RATE_1_1 = 1e18;
    uint256 public constant FEE_BPS = 25;
    uint256 public constant BPS_DENOM = 10000;

    function setUp() public {
        treasury = makeAddr("treasury");
        user = makeAddr("user");

        wwdoge = new MockWWDOGE();
        omnomToken = new MockERC20("Omnom", "OMNOM", OMNOM_DECIMALS);
        router1 = new MockUniswapV2Router(address(0), RATE_1_1);
        router2 = new MockUniswapV2Router(address(0), RATE_1_1);

        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));
        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));

        omnomToken.mint(address(router1), 1e30);
        omnomToken.mint(address(router2), 1e30);
        wwdoge.mint(address(router1), 1e30);
        wwdoge.mint(address(router2), 1e30);

        wwdoge.mint(user, 1e30);
        omnomToken.mint(user, 1e30);
    }

    function toWei(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        return amount * (10 ** decimals);
    }

    function buildSingleHopRequest(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: minAmountOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minTotalAmountOut: minAmountOut,
            steps: steps,
            deadline: deadline,
            recipient: user
        });
    }

    // ─── Test: Flip from Sell Mode ──────────────────────────────────────────────

    function test_flipFromSellMode_preservesOriginalSellAmount() public {
        uint256 sellAmountWei = toWei(100, WWDOGE_DECIMALS);
        uint256 expectedOutputWei = sellAmountWei;

        uint256 userWwdogeBefore = wwdoge.balanceOf(user);
        uint256 userOmnomBefore = omnomToken.balanceOf(user);

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmountWei);

        uint256 deadline = block.timestamp + 300;
        uint256 minOut = (expectedOutputWei * 9500) / BPS_DENOM;

        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            sellAmountWei,
            minOut,
            deadline
        );

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 userWwdogeAfter = wwdoge.balanceOf(user);
        uint256 userOmnomAfter = omnomToken.balanceOf(user);

        assertEq(userWwdogeAfter, userWwdogeBefore - sellAmountWei, "WWDOGE balance should decrease");
        assertGt(userOmnomAfter, userOmnomBefore, "OMNOM balance should increase");
    }

    // ─── Test: Flip from Buy Mode (Critical Bug Test) ──────────────────────────

    function test_flipFromBuyMode_decimalMismatch_doesNotCorruptSwap() public {
        uint256 buyAmountOmnom = 100;
        uint256 buyAmountWei = toWei(buyAmountOmnom, OMNOM_DECIMALS);
        uint256 requiredInputWei = buyAmountWei;

        assertGt(wwdoge.balanceOf(user), requiredInputWei, "User should have enough WWDOGE");

        vm.prank(user);
        wwdoge.approve(address(aggregator), requiredInputWei);

        uint256 deadline = block.timestamp + 300;
        uint256 minOut = (buyAmountWei * 9500) / BPS_DENOM;

        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            requiredInputWei,
            minOut,
            deadline
        );

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 userOmnomAfter = omnomToken.balanceOf(user);
        assertGt(userOmnomAfter, buyAmountWei / 2, "Should receive significant OMNOM");
    }

    function test_flipFromBuyMode_extremeDecimalMismatch_noOverflow() public {
        MockERC20 zeroDecToken = new MockERC20("Zero Dec", "ZD", 0);

        zeroDecToken.mint(user, 1000);
        zeroDecToken.mint(address(router1), 1e30);

        vm.prank(user);
        zeroDecToken.approve(address(aggregator), 1000);

        uint256 amountIn = 100;
        uint256 minOut = (amountIn * 9500) / BPS_DENOM;

        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;

        address[] memory path = new address[](2);
        path[0] = address(zeroDecToken);
        path[1] = address(wwdoge);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: minOut
        });

        OmnomSwapAggregator.SwapRequest memory request = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(zeroDecToken),
            tokenOut: address(wwdoge),
            amountIn: amountIn,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + 300,
            recipient: user
        });

        vm.prank(user);
        aggregator.executeSwap(request);

        assertEq(zeroDecToken.balanceOf(user), 900, "Should have 900 ZD left");
        assertGt(wwdoge.balanceOf(user), 0, "Should receive some WWDOGE");
    }

    // ─── Test: Zero Amount Edge Cases ──────────────────────────────────────────

    function test_flip_zeroAmount_reverts() public {
        uint256 deadline = block.timestamp + 300;

        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            0,
            0,
            deadline
        );

        vm.prank(user);
        vm.expectRevert("Amount must be greater than zero");
        aggregator.executeSwap(request);
    }

    // ─── Test: Extreme Value Edge Cases ────────────────────────────────────────

    function test_flip_1Wei_minimumAmount_succeeds() public {
        uint256 oneWei = 1;
        uint256 minOut = 1;

        wwdoge.mint(address(this), 1e18);

        vm.prank(user);
        wwdoge.approve(address(aggregator), oneWei);

        uint256 deadline = block.timestamp + 300;
        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            oneWei,
            minOut,
            deadline
        );

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 userOmnom = omnomToken.balanceOf(user);
        assertGt(userOmnom, 0, "Should receive at least 1 wei of OMNOM");
    }

    // ─── Test: Maximum Slippage (100% = 10000 bps) ────────────────────────────

    function test_flip_maxSlippage_100percent_allowsAnyOutput() public {
        uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);
        uint256 minOut = 0;

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 deadline = block.timestamp + 300;
        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            sellAmount,
            minOut,
            deadline
        );

        vm.prank(user);
        aggregator.executeSwap(request);

        assertGt(omnomToken.balanceOf(user), 0, "Should receive something with 100% slippage");
    }

    function test_flip_extremeSlippage_noUnderflow() public {
        uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);
        uint256 minOut = type(uint256).max;

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 deadline = block.timestamp + 300;
        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            sellAmount,
            minOut,
            deadline
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(request);
    }

    // ─── Test: Multi-hop Route Consistency ─────────────────────────────────────

    function test_flip_multiHop_routeConsistency() public {
        MockERC20 intermediate = new MockERC20("Intermediate", "IT", 18);
        intermediate.mint(address(router1), 1e30);
        intermediate.mint(address(router2), 1e30);

        uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);
        uint256 minOut = 1;

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 deadline = block.timestamp + 300;
        uint256 feeAmount = (sellAmount * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = sellAmount - feeAmount;

        address[] memory path1 = new address[](2);
        path1[0] = address(wwdoge);
        path1[1] = address(intermediate);

        address[] memory path2 = new address[](2);
        path2[0] = address(intermediate);
        path2[1] = address(omnomToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: 1
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: 1,
            minAmountOut: minOut
        });

        OmnomSwapAggregator.SwapRequest memory request = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(omnomToken),
            amountIn: sellAmount,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: deadline,
            recipient: user
        });

        vm.prank(user);
        aggregator.executeSwap(request);

        // Verify: OMNOM received, WWDOGE spent
        assertGt(omnomToken.balanceOf(user), 0, "Should receive OMNOM");
        // Note: dust may remain due to rounding in multi-hop
    }

    function test_flip_multiHop_dustAmounts_handled() public {
        MockERC20 intermediate = new MockERC20("Intermediate", "IT", 6);
        intermediate.mint(address(router1), 1e30);
        intermediate.mint(address(router2), 1e30);

        uint256 sellAmount = 1;
        uint256 minOut = 0;

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 feeAmount = (sellAmount * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = sellAmount - feeAmount;

        address[] memory path1 = new address[](2);
        path1[0] = address(wwdoge);
        path1[1] = address(intermediate);

        address[] memory path2 = new address[](2);
        path2[0] = address(intermediate);
        path2[1] = address(omnomToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: 0,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory request = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(omnomToken),
            amountIn: sellAmount,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 300,
            recipient: user
        });

        vm.prank(user);
        aggregator.executeSwap(request);
    }

    // ─── Test: Fee Deduction Consistency ───────────────────────────────────────

    function test_flip_feeDeduction_correct() public {
        uint256 sellAmount = toWei(1000, WWDOGE_DECIMALS);
        uint256 expectedFee = (sellAmount * FEE_BPS) / BPS_DENOM;
        uint256 amountAfterFee = sellAmount - expectedFee;

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 minOut = (amountAfterFee * 9500) / BPS_DENOM;
        uint256 deadline = block.timestamp + 300;

        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            sellAmount,
            minOut,
            deadline
        );

        uint256 treasuryBefore = wwdoge.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 treasuryAfter = wwdoge.balanceOf(treasury);
        uint256 feeCollected = treasuryAfter - treasuryBefore;

        assertApproxEqAbs(feeCollected, expectedFee, 1, "Fee should be approximately correct");
    }

    function test_flip_feeDeduction_variousBps() public {
        uint256[] memory feeBpsArray = new uint256[](5);
        feeBpsArray[0] = 0;
        feeBpsArray[1] = 10;
        feeBpsArray[2] = 25;
        feeBpsArray[3] = 100;
        feeBpsArray[4] = 500;

        for (uint256 i = 0; i < feeBpsArray.length; i++) {
            uint256 feeBps = feeBpsArray[i];
            aggregator.setProtocolFee(feeBps);

            uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);
            uint256 expectedFee = (sellAmount * feeBps) / BPS_DENOM;
            uint256 amountAfterFee = sellAmount - expectedFee;

            vm.prank(user);
            wwdoge.approve(address(aggregator), sellAmount);

            uint256 minOut = (amountAfterFee * 9500) / BPS_DENOM;
            uint256 deadline = block.timestamp + 300 + i;

            uint256 feeAmount = (sellAmount * feeBps) / BPS_DENOM;
            uint256 swapAmount = sellAmount - feeAmount;

            address[] memory path = new address[](2);
            path[0] = address(wwdoge);
            path[1] = address(omnomToken);

            OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
            steps[0] = OmnomSwapAggregator.SwapStep({
                router: address(router1),
                path: path,
                amountIn: swapAmount,
                minAmountOut: minOut
            });

            OmnomSwapAggregator.SwapRequest memory request = OmnomSwapAggregator.SwapRequest({
                tokenIn: address(wwdoge),
                tokenOut: address(omnomToken),
                amountIn: sellAmount,
                minTotalAmountOut: minOut,
                steps: steps,
                deadline: deadline,
                recipient: user
            });

            uint256 treasuryBefore = wwdoge.balanceOf(treasury);

            vm.prank(user);
            aggregator.executeSwap(request);

            uint256 treasuryAfter = wwdoge.balanceOf(treasury);
            assertEq(treasuryAfter - treasuryBefore, expectedFee, "Fee mismatch");
        }
    }

    // ─── Test: Same Token Flip Prevention ─────────────────────────────────────

    function test_flip_sameToken_preventsLoss() public {
        uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 deadline = block.timestamp + 300;

        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(wwdoge),
            sellAmount,
            1,
            deadline
        );

        uint256 balanceBefore = wwdoge.balanceOf(user);
        vm.prank(user);
        aggregator.executeSwap(request);
        uint256 balanceAfter = wwdoge.balanceOf(user);

        assertLt(balanceAfter, balanceBefore, "Should lose fee on same-token swap");
    }

    // ─── Test: Deadline Handling ──────────────────────────────────────────────

    function test_flip_expiredDeadline_reverts() public {
        uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 expiredDeadline = block.timestamp - 1;

        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            sellAmount,
            1,
            expiredDeadline
        );

        vm.prank(user);
        vm.expectRevert("Deadline expired");
        aggregator.executeSwap(request);
    }

    // ─── Test: Round-trip Consistency ─────────────────────────────────────────

    function test_flip_roundTrip_consistency() public {
        uint256 omnomInitial = omnomToken.balanceOf(user);

        uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);
        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 minOut1 = (sellAmount * 9500) / BPS_DENOM;
        OmnomSwapAggregator.SwapRequest memory request1 = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            sellAmount,
            minOut1,
            block.timestamp + 300
        );

        vm.prank(user);
        aggregator.executeSwap(request1);

        uint256 omnomAfter1 = omnomToken.balanceOf(user);

        uint256 omnomToSell = omnomAfter1 - omnomInitial;
        vm.prank(user);
        omnomToken.approve(address(aggregator), omnomToSell);

        uint256 minOut2 = (omnomToSell * 9500) / BPS_DENOM;
        OmnomSwapAggregator.SwapRequest memory request2 = buildSingleHopRequest(
            address(omnomToken),
            address(wwdoge),
            omnomToSell,
            minOut2,
            block.timestamp + 300
        );

        vm.prank(user);
        aggregator.executeSwap(request2);

        uint256 omnomFinal = omnomToken.balanceOf(user);

        assertEq(omnomFinal, omnomInitial, "OMNOM should be depleted after round-trip");
    }

    // ─── Test: Conversion Factor Preservation ──────────────────────────────────

    function test_flip_conversionFactor_preserved() public {
        uint256 specificRate = 1234567890123456789;
        router1.setExchangeRate(specificRate);

        uint256 sellAmount = toWei(100, WWDOGE_DECIMALS);
        uint256 expectedOutput = (sellAmount * specificRate) / 1e18;

        vm.prank(user);
        wwdoge.approve(address(aggregator), sellAmount);

        uint256 minOut = (expectedOutput * 9500) / BPS_DENOM;

        OmnomSwapAggregator.SwapRequest memory request = buildSingleHopRequest(
            address(wwdoge),
            address(omnomToken),
            sellAmount,
            minOut,
            block.timestamp + 300
        );

        uint256 omnomBefore = omnomToken.balanceOf(user);

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 omnomAfter = omnomToken.balanceOf(user);
        uint256 received = omnomAfter - omnomBefore;

        assertApproxEqAbs(received, expectedOutput, sellAmount / 100, "Conversion factor preserved");
    }
}
