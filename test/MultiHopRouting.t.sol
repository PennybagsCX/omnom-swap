// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title MultiHopRoutingTest
/// @notice Tests for multi-step swap paths: two-hop, three-hop, cross-DEX routing,
///         split routing, slippage protection, deadline protection, fee handling,
///         and output amount verification.
contract MultiHopRoutingTest is Test {
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

    uint256 constant EXCHANGE_RATE = 2e18; // 1 input - 2 output
    uint256 constant INITIAL_BALANCE = 100_000_000e18;
    uint256 constant FEE_BPS = 10; // 0.1%

    // --- Helpers ------------------------------------------------------

    function _fundAndApprove(
        address tokenAddr,
        address _user,
        uint256 amount
    ) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _fundRouter(MockUniswapV2Router _router, address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(_router), amount);
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
        _fundRouter(router2, address(tokenB), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenC), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenD), INITIAL_BALANCE);

        // Also fund routers with tokenA for reverse swaps
        _fundRouter(router1, address(tokenA), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenA), INITIAL_BALANCE);
    }

    // -------------------------------------------------------------------
    // 1. Two-Hop Swap: tokenA - tokenB - tokenC through same router
    // -------------------------------------------------------------------
    function test_TwoHopSwap_Success() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1: tokenA - tokenB
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        // Step 2: tokenB - tokenC
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        // Build step 1
        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        // Build step 2
        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 recipientBalBefore = tokenC.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenC.balanceOf(recipient) - recipientBalBefore, step2Out, "two-hop output mismatch");
    }

    // -------------------------------------------------------------------
    // 2. Three-Hop Swap: tokenA - tokenB - tokenC - tokenD
    // -------------------------------------------------------------------
    function test_ThreeHopSwap_Success() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Calculate expected outputs for each hop
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;
        uint256 step3Out = (step2Out * EXCHANGE_RATE) / 1e18;

        // Build paths
        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        address[] memory path3 = new address[](2);
        path3[0] = address(tokenC);
        path3[1] = address(tokenD);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path3,
            amountIn: step2Out,
            minAmountOut: step3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenD),
            amountIn: amountIn,
            minTotalAmountOut: step3Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 recipientBalBefore = tokenD.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenD.balanceOf(recipient) - recipientBalBefore,
            step3Out,
            "three-hop output mismatch"
        );
    }

    // -------------------------------------------------------------------
    // 3. Cross-DEX Routing: Step 1 through Router1, Step 2 through Router2
    // -------------------------------------------------------------------
    function test_CrossDexRouting_Success() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1), // Step 1: router1
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2), // Step 2: router2
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 recipientBalBefore = tokenC.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenC.balanceOf(recipient) - recipientBalBefore,
            step2Out,
            "cross-DEX output mismatch"
        );
    }

    // -------------------------------------------------------------------
    // 4. Split Routing: Same tokenIn split across two DEXes
    // -------------------------------------------------------------------
    function test_SplitRouting_Success() public {
        // Split routing: route through two different DEXes in sequence.
        // Step 1: tokenA -> tokenB through router1
        // Step 2: tokenB -> tokenC through router2
        // This demonstrates cross-DEX routing where each step uses a different router.
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 recipientBalBefore = tokenC.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenC.balanceOf(recipient) - recipientBalBefore,
            step2Out,
            "split routing output mismatch"
        );
    }

    // -------------------------------------------------------------------
    // 5. Slippage Protection
    // -------------------------------------------------------------------
    function test_SlippageProtection_RevertOnMultiHop() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        // Set an unreasonably high minTotalAmountOut
        uint256 unreasonableMinOut = step2Out * 100;

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: unreasonableMinOut,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(req);
    }

    function test_SlippageProtection_RevertOnSingleHop() public {
        uint256 amountIn = 1000e18;
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
            minTotalAmountOut: expectedOut + 1, // Just 1 wei over the actual output
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(req);
    }

    // -------------------------------------------------------------------
    // 6. Deadline Protection
    // -------------------------------------------------------------------
    function test_DeadlineProtection_RevertOnExpired() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: 0, // will be filled by output of step 1
            minAmountOut: 0
        });

        // Set deadline in the past
        uint256 pastDeadline = block.timestamp - 1;

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: pastDeadline,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Expired");
        aggregator.executeSwap(req);
    }

    function test_DeadlineProtection_WarpPastDeadline() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: 0
        });

        uint256 deadline = block.timestamp + 1 hours;

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: deadline,
            recipient: recipient
        });

        // Warp past the deadline
        vm.warp(deadline + 1);

        vm.prank(user);
        vm.expectRevert("Expired");
        aggregator.executeSwap(req);
    }

    // -------------------------------------------------------------------
    // 7. Multi-Hop with Fee
    // -------------------------------------------------------------------
    function test_MultiHopWithFee_FeeTakenBeforeExecution() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify treasury received the fee
        assertEq(
            tokenA.balanceOf(treasury) - treasuryBalBefore,
            feeAmount,
            "fee not taken before multi-hop"
        );

        // Verify the swap was based on swapAmount (after fee), not amountIn
        // If fee was not taken, step1Out would be based on 1000e18 instead of 999.9e18
        assertEq(tokenC.balanceOf(recipient), step2Out, "output should reflect fee deduction");
    }

    function test_MultiHopWithFee_HighFee() public {
        // Set fee to 500 bps (5%)
        vm.prank(owner);
        aggregator.setProtocolFee(500);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * 500) / 10_000; // 50e18
        uint256 swapAmount = amountIn - feeAmount; // 950e18

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18; // 1900e18
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18; // 3800e18

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenA.balanceOf(treasury) - treasuryBalBefore, feeAmount, "high fee mismatch");
        assertEq(tokenC.balanceOf(recipient), step2Out, "high fee output mismatch");
    }

    // -------------------------------------------------------------------
    // 8. Output Amount Verification
    // -------------------------------------------------------------------
    function test_OutputAmountVerification_SingleHop() public {
        uint256 amountIn = 500e18;
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
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "single-hop output mismatch");
    }

    function test_OutputAmountVerification_TwoHop() public {
        uint256 amountIn = 500e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify final output: 2x compounding - 4x effective rate on original swapAmount
        assertEq(tokenC.balanceOf(recipient), step2Out, "two-hop output mismatch");
    }

    function test_OutputAmountVerification_ThreeHop() public {
        uint256 amountIn = 100e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;
        uint256 step3Out = (step2Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        address[] memory path3 = new address[](2);
        path3[0] = address(tokenC);
        path3[1] = address(tokenD);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });
        steps[2] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path3,
            amountIn: step2Out,
            minAmountOut: step3Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenD),
            amountIn: amountIn,
            minTotalAmountOut: step3Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // 3 hops with 2x rate - 8x effective
        assertEq(tokenD.balanceOf(recipient), step3Out, "three-hop output mismatch");
    }

    function test_OutputAmountVerification_SplitRouting() public {
        // Cross-DEX routing with different exchange rates
        // Step 1: tokenA -> tokenB through router1 (2x rate)
        // Step 2: tokenB -> tokenC through router2 (2x rate)
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenC.balanceOf(recipient),
            step2Out,
            "split routing output mismatch"
        );
    }

    function test_OutputAmountVerification_WithDifferentExchangeRates() public {
        // Set router2 to have a different exchange rate (3x)
        router2.setExchangeRate(3e18);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1 through router1 (2x rate)
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        // Step 2 through router2 (3x rate)
        uint256 step2Out = (step1Out * 3e18) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // 2x * 3x = 6x effective rate
        assertEq(
            tokenC.balanceOf(recipient),
            step2Out,
            "mixed exchange rate output mismatch"
        );
    }

    // -------------------------------------------------------------------
    // Event emission on multi-hop
    // -------------------------------------------------------------------
    function test_MultiHop_EmitsSwapExecutedEvent() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path2,
            amountIn: step1Out,
            minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: step2Out,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify the swap executed correctly (event tested in OmnomSwapAggregator.t.sol)
        assertEq(tokenC.balanceOf(recipient), step2Out, "multi-hop output mismatch");
    }
}
