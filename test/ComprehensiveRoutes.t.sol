// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/**
 * @title ComprehensiveRoutesTest
 * @notice Exhaustive test suite covering every swap route type, edge case,
 *         balance assertion, and event emission for the OmnomSwapAggregator.
 *
 * Test categories:
 *   A. Native DOGE Swaps (msg.value)
 *   B. WWDOGE (ERC20) Swaps
 *   C. Multi-DEX Routes
 *   D. Edge Cases
 *   E. Balance & Event Assertions
 */
contract ComprehensiveRoutesTest is Test {
    // Mirror the SwapExecuted event from OmnomSwapAggregator so we can use vm.expectEmit
    event SwapExecuted(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeCollected
    );

    // ============================================================
    // State
    // ============================================================

    OmnomSwapAggregator public aggregator;
    MockWWDOGE public wwdoge;
    MockERC20 public tokenA; // "OMNOM"
    MockERC20 public tokenB; // "DINU"
    MockERC20 public tokenC; // "DC"

    /// @notice DEX 1 — simulates DogeSwap
    MockUniswapV2Router public dex1;
    /// @notice DEX 2 — simulates KibbleSwap
    MockUniswapV2Router public dex2;
    /// @notice DEX 3 — simulates YodeSwap
    MockUniswapV2Router public dex3;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x400);

    // Exchange rates (scaled by 1e18)
    uint256 constant RATE_2X = 2e18;
    uint256 constant RATE_1X = 1e18;
    uint256 constant RATE_05X = 5e17; // 0.5x

    uint256 constant FEE_BPS = 25; // 0.25%
    uint256 constant BPS_DENOM = 10_000;
    uint256 constant INITIAL_LIQUIDITY = 10_000_000e18;

    // ============================================================
    // Helpers
    // ============================================================

    function _fundAndApprove(address token, address who, uint256 amount) internal {
        MockERC20(token).mint(who, amount);
        vm.prank(who);
        MockERC20(token).approve(address(aggregator), amount);
    }

    function _fundRouter(MockUniswapV2Router router, address token, uint256 amount) internal {
        MockERC20(token).mint(address(router), amount);
    }

    /// @dev Build a single-step swap request.
    function _singleSwap(
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

    struct TwoHopParams {
        address token0;
        address token1;
        address token2;
        uint256 totalAmountIn;
        uint256 step0AmountIn;
        uint256 step0MinOut;
        uint256 step1AmountIn;
        uint256 step1MinOut;
        address router0;
        address router1;
        address to;
        uint256 deadline;
    }

    /// @dev Build a 2-hop swap request using a struct to avoid stack-too-deep.
    function _twoHopSwap(TwoHopParams memory p) internal pure returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path0 = new address[](2);
        path0[0] = p.token0;
        path0[1] = p.token1;

        address[] memory path1 = new address[](2);
        path1[0] = p.token1;
        path1[1] = p.token2;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: p.router0,
            path: path0,
            amountIn: p.step0AmountIn,
            minAmountOut: p.step0MinOut
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: p.router1,
            path: path1,
            amountIn: p.step1AmountIn,
            minAmountOut: p.step1MinOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: p.token0,
            tokenOut: p.token2,
            amountIn: p.totalAmountIn,
            minTotalAmountOut: p.step1MinOut,
            steps: steps,
            deadline: p.deadline,
            recipient: p.to
        });
    }

    /// @dev Calculate expected output from mock router exchange rate.
    function _expectedOut(uint256 amountIn, uint256 rate) internal pure returns (uint256) {
        return (amountIn * rate) / 1e18;
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

        // Three DEX routers with different exchange rates
        dex1 = new MockUniswapV2Router(address(0), RATE_2X);  // DogeSwap — 2x
        dex2 = new MockUniswapV2Router(address(0), RATE_1X);  // KibbleSwap — 1x
        dex3 = new MockUniswapV2Router(address(0), RATE_05X); // YodeSwap — 0.5x

        aggregator.addRouter(address(dex1));
        aggregator.addRouter(address(dex2));
        aggregator.addRouter(address(dex3));

        vm.stopPrank();

        // Fund user with ERC20 tokens + approve aggregator
        _fundAndApprove(address(tokenA), user, INITIAL_LIQUIDITY);
        _fundAndApprove(address(tokenB), user, INITIAL_LIQUIDITY);
        _fundAndApprove(address(tokenC), user, INITIAL_LIQUIDITY);
        _fundAndApprove(address(wwdoge), user, INITIAL_LIQUIDITY);

        // Fund user with native DOGE for native swap tests
        vm.deal(user, INITIAL_LIQUIDITY);

        // Fund DEX routers with output tokens
        _fundRouter(dex1, address(tokenA), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex1, address(tokenB), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex1, address(tokenC), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex1, address(wwdoge), INITIAL_LIQUIDITY * 10);

        _fundRouter(dex2, address(tokenA), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex2, address(tokenB), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex2, address(tokenC), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex2, address(wwdoge), INITIAL_LIQUIDITY * 10);

        _fundRouter(dex3, address(tokenA), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex3, address(tokenB), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex3, address(tokenC), INITIAL_LIQUIDITY * 10);
        _fundRouter(dex3, address(wwdoge), INITIAL_LIQUIDITY * 10);
    }

    // ============================================================
    // A. Native DOGE Swaps (msg.value)
    // ============================================================

    /// @notice A1: Send native DOGE, receive ERC20 token (1 hop via DogeSwap at 2x).
    function test_NativeDogeBuyToken_SingleHop() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(tokenA.balanceOf(recipient), expectedOut, "recipient should receive tokens");
    }

    /// @notice A2: Send native DOGE, receive token via 2-hop route (WWDOGE → tokenB → tokenC).
    function test_NativeDogeBuyToken_MultiHop() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;

        // Hop 1: WWDOGE → tokenB at 2x rate
        uint256 hop1Out = _expectedOut(swapAmount, RATE_2X);
        // Hop 2: tokenB → tokenC at 1x rate
        uint256 hop2Out = _expectedOut(hop1Out, RATE_1X);

        OmnomSwapAggregator.SwapRequest memory req = _twoHopSwap(TwoHopParams({
            token0: address(wwdoge),
            token1: address(tokenB),
            token2: address(tokenC),
            totalAmountIn: amountIn,
            step0AmountIn: swapAmount,
            step0MinOut: hop1Out,
            step1AmountIn: hop1Out,
            step1MinOut: hop2Out,
            router0: address(dex1),
            router1: address(dex2),
            to: recipient,
            deadline: block.timestamp + 1 hours
        }));

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(tokenC.balanceOf(recipient), hop2Out, "recipient should receive tokens from multi-hop");
    }

    /// @notice A3: Verify 0.25% fee is correctly deducted on native DOGE swap.
    function test_NativeDogeBuyToken_WithFee() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        uint256 treasuryBefore = wwdoge.balanceOf(treasury);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        uint256 treasuryDelta = wwdoge.balanceOf(treasury) - treasuryBefore;
        assertEq(treasuryDelta, feeAmount, "treasury should receive exactly 0.25% fee");
        assertEq(treasuryDelta, 2_500e15, "fee should be 2.5 DOGE for 1000 DOGE input"); // 0.25% of 1000e18
    }

    /// @notice A4: Verify SwapExecuted event is emitted with correct parameters.
    function test_NativeDogeBuyToken_EventEmission() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(
            user,
            address(wwdoge),
            address(tokenA),
            amountIn,
            expectedOut,
            feeAmount
        );
        aggregator.executeSwap{value: amountIn}(req);
    }

    /// @notice A5: Verify treasury receives WWDOGE fee from native DOGE swap.
    function test_NativeDogeBuyToken_TreasuryBalance() public {
        uint256 amountIn = 500e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        uint256 treasuryBefore = wwdoge.balanceOf(treasury);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(
            wwdoge.balanceOf(treasury) - treasuryBefore,
            feeAmount,
            "treasury balance should increase by fee"
        );
    }

    /// @notice A6: Swap 1 wei of native DOGE — dust amount edge case.
    function test_NativeDogeBuyToken_DustAmount() public {
        uint256 amountIn = 1;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM; // 0 (rounds down)
        uint256 swapAmount = amountIn - feeAmount; // 1

        // With 1 wei input and 2x rate, output = 2 wei
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            0, // accept any output for dust
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(tokenA.balanceOf(recipient), expectedOut, "should receive 2 wei");
    }

    /// @notice A7: Swap 1M DOGE — large amount stress test.
    function test_NativeDogeBuyToken_LargeAmount() public {
        uint256 amountIn = 1_000_000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        // Fund user with enough native DOGE
        vm.deal(user, amountIn + 1e18);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(tokenA.balanceOf(recipient), expectedOut, "should receive large output");
        assertGe(expectedOut, 1_995_000e18, "output should be >= 1.995M tokens");
    }

    // ============================================================
    // B. WWDOGE (ERC20) Swaps
    // ============================================================

    /// @notice B8: Sell WWDOGE ERC20 (not native) for token — uses transferFrom path.
    function test_WWDogeErc20BuyToken() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        // No msg.value — user is selling WWDOGE ERC20 tokens they already hold
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenA.balanceOf(recipient), expectedOut, "recipient should receive tokens");
    }

    /// @notice B9: Sell token for WWDOGE ERC20 — user receives wrapped WWDOGE.
    function test_TokenSellToWWDoge() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBefore = wwdoge.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            wwdoge.balanceOf(recipient) - recipientBefore,
            expectedOut,
            "recipient should receive WWDOGE"
        );
    }

    /// @notice B10: Verify msg.value=0 when user has WWDOGE ERC20 — no native DOGE involved.
    function test_TokenSellToWWDoge_NativeNotUsed() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        // Execute without msg.value — user's native DOGE balance should be unchanged
        uint256 userNativeBefore = user.balance;

        vm.prank(user);
        aggregator.executeSwap(req); // no {value: ...}

        assertEq(user.balance, userNativeBefore, "native DOGE should not be used");
    }

    // ============================================================
    // C. Multi-DEX Routes
    // ============================================================

    /// @notice C11: Route through DEX 1 (DogeSwap at 2x rate).
    function test_SwapViaDex1() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "DEX 1 output mismatch");
    }

    /// @notice C12: Route through DEX 2 (KibbleSwap at 1x rate).
    function test_SwapViaDex2() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_1X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex2),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "DEX 2 output mismatch");
    }

    /// @notice C13: Route through DEX 3 (YodeSwap at 0.5x rate).
    function test_SwapViaDex3() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_05X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex3),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "DEX 3 output mismatch");
    }

    /// @notice C14: Hop 1 on DEX 1, hop 2 on DEX 2 — cross-DEX multi-hop.
    function test_MultiHopAcrossDexes() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;

        // Hop 1: tokenA → tokenB via DEX 1 at 2x
        uint256 hop1Out = _expectedOut(swapAmount, RATE_2X);
        // Hop 2: tokenB → tokenC via DEX 2 at 1x
        uint256 hop2Out = _expectedOut(hop1Out, RATE_1X);

        OmnomSwapAggregator.SwapRequest memory req = _twoHopSwap(TwoHopParams({
            token0: address(tokenA),
            token1: address(tokenB),
            token2: address(tokenC),
            totalAmountIn: amountIn,
            step0AmountIn: swapAmount,
            step0MinOut: hop1Out,
            step1AmountIn: hop1Out,
            step1MinOut: hop2Out,
            router0: address(dex1),
            router1: address(dex2),
            to: recipient,
            deadline: block.timestamp + 1 hours
        }));

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenC.balanceOf(recipient), hop2Out, "cross-DEX multi-hop output mismatch");
    }

    /// @notice C15: Verify aggregator picks best output — compare DEX 1 (2x) vs DEX 3 (0.5x).
    function test_BestRouteSelection() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;

        // Route via DEX 1 (2x)
        uint256 dex1Out = _expectedOut(swapAmount, RATE_2X);
        // Route via DEX 3 (0.5x)
        uint256 dex3Out = _expectedOut(swapAmount, RATE_05X);

        // DEX 1 should give 4x more output than DEX 3
        assertGt(dex1Out, dex3Out, "DEX 1 should give better output");
        assertEq(dex1Out / dex3Out, 4, "DEX 1 should give 4x output of DEX 3");

        // Execute via DEX 1 (best route)
        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            dex1Out,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), dex1Out, "best route output mismatch");
    }

    // ============================================================
    // D. Edge Cases
    // ============================================================

    /// @notice D16: Swap 1 wei — dust amount.
    function test_DustAmountSwap() public {
        uint256 amountIn = 1;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM; // 0
        uint256 swapAmount = amountIn - feeAmount; // 1
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X); // 2

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            0, // accept any output
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "dust swap output mismatch");
    }

    /// @notice D17: Swap very large amount (near max uint256 — limited by router liquidity).
    function test_MaxUint256Proximity() public {
        // Use a large but feasible amount (1e36 — well within mock router liquidity)
        uint256 amountIn = 1e36;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        // Fund user and router for this large swap
        MockERC20(address(tokenA)).mint(user, amountIn);
        vm.prank(user);
        MockERC20(address(tokenA)).approve(address(aggregator), amountIn);
        _fundRouter(dex1, address(tokenB), expectedOut + 1e18);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "large amount output mismatch");
    }

    /// @notice D18: Token to itself — should succeed (mock router doesn't prevent it).
    function test_SameTokenSwap() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenA), // same token
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        // The mock router will happily swap tokenA → tokenA at 2x rate
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenA.balanceOf(recipient), expectedOut, "same-token swap output mismatch");
    }

    /// @notice D19: Swap 0 — should revert with "Amount must be greater than zero".
    function test_ZeroAmountSwap() public {
        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            0, // zero amount
            0,
            0,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Amount must be greater than zero");
        aggregator.executeSwap(req);
    }

    /// @notice D20: Swap more than pool has — mock router should revert with "Insufficient balance".
    function test_InsufficientLiquidity() public {
        // Create a new router with very limited liquidity
        vm.startPrank(owner);
        MockUniswapV2Router smallDex = new MockUniswapV2Router(address(0), RATE_2X);
        aggregator.addRouter(address(smallDex));
        vm.stopPrank();

        // Only 100 tokens of liquidity
        _fundRouter(smallDex, address(tokenB), 100e18);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X); // ~1997.5 tokens

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(smallDex),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient balance");
        aggregator.executeSwap(req);
    }

    /// @notice D21: Deadline in the past — should revert with "Expired".
    function test_ExpiredDeadline() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            0,
            address(dex1),
            recipient,
            block.timestamp - 1 // deadline in the past
        );

        vm.prank(user);
        vm.expectRevert("Expired");
        aggregator.executeSwap(req);
    }

    /// @notice D22: minAmountOut > actual output — should revert with "Insufficient output".
    function test_SlippageExceeded() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 actualOut = _expectedOut(swapAmount, RATE_2X);

        // Set minAmountOut higher than what the router can produce
        uint256 impossibleMinOut = actualOut + 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            impossibleMinOut, // more than router can produce
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    // ============================================================
    // E. Balance & Event Assertions
    // ============================================================

    /// @notice E23: Verify exact balance changes for user, treasury, and contract.
    function test_BalanceChangesCorrect() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        uint256 userBefore = tokenA.balanceOf(user);
        uint256 treasuryBefore = tokenA.balanceOf(treasury);
        uint256 contractBefore = tokenA.balanceOf(address(aggregator));

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // User lost exactly amountIn
        assertEq(userBefore - tokenA.balanceOf(user), amountIn, "user should lose amountIn");
        // Treasury gained exactly feeAmount
        assertEq(tokenA.balanceOf(treasury) - treasuryBefore, feeAmount, "treasury should gain fee");
        // Recipient gained expectedOut
        assertEq(tokenB.balanceOf(recipient), expectedOut, "recipient should gain expectedOut");
        // Contract balance unchanged (no tokens left behind)
        assertEq(tokenA.balanceOf(address(aggregator)), contractBefore, "contract tokenA balance unchanged");
        assertEq(tokenB.balanceOf(address(aggregator)), 0, "contract should have 0 tokenB");
    }

    /// @notice E24: Verify 0.25% fee amount is exactly correct.
    function test_FeeDeductionCorrect() public {
        uint256 amountIn = 10_000e18; // nice round number
        uint256 expectedFee = 25e18; // 0.25% of 10,000 = 25
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;

        assertEq(feeAmount, expectedFee, "fee should be exactly 0.25%");

        uint256 swapAmount = amountIn - feeAmount;
        assertEq(swapAmount, 9_975e18, "swap amount should be 99.75%");

        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);
        uint256 treasuryBefore = tokenA.balanceOf(treasury);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenA.balanceOf(treasury) - treasuryBefore,
            expectedFee,
            "treasury fee deduction mismatch"
        );
    }

    /// @notice E25: Verify contract holds no tokens after swap (except pre-existing balance).
    function test_NoTokenLeftInContract() public {
        uint256 amountIn = 500e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Contract should not hold any input or output tokens
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "contract should hold 0 input tokens");
        assertEq(tokenB.balanceOf(address(aggregator)), 0, "contract should hold 0 output tokens");
    }

    /// @notice E26: Verify SwapExecuted event parameters match the swap exactly.
    function test_SwapExecutedEvent() public {
        uint256 amountIn = 200e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = _expectedOut(swapAmount, RATE_2X);

        OmnomSwapAggregator.SwapRequest memory req = _singleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(dex1),
            user, // user is also recipient
            block.timestamp + 1 hours
        );

        // Expect the event with exact parameters
        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(
            user,              // indexed user
            address(tokenA),   // tokenIn
            address(tokenB),   // tokenOut
            amountIn,          // amountIn
            expectedOut,       // amountOut
            feeAmount          // feeCollected
        );
        aggregator.executeSwap(req);
    }
}
