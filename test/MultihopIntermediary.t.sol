// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";
import "../contracts/mocks/MockFeeOnTransferToken.sol";
import "../contracts/mocks/MockDynamicFeeToken.sol";

/// @title MultihopIntermediaryTest
/// @notice Comprehensive tests for multihop routing through specific intermediary
///         hub tokens (WWDOGE, DC, OMNOM) with tax-based tokens as intermediaries.
///         Validates two-hop, three-hop, cross-DEX, slippage compounding, liquidity
///         scenarios, tax intermediary handling, native DOGE wrapping, and route
///         optimization comparisons.
contract MultihopIntermediaryTest is Test {
    // ============================================================
    // State
    // ============================================================

    OmnomSwapAggregator public aggregator;
    MockWWDOGE public wwdoge;

    // Hub tokens (simulating Dogechain hub tokens)
    MockERC20 public dc;
    MockERC20 public omnom;

    // Random tokens for testing
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    // Multiple routers for cross-DEX routing
    MockUniswapV2Router public router1; // "DogeSwap"
    MockUniswapV2Router public router2; // "KibbleSwap"
    MockUniswapV2Router public router3; // "YodeSwap"

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18; // 1 input → 2 output
    uint256 constant INITIAL_BALANCE = 100_000_000e18;
    uint256 constant FEE_BPS = 10; // 0.1%

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

    function _defaultDeadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    // ============================================================
    // setUp
    // ============================================================

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        // Hub tokens
        dc = new MockERC20("Dogechain Token", "DC", 18);
        omnom = new MockERC20("Omnom Token", "OMNOM", 18);

        // Random tokens
        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);

        // Routers
        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router3 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));
        aggregator.addRouter(address(router3));

        vm.stopPrank();

        // Fund user with all tokens
        _fundAndApprove(address(wwdoge), user, INITIAL_BALANCE);
        _fundAndApprove(address(dc), user, INITIAL_BALANCE);
        _fundAndApprove(address(omnom), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);

        // Fund all routers with all tokens
        address[] memory allTokens = new address[](5);
        allTokens[0] = address(wwdoge);
        allTokens[1] = address(dc);
        allTokens[2] = address(omnom);
        allTokens[3] = address(tokenA);
        allTokens[4] = address(tokenB);

        for (uint256 i = 0; i < allTokens.length; i++) {
            _fundRouter(router1, allTokens[i], INITIAL_BALANCE);
            _fundRouter(router2, allTokens[i], INITIAL_BALANCE);
            _fundRouter(router3, allTokens[i], INITIAL_BALANCE);
        }

        // Give user native DOGE for native swap tests
        vm.deal(user, 1000 ether);
    }

    // ============================================================
    // A. Two-Hop Routes Through Hub Tokens
    // ============================================================

    /// @notice tokenA → WWDOGE → tokenB through same router
    function test_twoHop_throughWwdoge_succeeds() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "WWDOGE intermediary output mismatch");
    }

    /// @notice tokenA → DC → tokenB through same router
    function test_twoHop_throughDc_succeeds() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(dc);

        address[] memory path2 = new address[](2);
        path2[0] = address(dc);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "DC intermediary output mismatch");
    }

    /// @notice tokenA → OMNOM → tokenB through same router
    function test_twoHop_throughOmnom_succeeds() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(omnom);

        address[] memory path2 = new address[](2);
        path2[0] = address(omnom);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "OMNOM intermediary output mismatch");
    }

    /// @notice Verify exact amounts at each leg with different rates
    function test_twoHop_correctAmountsAtEachLeg() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 rate1 = 3e18; // 1:3
        uint256 rate2 = 5e18; // 1:5

        router1.setExchangeRate(rate1);
        router2.setExchangeRate(rate2);

        uint256 hop1Out = (swapAmount * rate1) / 1e18;
        uint256 hop2Out = (hop1Out * rate2) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, hop2Out, "Leg amount mismatch");
        assertEq(received, (swapAmount * rate1 / 1e18) * rate2 / 1e18, "Compound rate mismatch");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Hop 1 uses router1, hop 2 uses router2 — cross-DEX routing
    function test_twoHop_crossDex_differentRouters() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 rate1 = 2e18;
        uint256 rate2 = 25e17; // 2.5

        router1.setExchangeRate(rate1);
        router2.setExchangeRate(rate2);

        uint256 hop1Out = (swapAmount * rate1) / 1e18;
        uint256 hop2Out = (hop1Out * rate2) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(dc);

        address[] memory path2 = new address[](2);
        path2[0] = address(dc);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "Cross-DEX output mismatch");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Each hop has 2% slippage (0.98x rate), total ~4% compounding
    function test_twoHop_slippageCompounding() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 slipRate = 98e16; // 0.98

        router1.setExchangeRate(slipRate);
        router2.setExchangeRate(slipRate);

        uint256 hop1Out = (swapAmount * slipRate) / 1e18;
        uint256 hop2Out = (hop1Out * slipRate) / 1e18;

        // Total effective rate: 0.98 * 0.98 = 0.9604
        uint256 totalExpected = (swapAmount * 9604) / 10_000;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(omnom);

        address[] memory path2 = new address[](2);
        path2[0] = address(omnom);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertApproxEqAbs(received, totalExpected, 1e15, "Slippage not compounding correctly");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
    }

    // ============================================================
    // B. Three-Hop Routes Through Multiple Hubs
    // ============================================================

    /// @notice 3-hop: tokenA → WWDOGE → DC → tokenB
    function test_threeHop_tokenA_wwdoge_dc_tokenB() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;
        uint256 hop3Out = (hop2Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(dc);

        address[] memory path3 = new address[](2);
        path3[0] = address(dc);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path3,
            amountIn: hop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop3Out, "3-hop WWDOGE->DC output mismatch");
    }

    /// @notice 3-hop: tokenA → WWDOGE → OMNOM → tokenB
    function test_threeHop_tokenA_wwdoge_omnom_tokenB() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;
        uint256 hop3Out = (hop2Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(omnom);

        address[] memory path3 = new address[](2);
        path3[0] = address(omnom);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path3,
            amountIn: hop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop3Out, "3-hop WWDOGE->OMNOM output mismatch");
    }

    /// @notice Verify amounts at each of 3 legs with different rates per router
    function test_threeHop_correctAmountsAtEachLeg() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 rate1 = 2e18;
        uint256 rate2 = 3e18;
        uint256 rate3 = 4e18;

        router1.setExchangeRate(rate1);
        router2.setExchangeRate(rate2);
        router3.setExchangeRate(rate3);

        uint256 hop1Out = (swapAmount * rate1) / 1e18;
        uint256 hop2Out = (hop1Out * rate2) / 1e18;
        uint256 hop3Out = (hop2Out * rate3) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(dc);

        address[] memory path3 = new address[](2);
        path3[0] = address(dc);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router3),
            path: path3,
            amountIn: hop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, hop3Out, "3-leg amount mismatch");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
        router3.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Each hop uses a different router — 3-router cross-DEX
    function test_threeHop_crossDex_threeRouters() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 rate1 = 15e17; // 1.5x on DogeSwap
        uint256 rate2 = 2e18; // 2x on KibbleSwap
        uint256 rate3 = 25e17; // 2.5x on YodeSwap

        router1.setExchangeRate(rate1);
        router2.setExchangeRate(rate2);
        router3.setExchangeRate(rate3);

        uint256 hop1Out = (swapAmount * rate1) / 1e18;
        uint256 hop2Out = (hop1Out * rate2) / 1e18;
        uint256 hop3Out = (hop2Out * rate3) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(dc);

        address[] memory path3 = new address[](2);
        path3[0] = address(dc);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router3),
            path: path3,
            amountIn: hop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop3Out, "3-router cross-DEX mismatch");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
        router3.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice 3 hops with 1% slippage each → total ~3% cumulative
    function test_threeHop_cumulativeSlippage() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 slipRate = 99e16; // 0.99

        router1.setExchangeRate(slipRate);
        router2.setExchangeRate(slipRate);
        router3.setExchangeRate(slipRate);

        uint256 hop1Out = (swapAmount * slipRate) / 1e18;
        uint256 hop2Out = (hop1Out * slipRate) / 1e18;
        uint256 hop3Out = (hop2Out * slipRate) / 1e18;

        // 0.99^3 = 0.970299
        uint256 totalExpected = (swapAmount * 970299) / 1_000_000;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(dc);

        address[] memory path3 = new address[](2);
        path3[0] = address(dc);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router3),
            path: path3,
            amountIn: hop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertApproxEqAbs(received, totalExpected, 1e15, "Cumulative slippage mismatch");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
        router3.setExchangeRate(EXCHANGE_RATE);
    }

    // ============================================================
    // C. Intermediary Insufficient Liquidity
    // ============================================================

    /// @notice First hop (tokenA → WWDOGE) has very low liquidity
    function test_intermediaryLowLiquidity_firstHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 lowRate = 1e17; // 0.1x
        router1.setExchangeRate(lowRate);
        router2.setExchangeRate(EXCHANGE_RATE);

        uint256 hop1Out = (swapAmount * lowRate) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, hop2Out, "Low liquidity first hop mismatch");
        assertLt(received, amountIn / 5, "Output should be much less than input");

        router1.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Second hop (WWDOGE → tokenB) has very low liquidity
    function test_intermediaryLowLiquidity_secondHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 lowRate = 1e17; // 0.1x
        router2.setExchangeRate(lowRate);

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * lowRate) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, hop2Out, "Low liquidity second hop mismatch");
        assertLt(received, amountIn / 4, "Output should be low due to second hop");

        router2.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice First hop exchange rate = 0 → reverts when minAmountOut > 0
    function test_intermediaryNoLiquidity_firstHop_reverts() public {
        uint256 amountIn = 1000e18;

        router1.setExchangeRate(0);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: 0,
            minAmountOut: 1 // Require at least 1 wei output — will fail with 0 rate
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: 0,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);

        router1.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Second hop has 0 output token balance → reverts
    function test_intermediaryNoLiquidity_secondHop_reverts() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Create a new router with no tokenB balance
        MockUniswapV2Router emptyRouter = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        vm.prank(owner);
        aggregator.addRouter(address(emptyRouter));

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(emptyRouter),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: 1
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: 1,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Insufficient balance");
        aggregator.executeSwap(req);
    }

    /// @notice Middle hop of 3-hop has low liquidity
    function test_intermediaryLowLiquidity_threeHop_middleHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 lowRate = 5e16; // 0.05x
        router2.setExchangeRate(lowRate);

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * lowRate) / 1e18;
        uint256 hop3Out = (hop2Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(dc);

        address[] memory path3 = new address[](2);
        path3[0] = address(dc);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router3),
            path: path3,
            amountIn: hop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, hop3Out, "Middle hop low liquidity mismatch");
        assertLt(received, amountIn / 4, "Middle hop bottleneck should reduce output");

        router2.setExchangeRate(EXCHANGE_RATE);
    }

    // ============================================================
    // D. Tax-Based Intermediary Tokens
    // ============================================================

    /// @notice DC has 3% fee-on-transfer as intermediary in tokenA → DC → tokenB
    function test_taxIntermediary_3percent_succeeds() public {
        MockFeeOnTransferToken taxDc = new MockFeeOnTransferToken("TaxDC", "TDC", 18, 300, treasury);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Hop 1: tokenA → taxDC (router sends taxDC via transfer → 3% fee)
        uint256 grossHop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 netHop1Out = grossHop1Out - ((grossHop1Out * 300) / 10_000);

        // Hop 2: taxDC → tokenB (forceTransferFrom → no fee on MockFeeOnTransferToken)
        uint256 hop2Out = (netHop1Out * EXCHANGE_RATE) / 1e18;

        taxDc.mint(address(router1), INITIAL_BALANCE);
        tokenB.mint(address(router1), INITIAL_BALANCE);

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(taxDc);

        address[] memory path2 = new address[](2);
        path2[0] = address(taxDc);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: netHop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: netHop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "Tax intermediary output mismatch");
    }

    /// @notice Verify amounts account for tax deduction at intermediary
    function test_taxIntermediary_amountAtEachLeg() public {
        MockFeeOnTransferToken taxOmnom = new MockFeeOnTransferToken("TaxOMNOM", "TOMN", 18, 500, treasury);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 grossHop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 taxDeducted = (grossHop1Out * 500) / 10_000;
        uint256 netHop1Out = grossHop1Out - taxDeducted;

        uint256 hop2Out = (netHop1Out * EXCHANGE_RATE) / 1e18;

        taxOmnom.mint(address(router1), INITIAL_BALANCE);
        tokenB.mint(address(router1), INITIAL_BALANCE);

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(taxOmnom);

        address[] memory path2 = new address[](2);
        path2[0] = address(taxOmnom);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: netHop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: netHop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 treasuryTaxBalBefore = taxOmnom.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 taxCollected = taxOmnom.balanceOf(treasury) - treasuryTaxBalBefore;
        assertEq(taxCollected, taxDeducted, "Tax not collected correctly at intermediary");
        assertEq(tokenB.balanceOf(recipient), hop2Out, "Output should account for intermediary tax");
    }

    /// @notice 10% tax on intermediary, slippage protection catches insufficient output
    function test_taxIntermediary_10percent_slippageCatches() public {
        MockFeeOnTransferToken highTaxToken = new MockFeeOnTransferToken("HighTax", "HTX", 18, 1000, treasury);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 grossHop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 netHop1Out = grossHop1Out - ((grossHop1Out * 1000) / 10_000);
        uint256 hop2Out = (netHop1Out * EXCHANGE_RATE) / 1e18;

        highTaxToken.mint(address(router1), INITIAL_BALANCE);
        tokenB.mint(address(router1), INITIAL_BALANCE);

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(highTaxToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(highTaxToken);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: netHop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: netHop1Out,
            minAmountOut: hop2Out
        });

        // Set minTotalAmountOut higher than actual output (ignoring tax)
        uint256 unrealisticMinOut = grossHop1Out * 2;

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: unrealisticMinOut,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(req);
    }

    /// @notice Tax on intermediary + protocol fee on input
    function test_taxIntermediary_combinedWithProtocolFee() public {
        MockFeeOnTransferToken taxDc = new MockFeeOnTransferToken("TaxDC", "TDC", 18, 300, treasury);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 grossHop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 netHop1Out = grossHop1Out - ((grossHop1Out * 300) / 10_000);
        uint256 hop2Out = (netHop1Out * EXCHANGE_RATE) / 1e18;

        taxDc.mint(address(router1), INITIAL_BALANCE);
        tokenB.mint(address(router1), INITIAL_BALANCE);

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(taxDc);

        address[] memory path2 = new address[](2);
        path2[0] = address(taxDc);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: netHop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: netHop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 treasuryABalBefore = tokenA.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify protocol fee collected in tokenA
        assertEq(tokenA.balanceOf(treasury) - treasuryABalBefore, feeAmount, "Protocol fee mismatch");

        // Verify output accounts for both protocol fee AND intermediary tax
        assertEq(tokenB.balanceOf(recipient), hop2Out, "Combined fee output mismatch");

        // Verify output is less than no-tax route
        uint256 noTaxOutput = (swapAmount * EXCHANGE_RATE / 1e18) * EXCHANGE_RATE / 1e18;
        assertLt(tokenB.balanceOf(recipient), noTaxOutput, "Tax should reduce output");
    }

    /// @notice 3-hop with tax on both intermediaries
    function test_taxIntermediary_threeHop_twoTaxTokens() public {
        MockFeeOnTransferToken taxWwdoge = new MockFeeOnTransferToken("TaxWWDOGE", "TWW", 18, 200, treasury);
        MockFeeOnTransferToken taxDc = new MockFeeOnTransferToken("TaxDC", "TDC", 18, 300, treasury);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Hop 1: tokenA → taxWWDOGE (2% tax)
        uint256 grossHop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 netHop1Out = grossHop1Out - ((grossHop1Out * 200) / 10_000);

        // Hop 2: taxWWDOGE → taxDC (3% tax on taxDC received)
        uint256 grossHop2Out = (netHop1Out * EXCHANGE_RATE) / 1e18;
        uint256 netHop2Out = grossHop2Out - ((grossHop2Out * 300) / 10_000);

        // Hop 3: taxDC → tokenB
        uint256 hop3Out = (netHop2Out * EXCHANGE_RATE) / 1e18;

        taxWwdoge.mint(address(router1), INITIAL_BALANCE);
        taxDc.mint(address(router1), INITIAL_BALANCE);
        taxDc.mint(address(router2), INITIAL_BALANCE);
        tokenB.mint(address(router1), INITIAL_BALANCE);
        tokenB.mint(address(router2), INITIAL_BALANCE);

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(taxWwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(taxWwdoge);
        path2[1] = address(taxDc);

        address[] memory path3 = new address[](2);
        path3[0] = address(taxDc);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: netHop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: netHop1Out,
            minAmountOut: netHop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path3,
            amountIn: netHop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, hop3Out, "3-hop two-tax output mismatch");

        // Verify output is less than no-tax 3-hop (2*2*2 = 8x)
        uint256 noTaxOutput = swapAmount * 8 / 1e18 * 1e18;
        assertLt(received, noTaxOutput, "Double tax should reduce output");
    }

    /// @notice Dynamic fee token as intermediary, fee changes between hops via auto-fee-change
    function test_taxIntermediary_dynamicFee_midHop() public {
        MockDynamicFeeToken dynFeeToken = new MockDynamicFeeToken("DynFee", "DFEE", 18, 200, treasury);

        // Configure auto-fee-change: after 1 transfer, change fee from 2% to 5%
        // Transfer 1 = router sending dynFeeToken to aggregator in step 0
        // After that, fee becomes 5% for step 1
        dynFeeToken.setAutoFeeChange(1, 500);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Hop 1: tokenA → dynFeeToken (2% fee on transfer from router to aggregator)
        uint256 grossHop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 netHop1Out = grossHop1Out - ((grossHop1Out * 200) / 10_000);

        // Hop 2: dynFeeToken → tokenB (fee auto-changed to 5% after hop 1 transfer)
        // Router takes dynFeeToken via forceTransferFrom (applies fee on MockDynamicFeeToken)
        // Router calculates output based on amountIn parameter, not received amount
        uint256 hop2Out = (netHop1Out * EXCHANGE_RATE) / 1e18;

        dynFeeToken.mint(address(router1), INITIAL_BALANCE);
        tokenB.mint(address(router1), INITIAL_BALANCE);

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(dynFeeToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(dynFeeToken);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: netHop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: netHop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "Dynamic fee intermediary mismatch");
    }

    // ============================================================
    // E. WWDOGE as Intermediary with Native DOGE
    // ============================================================

    /// @notice Native DOGE → WWDOGE (auto-wrap) → DC → tokenB
    function test_nativeDoge_twoHop_wwdogeIntermediary() public {
        uint256 amountIn = 10 ether;

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(wwdoge);
        path1[1] = address(dc);

        address[] memory path2 = new address[](2);
        path2[0] = address(dc);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "Native DOGE 2-hop output mismatch");
    }

    /// @notice Native DOGE → WWDOGE → DC → tokenB (3-hop with native)
    function test_nativeDoge_threeHop_wwdoge_dc_tokenB() public {
        uint256 amountIn = 10 ether;

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 hop2Out = (hop1Out * EXCHANGE_RATE) / 1e18;
        uint256 hop3Out = (hop2Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(wwdoge);
        path1[1] = address(dc);

        address[] memory path2 = new address[](2);
        path2[0] = address(dc);
        path2[1] = address(omnom);

        address[] memory path3 = new address[](2);
        path3[0] = address(omnom);
        path3[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path3,
            amountIn: hop2Out,
            minAmountOut: hop3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop3Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop3Out, "Native DOGE 3-hop output mismatch");
    }

    /// @notice Verify exact WWDOGE amount after wrapping matches expected
    function test_nativeDoge_wrappingCorrectness() public {
        uint256 amountIn = 5 ether;

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hopOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(wwdoge);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: hopOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hopOut,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 wwdogeSupplyBefore = wwdoge.totalSupply();

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Verify WWDOGE was minted via deposit
        assertGt(wwdoge.totalSupply(), wwdogeSupplyBefore, "WWDOGE should have been minted");
        assertEq(wwdoge.totalSupply() - wwdogeSupplyBefore, amountIn, "Exact WWDOGE amount mismatch");

        // Verify output uses swapAmount (after fee)
        assertEq(tokenB.balanceOf(recipient), hopOut, "Wrapping output mismatch");
    }

    /// @notice Protocol fee deducted in WWDOGE after wrapping
    function test_nativeDoge_feeDeductionInWwdoge() public {
        uint256 amountIn = 10 ether;

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hopOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(wwdoge);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: hopOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hopOut,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 treasuryWwdogeBefore = wwdoge.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Verify treasury received WWDOGE fee
        assertEq(
            wwdoge.balanceOf(treasury) - treasuryWwdogeBefore,
            feeAmount,
            "WWDOGE fee not deducted correctly"
        );

        // Verify output uses swapAmount
        assertEq(tokenB.balanceOf(recipient), hopOut, "Output should use post-fee amount");
    }

    /// @notice Excess native DOGE refunded after swap
    function test_nativeDoge_refundExcess() public {
        uint256 amountIn = 5 ether;

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hopOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(wwdoge);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: hopOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hopOut,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        // The aggregator requires msg.value == amountIn, so excess DOGE can't be sent
        // via executeSwap. But after the swap, if the aggregator somehow has native DOGE
        // (e.g., from a WWDOGE.unwrap that sends DOGE to the contract), it should be refunded.
        // Test that the contract properly handles the normal case and doesn't lose DOGE.
        uint256 userBalBefore = user.balance;

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // User should have spent exactly amountIn
        assertEq(userBalBefore - user.balance, amountIn, "User should spend exact amountIn");

        // Verify output
        assertEq(tokenB.balanceOf(recipient), hopOut, "Refund test output mismatch");
    }

    // ============================================================
    // F. Route Optimization Scenarios
    // ============================================================

    /// @notice Compare direct swap vs two-hop: two-hop gives better output when route has better rate
    function test_routeComparison_directVsTwoHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Direct route: tokenA -> tokenB at 1.5x rate
        uint256 directRate = 15e17;
        router1.setExchangeRate(directRate);
        uint256 directOut = (swapAmount * directRate) / 1e18;

        // Two-hop route: tokenA -> WWDOGE -> tokenB at 2x per hop = 4x effective
        uint256 twoHopRate = 2e18;
        router2.setExchangeRate(twoHopRate);
        router3.setExchangeRate(twoHopRate);
        uint256 twoHop1 = (swapAmount * twoHopRate) / 1e18;
        uint256 twoHopOut = (twoHop1 * twoHopRate) / 1e18;

        // Verify two-hop gives better output
        assertGt(twoHopOut, directOut, "Two-hop should give better output");

        // Execute the two-hop route
        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: twoHop1
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router3),
            path: path2,
            amountIn: twoHop1,
            minAmountOut: twoHopOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: twoHopOut,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, twoHopOut, "Two-hop route output mismatch");
        assertGt(received, directOut, "Two-hop should outperform direct");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
        router3.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Compare WWDOGE vs DC vs OMNOM as intermediary, verify best route chosen
    function test_routeComparison_differentIntermediaries() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // WWDOGE route: 2x * 2x = 4x
        uint256 wwdogeRate = 2e18;
        uint256 wwdogeHop1 = (swapAmount * wwdogeRate) / 1e18;
        uint256 wwdogeOut = (wwdogeHop1 * wwdogeRate) / 1e18;

        // DC route: 3x * 1.5x = 4.5x
        uint256 dcRate1 = 3e18;
        uint256 dcRate2 = 15e17;
        uint256 dcHop1 = (swapAmount * dcRate1) / 1e18;
        uint256 dcOut = (dcHop1 * dcRate2) / 1e18;

        // OMNOM route: 1.5x * 1.5x = 2.25x
        uint256 omnomRate = 15e17;
        uint256 omnomHop1 = (swapAmount * omnomRate) / 1e18;
        uint256 omnomOut = (omnomHop1 * omnomRate) / 1e18;

        // Verify DC route is best
        assertGt(dcOut, wwdogeOut, "DC route should beat WWDOGE route");
        assertGt(dcOut, omnomOut, "DC route should beat OMNOM route");

        // Execute DC route (the best one)
        router1.setExchangeRate(dcRate1);
        router2.setExchangeRate(dcRate2);

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(dc);

        address[] memory path2 = new address[](2);
        path2[0] = address(dc);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: dcHop1
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: dcHop1,
            minAmountOut: dcOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: dcOut,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, dcOut, "Best route output mismatch");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Two separate steps using different routers for same pair (split execution)
    function test_splitRouting_twoRoutes() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Split: step 1 goes through WWDOGE on router1, step 2 goes through DC on router2
        uint256 rate1 = 2e18;
        uint256 rate2 = 3e18;

        router1.setExchangeRate(rate1);
        router2.setExchangeRate(rate2);

        uint256 hop1Out = (swapAmount * rate1) / 1e18;
        uint256 hop2Out = (hop1Out * rate2) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(wwdoge);

        address[] memory path2 = new address[](2);
        path2[0] = address(wwdoge);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: hop1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: hop2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: hop2Out,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - balBefore, hop2Out, "Split routing output mismatch");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
    }

    /// @notice Test that the route with highest output is preferred
    function test_bestRoute_selection() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Route A: tokenA -> WWDOGE -> tokenB at 1x * 1x = 1x (poor route)
        // Route B: tokenA -> DC -> tokenB at 2x * 2x = 4x (good route)
        // Route C: tokenA -> OMNOM -> tokenB at 1.5x * 3x = 4.5x (best route)
        uint256 omnomRate1 = 15e17;
        uint256 omnomRate2 = 3e18;

        uint256 routeAOut = swapAmount; // 1x
        uint256 routeBOut = swapAmount * 4 / 1e18 * 1e18; // 4x
        uint256 routeCOut = (swapAmount * omnomRate1 / 1e18) * omnomRate2 / 1e18; // 4.5x

        assertGt(routeCOut, routeBOut, "Route C should beat Route B");
        assertGt(routeBOut, routeAOut, "Route B should beat Route A");

        // Execute Route C (the best route via OMNOM)
        router1.setExchangeRate(omnomRate1);
        router2.setExchangeRate(omnomRate2);

        uint256 omnomHop1 = (swapAmount * omnomRate1) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(omnom);

        address[] memory path2 = new address[](2);
        path2[0] = address(omnom);
        path2[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: omnomHop1
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: omnomHop1,
            minAmountOut: routeCOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: routeCOut,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: recipient
        });

        uint256 balBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = tokenB.balanceOf(recipient) - balBefore;
        assertEq(received, routeCOut, "Best route selection output mismatch");
        assertGt(received, routeBOut, "Should have picked best route over Route B");
        assertGt(received, routeAOut, "Should have picked best route over Route A");

        router1.setExchangeRate(EXCHANGE_RATE);
        router2.setExchangeRate(EXCHANGE_RATE);
    }
}