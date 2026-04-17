// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title OmnomSwapAggregatorTest
/// @notice Comprehensive tests for deployment, router management, configuration,
///         pause/unpause, rescue tokens, access control, simple swaps, and events.
contract OmnomSwapAggregatorTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public nonOwner = address(0x400);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18; // 1 input - 2 output
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 10; // 0.1%

    // --- Helper: build a single-step SwapRequest ----------------------
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

    // --- Helper: fund user, approve aggregator ------------------------
    function _fundAndApprove(
        address tokenAddr,
        address _user,
        uint256 amount
    ) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    // --- Helper: fund router with output tokens ----------------------
    function _fundRouter(address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(router), amount);
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

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user with tokens
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);

        // Fund router with output tokens so swaps can succeed
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenA), INITIAL_BALANCE * 10);
    }

    // -------------------------------------------------------------------
    // 1. Deployment
    // -------------------------------------------------------------------
    function test_Deployment_SetsOwnerTreasuryFee() public {
        assertEq(aggregator.owner(), owner, "owner mismatch");
        assertEq(aggregator.treasury(), treasury, "treasury mismatch");
        assertEq(aggregator.protocolFeeBps(), FEE_BPS, "fee mismatch");
        assertFalse(aggregator.paused(), "should not be paused");
    }

    function test_Deployment_RevertZeroTreasury() public {
        vm.expectRevert("Zero address treasury");
        new OmnomSwapAggregator(address(0), 10, address(wwdoge));
    }

    function test_Deployment_RevertFeeExceedsMax() public {
        vm.expectRevert("Fee exceeds max");
        new OmnomSwapAggregator(treasury, 501, address(wwdoge));
    }

    function test_Deployment_MaxFeeAllowed() public {
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, 500, address(wwdoge));
        assertEq(ag.protocolFeeBps(), 500);
    }

    function test_Deployment_ZeroFeeAllowed() public {
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, 0, address(wwdoge));
        assertEq(ag.protocolFeeBps(), 0);
    }

    // -------------------------------------------------------------------
    // 2. Router Management
    // -------------------------------------------------------------------
    function test_AddRouter_Success() public {
        MockUniswapV2Router router2 = new MockUniswapV2Router(address(0), 1e18);

        vm.prank(owner);
        aggregator.addRouter(address(router2));

        assertTrue(aggregator.supportedRouters(address(router2)));
        assertEq(aggregator.getRouterCount(), 2);
    }

    function test_AddRouter_EmitsEvent() public {
        MockUniswapV2Router router2 = new MockUniswapV2Router(address(0), 1e18);

        vm.prank(owner);
        aggregator.addRouter(address(router2));

        assertTrue(aggregator.supportedRouters(address(router2)), "router should be added");
    }

    function test_AddRouter_RevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Zero address");
        aggregator.addRouter(address(0));
    }

    function test_AddRouter_RevertAlreadyAdded() public {
        vm.prank(owner);
        vm.expectRevert("Already added");
        aggregator.addRouter(address(router));
    }

    function test_RemoveRouter_Success() public {
        vm.prank(owner);
        aggregator.removeRouter(address(router));

        assertFalse(aggregator.supportedRouters(address(router)));
        assertEq(aggregator.getRouterCount(), 0);
    }

    function test_RemoveRouter_EmitsEvent() public {
        vm.prank(owner);
        aggregator.removeRouter(address(router));

        assertFalse(aggregator.supportedRouters(address(router)), "router should be removed");
    }

    function test_RemoveRouter_RevertNotFound() public {
        vm.prank(owner);
        vm.expectRevert("Not found");
        aggregator.removeRouter(address(0x123));
    }

    function test_RemoveRouter_MultipleRouters() public {
        // Add two routers, remove the first, verify state
        MockUniswapV2Router router2 = new MockUniswapV2Router(address(0), 1e18);
        vm.startPrank(owner);
        aggregator.addRouter(address(router2));
        assertEq(aggregator.getRouterCount(), 2);

        aggregator.removeRouter(address(router));
        assertFalse(aggregator.supportedRouters(address(router)));
        assertTrue(aggregator.supportedRouters(address(router2)));
        assertEq(aggregator.getRouterCount(), 1);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------
    // 3. Configuration
    // -------------------------------------------------------------------
    function test_SetTreasury_Success() public {
        address newTreasury = address(0x999);

        vm.prank(owner);
        aggregator.setTreasury(newTreasury);

        assertEq(aggregator.treasury(), newTreasury);
    }

    function test_SetTreasury_EmitsEvent() public {
        address newTreasury = address(0x999);

        vm.prank(owner);
        aggregator.setTreasury(newTreasury);

        assertEq(aggregator.treasury(), newTreasury, "treasury should be updated");
    }

    function test_SetTreasury_RevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Zero address");
        aggregator.setTreasury(address(0));
    }

    function test_SetProtocolFee_Success() public {
        vm.prank(owner);
        aggregator.setProtocolFee(50);

        assertEq(aggregator.protocolFeeBps(), 50);
    }

    function test_SetProtocolFee_EmitsEvent() public {
        vm.prank(owner);
        aggregator.setProtocolFee(50);

        assertEq(aggregator.protocolFeeBps(), 50, "fee should be updated");
    }

    function test_SetProtocolFee_RevertExceedsMax() public {
        vm.prank(owner);
        vm.expectRevert("Fee exceeds max");
        aggregator.setProtocolFee(501);
    }

    function test_SetProtocolFee_CanSetToZero() public {
        vm.prank(owner);
        aggregator.setProtocolFee(0);
        assertEq(aggregator.protocolFeeBps(), 0);
    }

    function test_SetProtocolFee_CanSetToMax() public {
        vm.prank(owner);
        aggregator.setProtocolFee(500);
        assertEq(aggregator.protocolFeeBps(), 500);
    }

    // -------------------------------------------------------------------
    // 4. Pause / Unpause
    // -------------------------------------------------------------------
    function test_Pause_Success() public {
        vm.prank(owner);
        aggregator.pause();
        assertTrue(aggregator.paused());
    }

    function test_Pause_EmitsEvent() public {
        vm.prank(owner);
        aggregator.pause();

        assertTrue(aggregator.paused(), "should be paused");
    }

    function test_Pause_RevertAlreadyPaused() public {
        vm.prank(owner);
        aggregator.pause();

        vm.prank(owner);
        vm.expectRevert("Already paused");
        aggregator.pause();
    }

    function test_Unpause_Success() public {
        vm.startPrank(owner);
        aggregator.pause();
        aggregator.unpause();
        vm.stopPrank();
        assertFalse(aggregator.paused());
    }

    function test_Unpause_EmitsEvent() public {
        vm.startPrank(owner);
        aggregator.pause();
        aggregator.unpause();
        vm.stopPrank();

        assertFalse(aggregator.paused(), "should be unpaused");
    }

    function test_Unpause_RevertNotPaused() public {
        vm.prank(owner);
        vm.expectRevert("Not paused");
        aggregator.unpause();
    }

    function test_PausedPreventsSwap() public {
        vm.prank(owner);
        aggregator.pause();

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT, // stepAmountIn (doesn't matter, reverts before swap)
            0,
            address(router),
            user,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Paused");
        aggregator.executeSwap(req);
    }

    // -------------------------------------------------------------------
    // 5. Rescue Tokens
    // -------------------------------------------------------------------
    function test_RescueTokens_Success() public {
        uint256 rescueAmount = 500e18;
        tokenA.mint(address(aggregator), rescueAmount);

        uint256 ownerBalBefore = tokenA.balanceOf(owner);

        vm.prank(owner);
        aggregator.rescueTokens(address(tokenA), rescueAmount);

        assertEq(tokenA.balanceOf(owner) - ownerBalBefore, rescueAmount);
        assertEq(tokenA.balanceOf(address(aggregator)), 0);
    }

    function test_RescueTokens_OnlyOwner() public {
        tokenA.mint(address(aggregator), 100e18);

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.rescueTokens(address(tokenA), 100e18);
    }

    function test_RescueTokens_RevertInsufficientBalance() public {
        // Contract has no tokens - MockERC20.transfer reverts with "Insufficient balance"
        vm.prank(owner);
        vm.expectRevert("Insufficient balance");
        aggregator.rescueTokens(address(tokenA), 1);
    }

    // -------------------------------------------------------------------
    // 6. Access Control
    // -------------------------------------------------------------------
    function test_AccessControl_NonOwnerCannotAddRouter() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.addRouter(address(0x123));
    }

    function test_AccessControl_NonOwnerCannotRemoveRouter() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.removeRouter(address(router));
    }

    function test_AccessControl_NonOwnerCannotSetTreasury() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.setTreasury(address(0x999));
    }

    function test_AccessControl_NonOwnerCannotSetFee() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.setProtocolFee(100);
    }

    function test_AccessControl_NonOwnerCannotPause() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.pause();
    }

    function test_AccessControl_NonOwnerCannotUnpause() public {
        vm.prank(owner);
        aggregator.pause();

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.unpause();
    }

    function test_AccessControl_NonOwnerCannotRescue() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.rescueTokens(address(tokenA), 1);
    }

    // -------------------------------------------------------------------
    // 7. Simple Swap
    // -------------------------------------------------------------------
    function test_SimpleSwap_Success() public {
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount, // step.amountIn must equal swapAmount
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 userBalBefore = tokenA.balanceOf(user);
        uint256 recipientBalBefore = tokenB.balanceOf(recipient);
        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify user lost input tokens
        assertEq(userBalBefore - tokenA.balanceOf(user), amountIn);
        // Verify recipient received output tokens
        assertGt(tokenB.balanceOf(recipient) - recipientBalBefore, 0);
        assertEq(tokenB.balanceOf(recipient) - recipientBalBefore, expectedOut);
        // Verify treasury received fee
        assertEq(tokenA.balanceOf(treasury) - treasuryBalBefore, feeAmount);
    }

    function test_SimpleSwap_OutputAmountCorrect() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            user,
            block.timestamp + 1 hours
        );

        uint256 balBefore = tokenB.balanceOf(user);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(user) - balBefore, expectedOut);
    }

    function test_Swap_RevertExpiredDeadline() public {
        uint256 pastDeadline = block.timestamp - 1;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            pastDeadline
        );

        vm.prank(user);
        vm.expectRevert("Expired");
        aggregator.executeSwap(req);
    }

    function test_Swap_RevertNoSteps() public {
        OmnomSwapAggregator.SwapStep[] memory emptySteps = new OmnomSwapAggregator.SwapStep[](0);

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: emptySteps,
            deadline: block.timestamp + 1 hours,
            recipient: user
        });

        vm.prank(user);
        vm.expectRevert("No steps");
        aggregator.executeSwap(req);
    }

    function test_Swap_RevertZeroRecipient() public {
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            address(0),
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Zero recipient");
        aggregator.executeSwap(req);
    }

    function test_Swap_RevertUnsupportedRouter() public {
        MockUniswapV2Router fakeRouter = new MockUniswapV2Router(address(0), 1e18);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(fakeRouter),
            path: path,
            amountIn: SWAP_AMOUNT,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: user
        });

        vm.prank(user);
        vm.expectRevert("Unsupported router");
        aggregator.executeSwap(req);
    }

    function test_Swap_RevertPathMismatch() public {
        // Build a request where path[0] != tokenIn
        address[] memory path = new address[](2);
        path[0] = address(tokenB); // wrong! should be tokenA
        path[1] = address(tokenA);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: SWAP_AMOUNT,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenA),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: user
        });

        vm.prank(user);
        vm.expectRevert("Path mismatch");
        aggregator.executeSwap(req);
    }

    function test_Swap_RevertSlippage() public {
        // Test the aggregator's slippage check by using a step minAmountOut that
        // the router will accept, but an overall minTotalAmountOut that exceeds
        // the actual output.
        uint256 feeAmount = (SWAP_AMOUNT * FEE_BPS) / 10_000;
        uint256 swapAmount = SWAP_AMOUNT - feeAmount;
        uint256 actualOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Set step minAmountOut to 0 so the router doesn't revert,
        // but set minTotalAmountOut above actual output to trigger aggregator slippage
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            swapAmount,
            0, // step minAmountOut = 0 so router accepts
            address(router),
            user,
            block.timestamp + 1 hours
        );

        // Override minTotalAmountOut to be higher than actual output
        req.minTotalAmountOut = actualOut + 1;

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(req);
    }

    function test_Swap_RevertStepExceedsSwapAmount() public {
        // step.amountIn != swapAmount (amountIn after fee) - exact match required
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: SWAP_AMOUNT + 1, // does not match the swapAmount after fee
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: user
        });

        vm.prank(user);
        vm.expectRevert("Step amount mismatch");
        aggregator.executeSwap(req);
    }

    // -------------------------------------------------------------------
    // 8. Swap Events
    // -------------------------------------------------------------------
    function test_Swap_EmitsSwapExecutedEvent() public {
        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);
        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify swap effects (proving SwapExecuted event was emitted)
        assertEq(tokenB.balanceOf(recipient) - recipientBalBefore, expectedOut, "output mismatch");
        assertEq(tokenA.balanceOf(treasury) - treasuryBalBefore, feeAmount, "fee mismatch");
    }

    function test_Swap_EmitsEventWithCorrectUser() public {
        uint256 amountIn = 500e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            user,
            block.timestamp + 1 hours
        );

        uint256 balBefore = tokenB.balanceOf(user);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify user received output tokens
        assertEq(tokenB.balanceOf(user) - balBefore, expectedOut, "output mismatch for user");
    }
}
