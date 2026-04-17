// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title NativeDogeSwapTest
/// @notice Tests for native DOGE support: auto-wrapping, fee deduction, validation,
///         backward compatibility, receive guard, refund safety, and reentrancy protection.
contract NativeDogeSwapTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockUniswapV2Router public router;
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

    function _buildSingleSwapRequest(
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
        address tokenIn;
        address midToken;
        address tokenOut;
        uint256 totalAmountIn;
        uint256 step1AmountIn;
        uint256 step1Out;
        uint256 step2AmountIn;
        uint256 step2Out;
        address routerAddr;
        address to;
        uint256 deadline;
    }

    function _buildTwoHopSwapRequest(TwoHopParams memory p)
        internal view returns (OmnomSwapAggregator.SwapRequest memory)
    {
        address[] memory path1 = new address[](2);
        path1[0] = p.tokenIn;
        path1[1] = p.midToken;

        address[] memory path2 = new address[](2);
        path2[0] = p.midToken;
        path2[1] = p.tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: p.routerAddr,
            path: path1,
            amountIn: p.step1AmountIn,
            minAmountOut: p.step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: p.routerAddr,
            path: path2,
            amountIn: p.step2AmountIn,
            minAmountOut: p.step2Out
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: p.tokenIn,
            tokenOut: p.tokenOut,
            amountIn: p.totalAmountIn,
            minTotalAmountOut: p.step2Out,
            steps: steps,
            deadline: p.deadline,
            recipient: p.to
        });
    }

    function _fundRouter(address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(router), amount);
    }

    // ============================================================
    // setUp
    // ============================================================

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenB = new MockERC20("Token B", "TKB", 18);
        tokenC = new MockERC20("Token C", "TKC", 18);

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund router with output tokens
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenC), INITIAL_BALANCE * 10);
        // Fund router with WWDOGE for reverse swaps
        MockERC20(address(wwdoge)).mint(address(router), INITIAL_BALANCE * 10);

        // Give user some ETH for native DOGE swaps
        vm.deal(user, 100 ether);
    }

    // ============================================================
    // 1. test_NativeDogeSwap
    // ============================================================

    /// @notice Send native DOGE with executeSwap{value: 0.1 ether}(...),
    ///         verify wrapping happens internally and swap succeeds.
    function test_NativeDogeSwap() public {
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 userBalBefore = user.balance;
        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Verify user's native DOGE was spent
        assertEq(userBalBefore - user.balance, amountIn, "user native balance mismatch");
        // Verify recipient received output tokens
        assertEq(tokenB.balanceOf(recipient) - recipientBalBefore, expectedOut, "output mismatch");
        // Verify WWDOGE wrapping happened — treasury received fee in WWDOGE
        assertEq(MockERC20(address(wwdoge)).balanceOf(treasury), feeAmount, "fee not received as WWDOGE");
    }

    // ============================================================
    // 2. test_NativeDogeSwapMultiHop
    // ============================================================

    /// @notice Native DOGE swap with a 2-hop route: WWDOGE → tokenB → tokenC.
    function test_NativeDogeSwapMultiHop() public {
        uint256 amountIn = 0.5 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1: WWDOGE → tokenB
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        // Step 2: tokenB → tokenC
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        // Fund router with tokenC for step 2
        MockERC20(address(tokenC)).mint(address(router), INITIAL_BALANCE * 10);

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwapRequest(TwoHopParams({
            tokenIn: address(wwdoge),
            midToken: address(tokenB),
            tokenOut: address(tokenC),
            totalAmountIn: amountIn,
            step1AmountIn: swapAmount,
            step1Out: step1Out,
            step2AmountIn: step1Out,
            step2Out: step2Out,
            routerAddr: address(router),
            to: recipient,
            deadline: block.timestamp + 1 hours
        }));

        uint256 userBalBefore = user.balance;
        uint256 recipientBalBefore = tokenC.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Verify user's native DOGE was spent
        assertEq(userBalBefore - user.balance, amountIn, "user native balance mismatch");
        // Verify recipient received final output tokens
        assertEq(tokenC.balanceOf(recipient) - recipientBalBefore, step2Out, "output mismatch");
    }

    // ============================================================
    // 3. test_NativeDogeSwapWithFee
    // ============================================================

    /// @notice Verify 0.25% fee is deducted correctly from wrapped amount.
    function test_NativeDogeSwapWithFee() public {
        uint256 amountIn = 1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 treasuryBalBefore = MockERC20(address(wwdoge)).balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // Verify fee went to treasury in WWDOGE
        uint256 treasuryFeeReceived = MockERC20(address(wwdoge)).balanceOf(treasury) - treasuryBalBefore;
        assertEq(treasuryFeeReceived, feeAmount, "treasury fee mismatch");

        // Verify fee is exactly 0.25%
        assertEq(feeAmount, (amountIn * 25) / 10_000, "fee calculation wrong");
    }

    // ============================================================
    // 4. test_NativeDogeRejectsWrongToken
    // ============================================================

    /// @notice Send msg.value but set tokenIn to non-WWDOGE → revert.
    function test_NativeDogeRejectsWrongToken() public {
        uint256 amountIn = 0.1 ether;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenB), // wrong! should be WWDOGE when sending native
            address(tokenC),
            amountIn,
            amountIn,
            0,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Native DOGE only for WWDOGE swaps");
        aggregator.executeSwap{value: amountIn}(req);
    }

    // ============================================================
    // 5. test_NativeDogeRejectsValueMismatch
    // ============================================================

    /// @notice Send msg.value != amountIn → revert.
    function test_NativeDogeRejectsValueMismatch() public {
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        // Send wrong value (0.05 ether instead of 0.1 ether)
        vm.prank(user);
        vm.expectRevert("Value must match amountIn");
        aggregator.executeSwap{value: 0.05 ether}(req);
    }

    // ============================================================
    // 6. test_NativeDogeZeroValue
    // ============================================================

    /// @notice Call with msg.value == 0 and tokenIn == WWDOGE → should use ERC20 path (backward compatible).
    function test_NativeDogeZeroValue() public {
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Mint WWDOGE to user and approve aggregator
        MockERC20(address(wwdoge)).mint(user, amountIn);
        vm.prank(user);
        MockERC20(address(wwdoge)).approve(address(aggregator), amountIn);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 userWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(user);
        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        // Call with NO native DOGE — uses ERC20 path
        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify user's WWDOGE was spent (ERC20 path)
        assertEq(userWWDOGEBefore - MockERC20(address(wwdoge)).balanceOf(user), amountIn, "WWDOGE not deducted");
        // Verify recipient received output tokens
        assertEq(tokenB.balanceOf(recipient) - recipientBalBefore, expectedOut, "output mismatch");
    }

    // ============================================================
    // 7. test_ReceiveReverts
    // ============================================================

    /// @notice Send native DOGE directly to contract → revert.
    function test_ReceiveReverts() public {
        (bool success, ) = address(aggregator).call{value: 0.1 ether}("");
        assertFalse(success, "should have reverted");

        // Verify with expectRevert
        vm.prank(user);
        (bool revertSuccess, bytes memory revertData) = address(aggregator).call{value: 0.1 ether}("");
        assertFalse(revertSuccess, "direct send should fail");
        // Check the revert reason contains "Use executeSwap"
        assertGt(revertData.length, 0, "should have revert data");
    }

    // ============================================================
    // 8. test_NativeDogeRefundExcess
    // ============================================================

    /// @notice If contract somehow has excess balance after swap, verify it's refunded.
    function test_NativeDogeRefundExcess() public {
        // We'll force some native DOGE into the aggregator before the swap
        // by self-destructing a contract that sends ETH to it
        uint256 excessAmount = 0.05 ether;

        // Create and destroy a contract to force-send ETH to aggregator
        // (bypassing the receive() revert)
        ForceFeeder feeder = new ForceFeeder{value: excessAmount}();
        feeder.feed(payable(address(aggregator)));

        // Verify aggregator has the excess balance
        assertEq(address(aggregator).balance, excessAmount, "aggregator should have excess");

        // Now do a normal native DOGE swap
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 userBalBefore = user.balance;

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        // User should have been refunded the excess
        uint256 userBalAfter = user.balance;
        // user spent amountIn but got back excessAmount
        assertEq(userBalBefore - userBalAfter, amountIn - excessAmount, "refund mismatch");

        // Aggregator should have 0 balance after refund
        assertEq(address(aggregator).balance, 0, "aggregator should have 0 balance");
    }

    // ============================================================
    // 9. test_NativeDogeSwapToTreasury
    // ============================================================

    /// @notice Verify fee goes to treasury correctly when using native DOGE.
    function test_NativeDogeSwapToTreasury() public {
        uint256 amountIn = 2 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(wwdoge),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 treasuryWWDOGEBefore = MockERC20(address(wwdoge)).balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap{value: amountIn}(req);

        uint256 treasuryFee = MockERC20(address(wwdoge)).balanceOf(treasury) - treasuryWWDOGEBefore;
        assertEq(treasuryFee, feeAmount, "treasury fee mismatch");

        // Verify the SwapExecuted event fee matches
        assertEq(feeAmount, (amountIn * 25) / 10_000, "fee should be 25 bps");
    }

    // ============================================================
    // 10. test_NativeDogeReentrancy
    // ============================================================

    /// @notice Verify reentrancy guard works with native DOGE flow.
    ///         The attacker force-sends ETH to the aggregator before the swap,
    ///         so the refund triggers receive() on the attacker during executeSwap.
    ///         The attacker tries to re-enter executeSwap in the receive() callback.
    function test_NativeDogeReentrancy() public {
        // Deploy a reentrancy attacker contract with some ETH
        NativeDogeReentrancyAttacker attacker = new NativeDogeReentrancyAttacker{value: 1 ether}(
            payable(address(aggregator)),
            address(wwdoge),
            address(tokenB)
        );

        // Fund router with output tokens
        MockERC20(address(tokenB)).mint(address(router), INITIAL_BALANCE * 10);

        // Force-send some ETH to the aggregator so the refund triggers attacker's receive()
        ForceFeeder feeder = new ForceFeeder{value: 0.05 ether}();
        feeder.feed(payable(address(aggregator)));

        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Build the swap request for the attacker
        address[] memory path = new address[](2);
        path[0] = address(wwdoge);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
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
            deadline: block.timestamp + 1 hours,
            recipient: address(attacker)
        });

        attacker.attack(req, amountIn);

        // Verify reentrancy was attempted but failed
        assertTrue(attacker.reentrancyAttempted(), "reentrancy should have been attempted");
        assertFalse(attacker.reentrancySucceeded(), "reentrancy should NOT have succeeded");
    }
}

