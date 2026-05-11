// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";
import "../contracts/mocks/MockFeeOnTransferToken.sol";
import "../contracts/mocks/MockUniswapV2Pair.sol";

/// @title CoverageGapTest
/// @notice Tests targeting uncovered lines in OmnomSwapAggregator.sol, plus LP token
///         and bridged token swap scenarios. Identified uncovered lines from LCOV:
///         - Lines 222-224: Native DOGE wrapping path (require + IWWDOGE.deposit)
///         - Lines 246-247: Native DOGE else branch (received = msg.value)
///         - Lines 341-342: Native DOGE refund at end of executeSwap
///         - Lines 351-352: receive() function revert
///         - Lines 398, 402: confirmRouterRemoval for-loop artifacts
contract CoverageGapTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18; // 1 input → 2 output
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 10; // 0.1%

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

    function _buildTwoHopSwapRequest(
        address tokenIn,
        address midToken,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 step1AmountIn,
        uint256 step1MinOut,
        uint256 step2AmountIn,
        uint256 step2MinOut,
        address routerAddr,
        address to,
        uint256 deadline
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path1 = new address[](2);
        path1[0] = tokenIn;
        path1[1] = midToken;

        address[] memory path2 = new address[](2);
        path2[0] = midToken;
        path2[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: routerAddr,
            path: path1,
            amountIn: step1AmountIn,
            minAmountOut: step1MinOut
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: routerAddr,
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

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
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

        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);
        tokenC = new MockERC20("Token C", "TKC", 18);

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user with tokens
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);

        // Fund router with output tokens
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenC), INITIAL_BALANCE * 10);

        // Give user native DOGE for native swap tests
        vm.deal(user, 100 ether);
    }

    // ============================================================
    // A. Uncovered Line Tests
    // ============================================================

    // --- Covers lines 351-352: receive() function ---

    /// @notice Sending native DOGE directly to the aggregator (not via executeSwap)
    ///         must revert with "Use executeSwap".
    function test_receive_revertsWithMessage() public {
        vm.prank(user);
        vm.expectRevert("Use executeSwap");
        payable(address(aggregator)).transfer(0.1 ether);
    }

    /// @notice Same test using low-level call to verify revert data is returned.
    function test_receive_revertsWithMessage_viaCall() public {
        // Deal native DOGE to this test contract so it can send
        vm.deal(address(this), 1 ether);
        (bool success, bytes memory data) = address(aggregator).call{value: 0.05 ether}("");
        assertFalse(success, "call should have failed");
        // The revert reason should contain "Use executeSwap"
        assertGt(data.length, 0, "should have revert data");
    }

    // --- Covers lines 222-224, 246-247: Native DOGE wrapping path ---

    /// @notice Execute a swap with native DOGE (msg.value > 0), which triggers
    ///         the wrapping path: require checks + IWWDOGE.deposit + else branch.
    function test_nativeDogeSwap_coversWrappingPath() public {
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Fund router with tokenB so the swap can succeed
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);
        // Fund router with WWDOGE for the swap
        MockERC20(address(wwdoge)).mint(address(router), INITIAL_BALANCE * 10);

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
        assertEq(
            MockERC20(address(wwdoge)).balanceOf(treasury),
            feeAmount,
            "fee not received as WWDOGE"
        );
    }

    /// @notice Native DOGE swap with zero fee to cover the feeAmount == 0 branch
    ///         alongside the wrapping path.
    function test_nativeDogeSwap_zeroFee_coversWrappingPath() public {
        // Deploy aggregator with 0 fee
        vm.startPrank(owner);
        OmnomSwapAggregator zeroFeeAggregator = new OmnomSwapAggregator(treasury, 0, address(wwdoge));
        zeroFeeAggregator.addRouter(address(router));
        vm.stopPrank();

        uint256 amountIn = 0.1 ether;
        uint256 expectedOut = (amountIn * EXCHANGE_RATE) / 1e18;

        // Fund router with tokenB
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(wwdoge),
            address(tokenB),
            amountIn,
            amountIn,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        zeroFeeAggregator.executeSwap{value: amountIn}(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "output mismatch");
        // No fee collected
        assertEq(
            MockERC20(address(wwdoge)).balanceOf(treasury),
            0,
            "no fee should be collected"
        );
    }

    // --- Covers lines 340-342: Native DOGE refund at end of executeSwap ---

    /// @notice Tests the stray native DOGE refund path. If native DOGE somehow ends up
    ///         in the contract during a swap, it should be refunded to msg.sender.
    ///         We force native DOGE into the aggregator via selfdestruct before the swap.
    function test_nativeDogeSwap_refundStrayDoge() public {
        uint256 amountIn = 0.1 ether;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Fund router with WWDOGE and tokenB
        MockERC20(address(wwdoge)).mint(address(router), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);

        // Force-send native DOGE to the aggregator via selfdestruct
        // This creates a stray balance that triggers the refund path
        address payable forceSender = payable(address(0x999));
        vm.deal(forceSender, 0.5 ether);
        // Use a contract to selfdestruct into the aggregator
        ForceFeeder feeder = new ForceFeeder{value: 0.5 ether}();
        feeder.forceSend(payable(address(aggregator)));

        // Verify aggregator has stray native DOGE
        assertEq(address(aggregator).balance, 0.5 ether, "stray balance not set");

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

        // User should have been refunded the stray 0.5 ether
        // userBalBefore - amountIn is what user paid for the swap
        // user should also get back the 0.5 ether stray balance
        assertEq(
            user.balance,
            userBalBefore - amountIn + 0.5 ether,
            "stray DOGE not refunded"
        );
    }

    // --- Covers lines 398, 402: confirmRouterRemoval for-loop ---

    /// @notice Tests confirmRouterRemoval with multiple routers to exercise the
    ///         for-loop that finds and removes the router from routerList.
    function test_confirmRouterRemoval_coversLoop() public {
        // Add multiple routers
        MockUniswapV2Router router2 = new MockUniswapV2Router(address(0), 1e18);
        MockUniswapV2Router router3 = new MockUniswapV2Router(address(0), 1e18);

        vm.startPrank(owner);
        aggregator.addRouter(address(router2));
        aggregator.addRouter(address(router3));

        // Initiate removal of the first router (middle of list)
        aggregator.removeRouter(address(router));

        // Warp past the timelock
        vm.warp(block.timestamp + 3 days);

        // Confirm removal — this exercises the for-loop to find and remove
        aggregator.confirmRouterRemoval(address(router));
        vm.stopPrank();

        assertFalse(aggregator.supportedRouters(address(router)), "router should be removed");
        // The remaining routers should still be there
        assertTrue(aggregator.supportedRouters(address(router2)), "router2 should remain");
        assertTrue(aggregator.supportedRouters(address(router3)), "router3 should remain");
    }

    // ============================================================
    // B. LP Token Tests
    // ============================================================

    /// @notice Swap LP tokens (simulated as MockERC20) through the aggregator as input.
    ///         In production, LP tokens are ERC20-compatible, so the aggregator handles
    ///         them like any other token.
    function test_lpToken_asInput_succeeds() public {
        // Create LP token (simulated with MockERC20)
        MockERC20 lpToken = new MockERC20("UNI-V2 LP", "UNI-V2", 18);

        // Fund user with LP tokens and approve aggregator
        _fundAndApprove(address(lpToken), user, INITIAL_BALANCE);

        // Fund router with tokenB (output) so the swap succeeds
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);

        uint256 swapAmt = 100e18;
        uint256 feeAmount = (swapAmt * FEE_BPS) / 10_000;
        uint256 swapAmount = swapAmt - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(lpToken),
            address(tokenB),
            swapAmt,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenB.balanceOf(recipient) - recipientBalBefore,
            expectedOut,
            "LP token swap output mismatch"
        );
        // Verify LP tokens were taken from user
        assertEq(
            lpToken.balanceOf(user),
            INITIAL_BALANCE - swapAmt,
            "LP tokens not deducted"
        );
    }

    /// @notice Receive LP tokens as output from a swap.
    function test_lpToken_asOutput_succeeds() public {
        // Create LP token as output
        MockERC20 lpToken = new MockERC20("UNI-V2 LP", "UNI-V2", 18);

        // Fund router with LP tokens (output)
        MockERC20(address(lpToken)).mint(address(router), INITIAL_BALANCE * 10);

        uint256 swapAmt = 100e18;
        uint256 feeAmount = (swapAmt * FEE_BPS) / 10_000;
        uint256 swapAmount = swapAmt - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(lpToken),
            swapAmt,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = lpToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            lpToken.balanceOf(recipient) - recipientBalBefore,
            expectedOut,
            "LP token output mismatch"
        );
    }

    /// @notice LP token as intermediary in a multi-hop swap: tokenA → LP token → tokenC.
    function test_lpToken_multiHop_succeeds() public {
        // Create LP token as intermediary
        MockERC20 lpToken = new MockERC20("UNI-V2 LP", "UNI-V2", 18);

        // Fund router with LP tokens (for step 1 output) and tokenC (for step 2 output)
        MockERC20(address(lpToken)).mint(address(router), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenC), INITIAL_BALANCE * 10);

        uint256 swapAmt = 100e18;
        uint256 feeAmount = (swapAmt * FEE_BPS) / 10_000;
        uint256 swapAmount = swapAmt - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwapRequest(
            address(tokenA),
            address(lpToken),
            address(tokenC),
            swapAmt,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = tokenC.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenC.balanceOf(recipient) - recipientBalBefore,
            step2Out,
            "multi-hop LP output mismatch"
        );
    }

    /// @notice Verify LP token swap correctly deducts fee and transfers to treasury.
    function test_lpToken_swapFeeDeduction() public {
        MockERC20 lpToken = new MockERC20("UNI-V2 LP", "UNI-V2", 18);
        _fundAndApprove(address(lpToken), user, INITIAL_BALANCE);
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);

        uint256 swapAmt = 50e18;
        uint256 feeAmount = (swapAmt * FEE_BPS) / 10_000;
        uint256 swapAmount = swapAmt - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(lpToken),
            address(tokenB),
            swapAmt,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 treasuryBalBefore = lpToken.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify fee was sent to treasury
        assertEq(
            lpToken.balanceOf(treasury) - treasuryBalBefore,
            feeAmount,
            "LP token fee not sent to treasury"
        );
    }

    // ============================================================
    // C. Bridged Token Tests
    // ============================================================

    /// @notice Standard swap with a "bridged" token (simulated as MockERC20 with
    ///         bridged-style naming). Verifies the aggregator handles bridged tokens
    ///         identically to any other ERC20.
    function test_bridgedToken_swapSucceeds() public {
        // Simulate a bridged token (e.g., bridged USDC from Ethereum)
        MockERC20 bridgedToken = new MockERC20("Bridged USDC", "bUSDC", 6);

        // Fund user with bridged tokens and approve
        MockERC20(address(bridgedToken)).mint(user, 1_000_000e6);
        vm.prank(user);
        bridgedToken.approve(address(aggregator), 1_000_000e6);

        // Fund router with tokenB output
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);

        uint256 swapAmt = 1000e6; // 1000 bridged USDC (6 decimals)
        uint256 feeAmount = (swapAmt * FEE_BPS) / 10_000;
        uint256 swapAmount = swapAmt - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(bridgedToken),
            address(tokenB),
            swapAmt,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            tokenB.balanceOf(recipient) - recipientBalBefore,
            expectedOut,
            "bridged token swap output mismatch"
        );
    }

    /// @notice Swap where the output is a bridged token — verify the aggregator
    ///         correctly delivers bridged tokens to the recipient.
    function test_bridgedToken_asOutput_succeeds() public {
        MockERC20 bridgedToken = new MockERC20("Bridged ETH", "bETH", 18);

        // Fund router with bridged tokens (output)
        MockERC20(address(bridgedToken)).mint(address(router), INITIAL_BALANCE * 10);

        uint256 swapAmt = 100e18;
        uint256 feeAmount = (swapAmt * FEE_BPS) / 10_000;
        uint256 swapAmount = swapAmt - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(bridgedToken),
            swapAmt,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = bridgedToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(
            bridgedToken.balanceOf(recipient) - recipientBalBefore,
            expectedOut,
            "bridged token output mismatch"
        );
    }

    /// @notice Fee-on-transfer token that simulates a bridged token with transfer tax.
    ///         Combines fee-on-transfer behavior (like some bridged tokens that charge
    ///         a bridge fee on each transfer) with the swap flow.
    function test_bridgedToken_feeOnTransfer_bridgedVariant() public {
        // Create a fee-on-transfer token simulating a bridged token with transfer tax
        MockFeeOnTransferToken feeBridgedToken = new MockFeeOnTransferToken(
            "Bridged TaxToken",
            "bTAX",
            18,
            300, // 3% fee
            treasury
        );

        // Fund user with fee-bridged tokens
        feeBridgedToken.mint(user, INITIAL_BALANCE);
        vm.prank(user);
        feeBridgedToken.approve(address(aggregator), INITIAL_BALANCE);

        // Fund router with tokenB output
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);

        uint256 swapAmt = 100e18;
        uint256 feeOnTransfer = (swapAmt * 300) / 10_000; // 3% fee
        uint256 receivedAfterFee = swapAmt - feeOnTransfer; // 97 tokens actually received
        uint256 protocolFee = (receivedAfterFee * FEE_BPS) / 10_000;
        uint256 swapAmount = receivedAfterFee - protocolFee;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Build request with amountIn = 100e18 but minAmountOut adjusted for fees
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(feeBridgedToken),
            address(tokenB),
            swapAmt,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        // The aggregator should have received less due to fee-on-transfer,
        // but the swap should still succeed with the actual received amount
        assertGt(
            tokenB.balanceOf(recipient) - recipientBalBefore,
            0,
            "bridged fee token swap should produce output"
        );
    }
}

/// @title ForceFeeder
/// @notice Helper contract to force-send native DOGE via selfdestruct.
///         Needed because normal transfers to the aggregator revert via receive().
contract ForceFeeder {
    constructor() payable {}

    function forceSend(address payable target) external {
        selfdestruct(target);
    }
}
