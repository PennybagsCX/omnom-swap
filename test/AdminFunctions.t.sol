// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title AdminFunctionsTest
/// @notice Comprehensive tests for admin functions: refundUser, rescueTokens,
///         transferOwnership, router removal timelock, and pause/unpause.
contract AdminFunctionsTest is Test {
    // Mirror events from OmnomSwapAggregator for vm.expectEmit
    event UserRefunded(address indexed user, address indexed token, uint256 amount, address indexed refundRecipient);
    event TokensRescued(address indexed token, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public nonOwner = address(0x400);
    address public recipient = address(0x500);
    address public newOwner = address(0x600);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 25; // 0.25%

    // Storage slot for protocolBalance mapping (slot 7 in the aggregator)
    // Layout: _status(0), owner(1), treasury(2), protocolFeeBps(3), paused(4),
    //         supportedRouters(5), routerList(6), protocolBalance(7), pendingRouterRemoval(8)
    uint256 constant PROTOCOL_BALANCE_SLOT = 7;

    // --- Helpers ------------------------------------------------------

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _setProtocolBalance(address token, uint256 amount) internal {
        bytes32 slot = keccak256(abi.encode(token, PROTOCOL_BALANCE_SLOT));
        vm.store(address(aggregator), slot, bytes32(amount));
    }

    function _getProtocolBalance(address token) internal view returns (uint256) {
        bytes32 slot = keccak256(abi.encode(token, PROTOCOL_BALANCE_SLOT));
        return uint256(vm.load(address(aggregator), slot));
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

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);

        // Fund router with output tokens
        tokenB.mint(address(router), INITIAL_BALANCE * 10);
    }

    // ===================================================================
    // A. refundUser() Tests
    // ===================================================================

    function test_refundUser_succeeds() public {
        uint256 refundAmount = 500e18;

        // Mint tokens to aggregator and set protocolBalance
        tokenA.mint(address(aggregator), refundAmount);
        _setProtocolBalance(address(tokenA), refundAmount);

        uint256 userBalBefore = tokenA.balanceOf(user);

        vm.prank(owner);
        aggregator.refundUser(user, address(tokenA), refundAmount);

        assertEq(tokenA.balanceOf(user) - userBalBefore, refundAmount, "user should receive refunded tokens");
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "aggregator should have no tokens after refund");
    }

    function test_refundUser_insufficientBalance_reverts() public {
        uint256 refundAmount = 500e18;

        // Set protocolBalance but don't mint enough tokens
        _setProtocolBalance(address(tokenA), 100e18);

        vm.prank(owner);
        vm.expectRevert("Insufficient balance");
        aggregator.refundUser(user, address(tokenA), refundAmount);
    }

    function test_refundUser_zeroAmount_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Amount must be greater than zero");
        aggregator.refundUser(user, address(tokenA), 0);
    }

    function test_refundUser_notOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.refundUser(user, address(tokenA), 100e18);
    }

    function test_refundUser_emitsEvent() public {
        uint256 refundAmount = 300e18;

        tokenA.mint(address(aggregator), refundAmount);
        _setProtocolBalance(address(tokenA), refundAmount);

        vm.expectEmit(true, true, true, true);
        emit UserRefunded(user, address(tokenA), refundAmount, user);

        vm.prank(owner);
        aggregator.refundUser(user, address(tokenA), refundAmount);
    }

    function test_refundUser_exactProtocolBalance() public {
        uint256 refundAmount = 1000e18;

        tokenA.mint(address(aggregator), refundAmount);
        _setProtocolBalance(address(tokenA), refundAmount);

        vm.prank(owner);
        aggregator.refundUser(user, address(tokenA), refundAmount);

        // Protocol balance should now be 0
        assertEq(_getProtocolBalance(address(tokenA)), 0, "protocolBalance should be 0 after full refund");
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "aggregator should have 0 tokens");
    }

    // ===================================================================
    // B. rescueTokens() Tests
    // ===================================================================

    function test_rescueTokens_succeeds() public {
        uint256 rescueAmount = 500e18;
        tokenA.mint(address(aggregator), rescueAmount);

        uint256 ownerBalBefore = tokenA.balanceOf(owner);

        vm.prank(owner);
        aggregator.rescueTokens(address(tokenA), rescueAmount);

        assertEq(tokenA.balanceOf(owner) - ownerBalBefore, rescueAmount, "owner should receive rescued tokens");
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "aggregator should have no tokens");
    }

    function test_rescueTokens_protectsProtocolBalance() public {
        uint256 totalAmount = 1000e18;
        uint256 protocolAmt = 300e18;

        // Mint tokens and set protocolBalance
        tokenA.mint(address(aggregator), totalAmount);
        _setProtocolBalance(address(tokenA), protocolAmt);

        // Try to rescue more than (totalBalance - protocolBalance)
        // totalBalance = 1000, protocolBalance = 300, withdrawable = 700
        vm.prank(owner);
        vm.expectRevert("Exceeds withdrawable");
        aggregator.rescueTokens(address(tokenA), 701e18);
    }

    function test_rescueTokens_notOwner_reverts() public {
        tokenA.mint(address(aggregator), 100e18);

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.rescueTokens(address(tokenA), 100e18);
    }

    function test_rescueTokens_emitsEvent() public {
        uint256 rescueAmount = 200e18;
        tokenA.mint(address(aggregator), rescueAmount);

        vm.expectEmit(true, true, false, false);
        emit TokensRescued(address(tokenA), rescueAmount);

        vm.prank(owner);
        aggregator.rescueTokens(address(tokenA), rescueAmount);
    }

    // ===================================================================
    // C. transferOwnership() Tests
    // ===================================================================

    function test_transferOwnership_succeeds() public {
        vm.prank(owner);
        aggregator.transferOwnership(newOwner);

        assertEq(aggregator.owner(), newOwner, "ownership should transfer");
    }

    function test_transferOwnership_zeroAddress_reverts() public {
        vm.prank(owner);
        vm.expectRevert("New owner is zero address");
        aggregator.transferOwnership(address(0));
    }

    function test_transferOwnership_notOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.transferOwnership(newOwner);
    }

    function test_transferOwnership_emitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, newOwner);

        vm.prank(owner);
        aggregator.transferOwnership(newOwner);
    }

    function test_transferOwnership_newOwnerCanAdmin() public {
        vm.prank(owner);
        aggregator.transferOwnership(newOwner);

        // New owner can pause
        vm.prank(newOwner);
        aggregator.pause();
        assertTrue(aggregator.paused(), "new owner should be able to pause");

        // New owner can unpause
        vm.prank(newOwner);
        aggregator.unpause();
        assertFalse(aggregator.paused(), "new owner should be able to unpause");

        // Old owner can no longer admin
        vm.prank(owner);
        vm.expectRevert("Not owner");
        aggregator.pause();
    }

    // ===================================================================
    // D. Router Removal Timelock
    // ===================================================================

    function test_routerRemoval_initiate() public {
        vm.prank(owner);
        aggregator.removeRouter(address(router));

        // Pending timestamp should be set
        uint256 pendingUntil = aggregator.pendingRouterRemoval(address(router));
        assertGt(pendingUntil, 0, "pending timestamp should be set");
        assertEq(pendingUntil, block.timestamp + aggregator.ROUTER_REMOVAL_DELAY(), "pending timestamp should be now + delay");

        // Router should still be supported until confirmed
        assertTrue(aggregator.supportedRouters(address(router)), "router still supported until confirmed");
    }

    function test_routerRemoval_confirmAfterDelay() public {
        vm.prank(owner);
        aggregator.removeRouter(address(router));

        // Warp past the delay
        vm.warp(block.timestamp + aggregator.ROUTER_REMOVAL_DELAY() + 1);

        vm.prank(owner);
        aggregator.confirmRouterRemoval(address(router));

        assertFalse(aggregator.supportedRouters(address(router)), "router should be removed");
        assertEq(aggregator.getRouterCount(), 0, "router count should be 0");
        assertEq(aggregator.pendingRouterRemoval(address(router)), 0, "pending should be cleared");
    }

    function test_routerRemoval_confirmBeforeDelay_reverts() public {
        vm.prank(owner);
        aggregator.removeRouter(address(router));

        // Warp to just before the delay
        vm.warp(block.timestamp + aggregator.ROUTER_REMOVAL_DELAY() - 1);

        vm.prank(owner);
        vm.expectRevert("Too early");
        aggregator.confirmRouterRemoval(address(router));
    }

    function test_routerRemoval_confirmAtExactDelay() public {
        vm.prank(owner);
        aggregator.removeRouter(address(router));

        // Warp to exactly the delay
        uint256 exactTime = aggregator.pendingRouterRemoval(address(router));
        vm.warp(exactTime);

        vm.prank(owner);
        aggregator.confirmRouterRemoval(address(router));

        assertFalse(aggregator.supportedRouters(address(router)), "router should be removed at exact delay");
    }

    function test_routerRemoval_notOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.removeRouter(address(router));
    }

    function test_routerRemoval_reAddRouter_resetsPending() public {
        // Initiate removal
        vm.startPrank(owner);
        aggregator.removeRouter(address(router));

        // Confirm pending is set
        assertGt(aggregator.pendingRouterRemoval(address(router)), 0);

        // Remove the router (confirm after delay)
        vm.warp(block.timestamp + aggregator.ROUTER_REMOVAL_DELAY() + 1);
        aggregator.confirmRouterRemoval(address(router));

        assertFalse(aggregator.supportedRouters(address(router)));

        // Re-add the router
        aggregator.addRouter(address(router));

        assertTrue(aggregator.supportedRouters(address(router)), "router should be re-added");
        assertEq(aggregator.pendingRouterRemoval(address(router)), 0, "pending should be reset");
        vm.stopPrank();
    }

    // ===================================================================
    // E. Pause / Unpause
    // ===================================================================

    function test_pause_succeeds() public {
        vm.prank(owner);
        aggregator.pause();

        assertTrue(aggregator.paused(), "contract should be paused");
    }

    function test_pause_swapReverts() public {
        vm.prank(owner);
        aggregator.pause();

        uint256 feeAmount = (SWAP_AMOUNT * FEE_BPS) / 10_000;
        uint256 swapAmount = SWAP_AMOUNT - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Paused");
        aggregator.executeSwap(req);
    }

    function test_unpause_succeeds() public {
        vm.startPrank(owner);
        aggregator.pause();
        aggregator.unpause();
        vm.stopPrank();

        assertFalse(aggregator.paused(), "contract should be unpaused");
    }

    function test_unpause_swapSucceeds() public {
        // Pause and unpause
        vm.startPrank(owner);
        aggregator.pause();
        aggregator.unpause();
        vm.stopPrank();

        // Swap should work after unpause
        uint256 feeAmount = (SWAP_AMOUNT * FEE_BPS) / 10_000;
        uint256 swapAmount = SWAP_AMOUNT - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 recipientBalBefore = tokenB.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient) - recipientBalBefore, expectedOut, "swap should succeed after unpause");
    }

    function test_pause_notOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        aggregator.pause();
    }
}