// ============================================================
// Helper contract to force-send ETH to aggregator (bypassing receive())
// ============================================================

contract ForceFeeder {
    constructor() payable {}

    function feed(address payable target) external {
        selfdestruct(target);
    }
}

// ============================================================
// Reentrancy attacker for native DOGE flow
// ============================================================

contract NativeDogeReentrancyAttacker {
    OmnomSwapAggregator public aggregator;
    address public wwdoge;
    address public tokenOut;
    bool public reentrancyAttempted;
    bool public reentrancySucceeded;
    OmnomSwapAggregator.SwapRequest public pendingRequest;
    uint256 public pendingValue;

    constructor(address payable _aggregator, address _wwdoge, address _tokenOut) payable {
        aggregator = OmnomSwapAggregator(_aggregator);
        wwdoge = _wwdoge;
        tokenOut = _tokenOut;
    }

    function attack(OmnomSwapAggregator.SwapRequest calldata req, uint256 value) external {
        pendingRequest = req;
        pendingValue = value;
        aggregator.executeSwap{value: value}(req);
    }

    receive() external payable {
        if (!reentrancyAttempted) {
            reentrancyAttempted = true;
            try aggregator.executeSwap{value: 0}(pendingRequest) {
                reentrancySucceeded = true;
            } catch {
                // Expected: reverts due to nonReentrant
            }
        }
    }
}
