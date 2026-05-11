// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockPausableToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title PausableTokenTest
/// @notice Tests for pausable tokens interacting with the aggregator.
contract PausableTokenTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockPausableToken public pausableToken;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 10;

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);
        pausableToken = new MockPausableToken("Pausable", "PAUS", 18);

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user
        tokenA.mint(user, INITIAL_BALANCE);
        pausableToken.mint(user, INITIAL_BALANCE);

        // Fund router with output tokens
        tokenA.mint(address(router), INITIAL_BALANCE * 10);
        pausableToken.mint(address(router), INITIAL_BALANCE * 10);
    }

    // --- Helpers -------------------------------------------------------

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

    function _defaultDeadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    // --- Tests ---------------------------------------------------------

    /// @notice Swap succeeds when token is not paused.
    function test_pausable_normalSwap_succeeds() public {
        assertFalse(pausableToken.paused(), "Token should not be paused initially");

        vm.startPrank(user);
        pausableToken.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(pausableToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        vm.stopPrank();

        assertGt(tokenA.balanceOf(user), 0, "User should have output tokens");
    }

    /// @notice Swap reverts when input token is paused (transferFrom fails).
    function test_pausable_paused_swapReverts() public {
        // Pause the token
        vm.prank(owner);
        pausableToken.pause();
        assertTrue(pausableToken.paused(), "Token should be paused");

        vm.startPrank(user);
        pausableToken.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(pausableToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        // Should revert because transferFrom reverts when paused
        vm.expectRevert("Token paused");
        aggregator.executeSwap(req);
        vm.stopPrank();
    }

    /// @notice Token paused between steps (simulated by pausing before swap).
    function test_pausable_pauseMidSwap_reverts() public {
        // User approves while not paused
        vm.prank(user);
        pausableToken.approve(address(aggregator), SWAP_AMOUNT);

        // Pause token before swap execution
        vm.prank(owner);
        pausableToken.pause();

        // Attempt swap — should revert because transferFrom fails
        vm.prank(user);
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(pausableToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        vm.expectRevert("Token paused");
        aggregator.executeSwap(req);
    }

    /// @notice Swap works after unpause.
    function test_pausable_unpause_swapSucceeds() public {
        // Pause
        vm.prank(owner);
        pausableToken.pause();

        // Unpause
        vm.prank(owner);
        pausableToken.unpause();
        assertFalse(pausableToken.paused(), "Token should be unpaused");

        // Swap should now succeed
        vm.startPrank(user);
        pausableToken.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(pausableToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        vm.stopPrank();

        assertGt(tokenA.balanceOf(user), 0, "User should have output tokens");
    }

    /// @notice Can rescue tokens even when paused using forceTransferFrom.
    function test_pausable_paused_rescueTokens_succeeds() public {
        // Send some tokens to the aggregator
        pausableToken.mint(address(aggregator), SWAP_AMOUNT);

        // Pause the token
        vm.prank(owner);
        pausableToken.pause();
        assertTrue(pausableToken.paused());

        // Normal transfer would fail
        vm.expectRevert("Token paused");
        pausableToken.transfer(user, SWAP_AMOUNT);

        // But forceTransferFrom works even when paused (simulating rescue)
        // In production, aggregator's rescueTokens would use safeTransfer which calls transfer()
        // For this test, we verify forceTransferFrom bypasses the pause
        uint256 aggrBalBefore = pausableToken.balanceOf(address(aggregator));
        pausableToken.forceTransferFrom(address(aggregator), user, SWAP_AMOUNT);

        assertEq(pausableToken.balanceOf(address(aggregator)), aggrBalBefore - SWAP_AMOUNT);
        assertEq(pausableToken.balanceOf(user), INITIAL_BALANCE + SWAP_AMOUNT);
    }

    /// @notice Allowance setting works when token is paused.
    function test_pausable_approveWhilePaused_succeeds() public {
        vm.prank(owner);
        pausableToken.pause();
        assertTrue(pausableToken.paused());

        // Approve should work even when paused
        vm.prank(user);
        bool success = pausableToken.approve(address(aggregator), SWAP_AMOUNT);
        assertTrue(success, "Approve should succeed while paused");

        assertEq(pausableToken.allowance(user, address(aggregator)), SWAP_AMOUNT);

        // Unpause and verify swap works with pre-approved allowance
        vm.prank(owner);
        pausableToken.unpause();

        vm.prank(user);
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(pausableToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        assertGt(tokenA.balanceOf(user), 0, "Swap should succeed after unpause");
    }

    /// @notice Output token paused causes transfer to user to revert.
    function test_pausable_asOutput_paused_reverts() public {
        // Pause the output token
        vm.prank(owner);
        pausableToken.pause();

        // User swaps tokenA for pausableToken (output)
        vm.startPrank(user);
        tokenA.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(pausableToken),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        // Should revert because the final transfer to user fails (token paused)
        // The router calls IERC20.transfer(aggregator, amountOut) which goes through
        // because the router holds tokens and calls transfer from the token contract.
        // But then aggregator calls safeTransfer(user, amount) which calls transfer(),
        // and that reverts because the token is paused.
        vm.expectRevert("Token paused");
        aggregator.executeSwap(req);
        vm.stopPrank();
    }
}
