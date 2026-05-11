// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

// ============================================================
// ForceFeeder — force-sends ETH to a target via selfdestruct
// ============================================================
contract ForceFeeder {
    constructor() payable {}

    function feed(address payable target) external {
        selfdestruct(target);
    }
}

/// @title WrappedNativeMultihopTest
/// @notice Tests for WWDOGE (wrapped native DOGE) within multihop swap paths.
///         Covers WWDOGE as first hop, intermediate hop, last hop, round-trip
///         native paths, and edge cases for value validation and refunds.
contract WrappedNativeMultihopTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockUniswapV2Router public router1;
    MockUniswapV2Router public router2;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18; // 1 input → 2 output
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant FEE_BPS = 25; // 0.25%

    // ============================================================
    // Helpers
    // ============================================================

    function _fundRouter(address routerAddr, address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(routerAddr, amount);
    }

    function _fundRouterWWDOGE(address routerAddr, uint256 amount) internal {
        MockERC20(address(wwdoge)).mint(routerAddr, amount);
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

    function _buildTwoHopSwap(
        address tokenIn,
        address midToken,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 step0AmountIn,
        uint256 step0MinOut,
        uint256 step1AmountIn,
        uint256 step1MinOut,
        address router0,
        address router1Addr,
        address to,
        uint256 deadline
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path0 = new address[](2);
        path0[0] = tokenIn;
        path0[1] = midToken;

        address[] memory path1 = new address[](2);
        path1[0] = midToken;
        path1[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: router0,
            path: path0,
            amountIn: step0AmountIn,
            minAmountOut: step0MinOut
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: router1Addr,
            path: path1,
            amountIn: step1AmountIn,
            minAmountOut: step1MinOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: totalAmountIn,
            minTotalAmountOut: step1MinOut,
            steps: steps,
            deadline: deadline,
            recipient: to
        });
    }

    function _buildThreeHopSwap(
        address tokenIn,
        address mid1,
        address mid2,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 step0AmountIn,
        uint256 step0MinOut,
        uint256 step1AmountIn,
        uint256 step1MinOut,
        uint256 step2AmountIn,
        uint256 step2MinOut,
        address router0,
        address router1Addr,
        address router2Addr,
        address to,
        uint256 deadline
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
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: router0,
            path: path0,
            amountIn: step0AmountIn,
            minAmountOut: step0MinOut
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: router1Addr,
            path: path1,
            amountIn: step1AmountIn,
            minAmountOut: step1MinOut
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: router2Addr,
            path: path2,
            amountIn: step2AmountIn,
            minAmountOut: step2MinOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: totalAmountIn,
            minTotalAmountOut: step2MinOut,
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

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));

        vm.stopPrank();

        // Fund routers with output tokens
        _fundRouter(address(router1), address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(address(router1), address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(address(router1), address(tokenC), INITIAL_BALANCE * 10);
        _fundRouterWWDOGE(address(router1), INITIAL_BALANCE * 10);

        _fundRouter(address(router2), address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(address(router2), address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(address(router2), address(tokenC), INITIAL_BALANCE * 10);
        _fundRouterWWDOGE(address(router2), INITIAL_BALANCE * 10);

        // Fund user with ERC20 tokens
        tokenA.mint(user, INITIAL_BALANCE);
        vm.prank(user);
        tokenA.approve(address(aggregator), INITIAL_BALANCE);

        tokenB.mint(user, INITIAL_BALANCE);
        vm.prank(user);
        tokenB.approve(address(aggregator), INITIAL_BALANCE);

        tokenC.mint(user, INITIAL_BALANCE);
        vm.prank(user);
        tokenC.approve(address(aggregator), INITIAL_BALANCE);

        // Mint WWDOGE to user (for ERC20-path WWDOGE tests)
        MockERC20(address(wwdoge)).mint(user, INITIAL_BALANCE);
        vm.prank(user);
        MockERC20(address(wwdoge)).approve(address(aggregator), INITIAL_BALANCE);

        // Give user native DOGE for native swap tests
        vm.deal(user, 1000 ether);
    }

    // ============================================================
    // A. WWDOGE as First Hop
    // ============================================================

    /// @notice Native DOGE → WWDOGE (auto-wrap) → tokenA.
    ///         Verifies wrapping, fee deduction, and swap execution.
    function test_wwdogeFirstHop_nativeToTokenA() public {
        uint256 amountIn = 1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 userBalBefore = user.balance;
        uint256 recipientBalBefore = tokenA.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Verify native DOGE spent
        assertEq(userBalBefore - user.balance, amountIn, "native DOGE not spent");
        // Verify recipient received tokenA
        assertEq(tokenA.balanceOf(recipient) - recipientBalBefore, expectedOut, "output mismatch");
        // Verify fee went to treasury in WWDOGE
        assertEq(MockERC20(address(wwdoge)).balanceOf(treasury), feeAmount, "fee mismatch");
    }

    /// @notice Wrap on router1, swap on router2 (cross-dex).
    ///         The aggregator wraps native DOGE, then swaps via a different router.
    function test_wwdogeFirstHop_nativeToTokenA_crossDex() public {
        uint256 amountIn = 1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Use router2 for the swap step (different from wrapping)
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(router2), // different router
            recipient,
            block.timestamp + 1 hours
        );

        uint256 userBalBefore = user.balance;

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        assertEq(userBalBefore - user.balance, amountIn, "native DOGE not spent");
        assertEq(tokenA.balanceOf(recipient), expectedOut, "cross-dex output mismatch");
    }

    /// @notice Protocol fee is correctly deducted from WWDOGE after wrapping.
    ///         Fee = (amountIn * 25) / 10000 of the wrapped amount.
    function test_wwdogeFirstHop_feeDeduction() public {
        uint256 amountIn = 2 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 treasuryBefore = MockERC20(address(wwdoge)).balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Verify fee deduction
        uint256 treasuryFee = MockERC20(address(wwdoge)).balanceOf(treasury) - treasuryBefore;
        assertEq(treasuryFee, feeAmount, "fee deduction mismatch");
        assertEq(feeAmount, (amountIn * 25) / 10_000, "fee should be 25 bps");

        // Verify swapAmount (not amountIn) was used for the swap
        assertEq(tokenB.balanceOf(recipient), expectedOut, "swap should use amount after fee");
    }

    /// @notice Verify exact WWDOGE amount matches native DOGE sent.
    ///         1 native DOGE = 1 WWDOGE (1:1 wrapping).
    function test_wwdogeFirstHop_exactAmount() public {
        uint256 amountIn = 0.5 ether;

        // After wrapping, the aggregator should have exactly amountIn WWDOGE
        // Fee = (0.5 ether * 25) / 10000 = 0.00125 ether
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Verify 1:1 wrapping
        assertEq(swapAmount + feeAmount, amountIn, "wrap should be 1:1");

        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 wwdogeSupplyBefore = MockERC20(address(wwdoge)).totalSupply();

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // WWDOGE supply increased by amountIn (wrapping happened)
        uint256 wwdogeSupplyIncrease = MockERC20(address(wwdoge)).totalSupply() - wwdogeSupplyBefore;
        assertEq(wwdogeSupplyIncrease, amountIn, "WWDOGE mint should match native DOGE");
    }

    // ============================================================
    // B. WWDOGE as Intermediate Hop
    // ============================================================

    /// @notice tokenA → WWDOGE → tokenB (ERC20 path, no native DOGE involved).
    ///         WWDOGE is just an intermediate ERC20 in this route.
    function test_wwdogeIntermediate_tokenA_to_wwdoge_to_tokenB() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1: tokenA → WWDOGE at 2x rate
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        // Step 2: WWDOGE → tokenB at 2x rate
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        // No msg.value — pure ERC20 path
        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(tokenA),
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router1),
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - recipientBefore, step2Out, "intermediate WWDOGE output mismatch");
    }

    /// @notice tokenA → WWDOGE → tokenC → tokenB (3-hop with WWDOGE intermediate).
    ///         WWDOGE is the first intermediate in a 3-hop route.
    function test_wwdogeIntermediate_threeHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;
        uint256 step3Out = (step2Out * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildThreeHopSwap(
            address(tokenA),
            address(wwdoge),
            address(tokenC),
            address(tokenB),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            step2Out,
            step3Out,
            address(router1),
            address(router1),
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), step3Out, "3-hop WWDOGE intermediate output mismatch");
    }

    /// @notice Verify amounts at each leg through WWDOGE as intermediate.
    ///         Check that the aggregator holds no tokens after the swap.
    function test_wwdogeIntermediate_correctAmounts() public {
        uint256 amountIn = 500e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        uint256 treasuryBefore = tokenA.balanceOf(treasury);

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(tokenA),
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router1),
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify fee
        assertEq(tokenA.balanceOf(treasury) - treasuryBefore, feeAmount, "fee mismatch");

        // Verify final output
        assertEq(tokenB.balanceOf(recipient), step2Out, "output mismatch");

        // Verify no tokens stuck in aggregator
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "tokenA dust");
        assertEq(MockERC20(address(wwdoge)).balanceOf(address(aggregator)), 0, "WWDOGE dust");
        assertEq(tokenB.balanceOf(address(aggregator)), 0, "tokenB dust");
    }

    /// @notice Different routers for WWDOGE entry/exit in a 2-hop.
    ///         tokenA → WWDOGE via router1, WWDOGE → tokenB via router2.
    function test_wwdogeIntermediate_crossDex() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(tokenA),
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router1), // entry router
            address(router2), // exit router (cross-dex)
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), step2Out, "cross-dex intermediate output mismatch");
    }

    // ============================================================
    // C. WWDOGE as Last Hop
    // ============================================================

    /// @notice tokenA → WWDOGE (user receives WWDOGE, not native DOGE).
    ///         This is a standard ERC20 swap where the output happens to be WWDOGE.
    function test_wwdogeLastHop_tokenA_to_wwdoge() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // No msg.value — ERC20 path, user receives WWDOGE tokens
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify recipient received WWDOGE (not native DOGE)
        uint256 wwdogeReceived = MockERC20(address(wwdoge)).balanceOf(recipient) - recipientWWDOGEBefore;
        assertEq(wwdogeReceived, expectedOut, "WWDOGE output mismatch");
        // Verify recipient's native balance didn't change
        assertEq(recipient.balance, 0, "should not receive native DOGE");
    }

    /// @notice tokenA → tokenC → WWDOGE (3-hop ending in WWDOGE).
    ///         User receives WWDOGE tokens at the end of a 3-hop route.
    function test_wwdogeLastHop_tokenA_to_wwdoge_threeHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;
        uint256 step3Out = (step2Out * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildThreeHopSwap(
            address(tokenA),
            address(tokenB),
            address(tokenC),
            address(wwdoge),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            step2Out,
            step3Out,
            address(router1),
            address(router1),
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 wwdogeReceived = MockERC20(address(wwdoge)).balanceOf(recipient) - recipientWWDOGEBefore;
        assertEq(wwdogeReceived, step3Out, "3-hop WWDOGE last hop output mismatch");
    }

    /// @notice Verify user gets WWDOGE tokens, not native DOGE.
    ///         The aggregator does NOT auto-unwrap WWDOGE on output.
    function test_wwdogeLastHop_userReceivesWwdoge() public {
        uint256 amountIn = 500e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientNativeBefore = recipient.balance;
        uint256 recipientWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        // User received WWDOGE tokens
        assertEq(
            MockERC20(address(wwdoge)).balanceOf(recipient) - recipientWWDOGEBefore,
            expectedOut,
            "should receive WWDOGE"
        );
        // User did NOT receive native DOGE
        assertEq(recipient.balance - recipientNativeBefore, 0, "should NOT receive native DOGE");
    }

    /// @notice Swap to WWDOGE, then user unwraps separately.
    ///         Demonstrates the 2-step process: swap → unwrap.
    function test_wwdogeLastHop_unwrapSeparately() public {
        uint256 amountIn = 1 ether;

        // Use tokenA → WWDOGE (ERC20 path)
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Pre-fund MockWWDOGE with enough native DOGE for the unwrap.
        // The 2x exchange rate creates WWDOGE without corresponding native deposits,
        // so we need to supply the native DOGE backing for the withdraw to succeed.
        ForceFeeder feeder = new ForceFeeder{value: expectedOut + 1 ether}();
        feeder.feed(payable(address(wwdoge)));

        // Set recipient = user so user gets the WWDOGE
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            user, // user receives WWDOGE directly
            block.timestamp + 1 hours
        );

        uint256 userWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(user);
        uint256 userNativeBefore = user.balance;

        vm.prank(user);
        aggregator.executeSwap(req);

        // User has WWDOGE
        uint256 wwdogeReceived = MockERC20(address(wwdoge)).balanceOf(user) - userWWDOGEBefore;
        assertEq(wwdogeReceived, expectedOut, "user should have WWDOGE");

        // User unwraps WWDOGE separately
        vm.prank(user);
        MockWWDOGE(payable(address(wwdoge))).withdraw(wwdogeReceived);

        // User now has native DOGE instead
        assertEq(user.balance - userNativeBefore, wwdogeReceived, "user should have native DOGE after unwrap");
        assertEq(MockERC20(address(wwdoge)).balanceOf(user), userWWDOGEBefore, "WWDOGE should be burned");
    }

    // ============================================================
    // D. Native DOGE Round-Trip
    // ============================================================

    /// @notice Native DOGE → WWDOGE → tokenA → WWDOGE.
    ///         User starts with native, ends with WWDOGE (could unwrap manually).
    function test_roundTrip_nativeToWwdogeToNative() public {
        uint256 amountIn = 0.5 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1: native → WWDOGE (auto-wrap) → tokenA
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        // Step 2: tokenA → WWDOGE
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        // Pre-fund MockWWDOGE with enough native DOGE for the final unwrap.
        // The 2x2=4x effective rate means step2Out >> amountIn, so MockWWDOGE
        // needs more native DOGE than what was deposited during wrapping.
        ForceFeeder feeder = new ForceFeeder{value: step2Out + 1 ether}();
        feeder.feed(payable(address(wwdoge)));

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(wwdoge),
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router1),
            address(router1),
            user, // user receives final WWDOGE
            block.timestamp + 1 hours
        );

        uint256 userNativeBefore = user.balance;
        uint256 userWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(user);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // User spent native DOGE
        assertEq(userNativeBefore - user.balance, amountIn, "native spent");
        // User received WWDOGE at the end
        uint256 wwdogeReceived = MockERC20(address(wwdoge)).balanceOf(user) - userWWDOGEBefore;
        assertEq(wwdogeReceived, step2Out, "round-trip WWDOGE output mismatch");

        // User can unwrap to get native back (at a different amount due to 2x rates)
        vm.prank(user);
        MockWWDOGE(payable(address(wwdoge))).withdraw(wwdogeReceived);
        assertGt(user.balance, userNativeBefore - amountIn, "user should have more native after round-trip at 2x");
    }

    /// @notice Native DOGE → WWDOGE → tokenA → WWDOGE (user receives WWDOGE).
    ///         The full round-trip goes through an intermediate token.
    function test_roundTrip_nativeToTokenToNative() public {
        uint256 amountIn = 1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1: WWDOGE → tokenA
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        // Step 2: tokenA → WWDOGE
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(wwdoge),
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router1),
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Recipient gets WWDOGE (not native)
        uint256 received = MockERC20(address(wwdoge)).balanceOf(recipient) - recipientWWDOGEBefore;
        assertEq(received, step2Out, "round-trip output mismatch");
        assertEq(recipient.balance, 0, "recipient should not get native DOGE");
    }

    /// @notice Gas cost of round-trip native → token → native.
    ///         Measures gas for a 2-hop native DOGE swap.
    function test_roundTrip_gasCost() public {
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(wwdoge),
            address(tokenA),
            address(wwdoge),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router1),
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 gasBefore = gasleft();
        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);
        uint256 gasUsed = gasBefore - gasleft();

        // Round-trip should complete within reasonable gas
        assertLt(gasUsed, 600_000, "round-trip gas too high");
    }

    // ============================================================
    // E. WWDOGE Edge Cases
    // ============================================================

    /// @notice msg.value = 0, tokenIn = ERC20 (not WWDOGE), normal swap.
    ///         This is the standard ERC20 swap path, no native DOGE involved.
    function test_wwdoge_zeroValue_erc20Path() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // No {value: ...} — standard ERC20 swap
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "ERC20 path output mismatch");
    }

    /// @notice msg.value != amountIn when tokenIn = WWDOGE → reverts.
    ///         The aggregator requires exact value match for native DOGE swaps.
    function test_wwdoge_valueMismatch_reverts() public {
        uint256 amountIn = 1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // Send wrong value (0.5 ether instead of 1 ether)
        vm.prank(user);
        vm.expectRevert("Value must match amountIn");
        aggregator.executeSwap{value: 0.5 ether}(req);
    }

    /// @notice msg.value > 0 but tokenIn != WWDOGE → reverts.
    ///         Native DOGE can only be used when swapping WWDOGE.
    function test_wwdoge_wrongTokenIn_withValue_reverts() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // tokenIn = tokenA (not WWDOGE) but sending native DOGE
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), // wrong! should be WWDOGE when sending value
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Native DOGE only for WWDOGE swaps");
        aggregator.executeSwap{value: 0.1 ether}(req);
    }

    /// @notice Send excess native DOGE, verify refund.
    ///         If the aggregator somehow holds excess native balance after swap,
    ///         it refunds the excess to msg.sender.
    function test_wwdoge_nativeRefund_excessValue() public {
        // Force-send some ETH to the aggregator to simulate excess
        uint256 excessAmount = 0.05 ether;
        ForceFeeder feeder = new ForceFeeder{value: excessAmount}();
        feeder.feed(payable(address(aggregator)));

        // Verify aggregator has excess
        assertEq(address(aggregator).balance, excessAmount, "aggregator should have excess");

        // Now do a normal native DOGE swap
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(wwdoge),
            address(tokenA),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 userBalBefore = user.balance;

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // User should have been refunded the excess
        // Net cost = amountIn - excessAmount
        assertEq(userBalBefore - user.balance, amountIn - excessAmount, "refund mismatch");

        // Aggregator should have 0 balance after refund
        assertEq(address(aggregator).balance, 0, "aggregator should have 0 balance");
    }
}
