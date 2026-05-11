// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUpgradeableToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title UpgradeableTokenTest
/// @notice Tests for upgradeable tokens (proxy pattern) interacting with the aggregator.
contract UpgradeableTokenTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    SimpleProxy public proxy;
    UpgradeableTokenV1 public v1;
    UpgradeableTokenV2 public v2;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public feeRecipient = address(0x600);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 10;

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);

        // Deploy V1 implementation and proxy
        v1 = new UpgradeableTokenV1();
        proxy = new SimpleProxy(address(v1));

        // Initialize the token through the proxy
        UpgradeableTokenV1(address(proxy)).initialize("Upgradeable", "UGTD", 18);

        // Deploy V2 implementation (not yet upgraded)
        v2 = new UpgradeableTokenV2();

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user through proxy
        UpgradeableTokenV1(address(proxy)).mint(user, INITIAL_BALANCE);
        tokenA.mint(user, INITIAL_BALANCE);

        // Fund router with output tokens
        tokenA.mint(address(router), INITIAL_BALANCE * 10);
        UpgradeableTokenV1(address(proxy)).mint(address(router), INITIAL_BALANCE * 10);
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
    ) internal pure returns (OmnomSwapAggregator.SwapRequest memory) {
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

    /// @notice Swap with V1 (standard) implementation succeeds.
    function test_upgradeable_v1_swapSucceeds() public {
        // Verify we're on V1
        assertEq(UpgradeableTokenV1(address(proxy)).version(), "V1");

        vm.startPrank(user);
        UpgradeableTokenV1(address(proxy)).approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(proxy),
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

    /// @notice Upgrade to V2 and swap still succeeds.
    function test_upgradeable_upgradeToV2_swapSucceeds() public {
        // Upgrade to V2 (admin only)
        vm.prank(owner);
        proxy.upgradeTo(address(v2));
        assertEq(proxy.getImplementation(), address(v2));
        assertEq(UpgradeableTokenV2(address(proxy)).version(), "V2");

        // Configure V2 fee
        UpgradeableTokenV2(address(proxy)).setFee(100, feeRecipient); // 1% fee

        vm.startPrank(user);
        UpgradeableTokenV2(address(proxy)).approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(proxy),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0, // minAmountOut = 0 to allow for fee deduction
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        vm.stopPrank();

        assertGt(tokenA.balanceOf(user), 0, "User should have output tokens");
    }

    /// @notice After upgrade to V2, fee-on-transfer behavior is active.
    function test_upgradeable_v2_feeApplied() public {
        // Do a V1 swap first to get baseline
        vm.startPrank(user);
        UpgradeableTokenV1(address(proxy)).approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory reqV1 = _buildSingleSwap(
            address(proxy),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(reqV1);
        uint256 v1Output = tokenA.balanceOf(user);
        vm.stopPrank();

        // Reset: mint more tokens to user for second swap
        UpgradeableTokenV1(address(proxy)).mint(user, SWAP_AMOUNT);

        // Upgrade to V2 with 1% fee
        vm.prank(owner);
        proxy.upgradeTo(address(v2));
        UpgradeableTokenV2(address(proxy)).setFee(100, feeRecipient); // 1% fee

        // Do V2 swap
        vm.startPrank(user);
        UpgradeableTokenV2(address(proxy)).approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory reqV2 = _buildSingleSwap(
            address(proxy),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(reqV2);
        uint256 v2Output = tokenA.balanceOf(user) - v1Output;
        vm.stopPrank();

        // V2 output should be LESS than V1 output because V2 deducts transfer fee
        // V1: received = SWAP_AMOUNT, fee = SWAP_AMOUNT * 10 / 10000, swapAmount = SWAP_AMOUNT - fee
        // V2: received = SWAP_AMOUNT - 1% = SWAP_AMOUNT * 0.99, fee = received * 10 / 10000, swapAmount = received - fee
        assertLt(v2Output, v1Output, "V2 output should be less due to transfer fee");

        // Verify fee recipient received fees from V2 transfers
        assertGt(
            UpgradeableTokenV2(address(proxy)).balanceOf(feeRecipient),
            0,
            "Fee recipient should have fees"
        );
    }

    /// @notice Balances are preserved across upgrade.
    function test_upgradeable_storagePreserved() public {
        // Record balances before upgrade
        uint256 userBalBefore = UpgradeableTokenV1(address(proxy)).balanceOf(user);
        uint256 totalSupplyBefore = UpgradeableTokenV1(address(proxy)).totalSupply();

        // Upgrade to V2
        vm.prank(owner);
        proxy.upgradeTo(address(v2));

        // Verify balances preserved
        assertEq(
            UpgradeableTokenV2(address(proxy)).balanceOf(user),
            userBalBefore,
            "User balance should be preserved"
        );
        assertEq(
            UpgradeableTokenV2(address(proxy)).totalSupply(),
            totalSupplyBefore,
            "Total supply should be preserved"
        );

        // Verify name/symbol/decimals preserved
        assertEq(UpgradeableTokenV2(address(proxy)).name(), "Upgradeable");
        assertEq(UpgradeableTokenV2(address(proxy)).symbol(), "UGTD");
        assertEq(UpgradeableTokenV2(address(proxy)).decimals(), 18);
    }

    /// @notice Allowances are preserved across upgrade.
    function test_upgradeable_allowancePreserved() public {
        // Set allowance before upgrade
        vm.prank(user);
        UpgradeableTokenV1(address(proxy)).approve(address(aggregator), SWAP_AMOUNT);

        uint256 allowanceBefore = UpgradeableTokenV1(address(proxy)).allowance(user, address(aggregator));
        assertEq(allowanceBefore, SWAP_AMOUNT);

        // Upgrade to V2
        vm.prank(owner);
        proxy.upgradeTo(address(v2));

        // Verify allowance preserved
        uint256 allowanceAfter = UpgradeableTokenV2(address(proxy)).allowance(user, address(aggregator));
        assertEq(allowanceAfter, SWAP_AMOUNT, "Allowance should be preserved");

        // Verify swap works with preserved allowance (no need to re-approve)
        vm.prank(user);
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(proxy),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        assertGt(tokenA.balanceOf(user), 0, "Swap should succeed with preserved allowance");
    }

    /// @notice Upgrade between swap steps (simulated) — parameters set for V1 fail under V2.
    function test_upgradeable_upgradeMidRoute_reverts() public {
        // Step 1: Swap with V1 — succeeds, user gets expected output
        vm.startPrank(user);
        UpgradeableTokenV1(address(proxy)).approve(address(aggregator), SWAP_AMOUNT * 2);

        // Calculate expected V1 output
        uint256 expectedFee = (SWAP_AMOUNT * FEE_BPS) / 10000;
        uint256 swapAmount = SWAP_AMOUNT - expectedFee;
        uint256 expectedV1Output = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory reqV1 = _buildSingleSwap(
            address(proxy),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            expectedV1Output, // minAmountOut based on V1 (no transfer fee)
            address(router),
            user,
            _defaultDeadline()
        );

        // V1 swap succeeds
        aggregator.executeSwap(reqV1);
        vm.stopPrank();

        // Mint more tokens for second swap
        UpgradeableTokenV1(address(proxy)).mint(user, SWAP_AMOUNT);

        // Upgrade to V2 with 5% fee
        vm.prank(owner);
        proxy.upgradeTo(address(v2));
        UpgradeableTokenV2(address(proxy)).setFee(500, feeRecipient); // 5% fee

        // Step 2: Try swap with same V1 expectations — should fail because V2 deducts fee
        vm.startPrank(user);
        UpgradeableTokenV2(address(proxy)).approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory reqV2 = _buildSingleSwap(
            address(proxy),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            expectedV1Output, // Same minAmountOut as V1 — too high for V2
            address(router),
            user,
            _defaultDeadline()
        );

        // Should revert because V2 fee reduces the output below expectedV1Output
        vm.expectRevert();
        aggregator.executeSwap(reqV2);
        vm.stopPrank();
    }
}
