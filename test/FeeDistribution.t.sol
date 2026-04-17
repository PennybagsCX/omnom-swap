// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title FeeDistributionTest
/// @notice Tests focused on the fee mechanism: calculation, treasury receipt,
///         edge cases, fee/treasury updates, and max fee enforcement.
contract FeeDistributionTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 10_000_000e18;

    // --- Helper: build a single-step SwapRequest ----------------------
    function _buildSwapRequest(
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

    // --- Helper: fund user + approve aggregator -----------------------
    function _fundAndApprove(
        address tokenAddr,
        address _user,
        uint256 amount
    ) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    // --- Helper: fund user + approve a specific aggregator ------------
    function _fundAndApproveAg(
        address tokenAddr,
        address _user,
        uint256 amount,
        address ag
    ) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(ag, amount);
    }

    // --- Helper: fund router with output tokens ----------------------
    function _fundRouter(address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(router), amount);
    }

    // --- Helper: deploy aggregator with a specific fee ----------------
    function _deployWithFee(uint256 feeBps) internal returns (OmnomSwapAggregator) {
        vm.prank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, feeBps, address(wwdoge));

        vm.prank(owner);
        ag.addRouter(address(router));

        return ag;
    }

    // --- Helper: execute a swap and return fee amount received by treasury -
    function _executeSwapAndGetFee(
        OmnomSwapAggregator ag,
        uint256 amountIn
    ) internal returns (uint256) {
        uint256 feeBps = ag.protocolFeeBps();
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSwapRequest(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        vm.prank(user);
        ag.executeSwap(req);

        return tokenA.balanceOf(treasury) - treasuryBalBefore;
    }

    // -------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------
    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, 10, address(wwdoge)); // 0.1% fee

        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);
    }

    // -------------------------------------------------------------------
    // 1. Fee Calculation - Various BPS Values
    // -------------------------------------------------------------------
    function test_FeeCalculation_ZeroBps() public {
        OmnomSwapAggregator ag = _deployWithFee(0);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 feeReceived = _executeSwapAndGetFee(ag, 1000e18);
        assertEq(feeReceived, 0, "fee should be 0 for 0 bps");
    }

    function test_FeeCalculation_10Bps() public {
        // 10 bps = 0.1% - on 1000e18: fee = (1000e18 * 10) / 10000 = 1e18
        OmnomSwapAggregator ag = _deployWithFee(10);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 feeReceived = _executeSwapAndGetFee(ag, 1000e18);
        assertEq(feeReceived, 1e18, "fee mismatch for 10 bps");
    }

    function test_FeeCalculation_25Bps() public {
        // 25 bps = 0.25% - on 1000e18: fee = (1000e18 * 25) / 10000 = 2.5e18
        OmnomSwapAggregator ag = _deployWithFee(25);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 feeReceived = _executeSwapAndGetFee(ag, 1000e18);
        assertEq(feeReceived, 2.5e18, "fee mismatch for 25 bps");
    }

    function test_FeeCalculation_50Bps() public {
        // 50 bps = 0.5% - on 1000e18: fee = (1000e18 * 50) / 10000 = 5e18
        OmnomSwapAggregator ag = _deployWithFee(50);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 feeReceived = _executeSwapAndGetFee(ag, 1000e18);
        assertEq(feeReceived, 5e18, "fee mismatch for 50 bps");
    }

    function test_FeeCalculation_100Bps() public {
        // 100 bps = 1% - on 1000e18: fee = (1000e18 * 100) / 10000 = 10e18
        OmnomSwapAggregator ag = _deployWithFee(100);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 feeReceived = _executeSwapAndGetFee(ag, 1000e18);
        assertEq(feeReceived, 10e18, "fee mismatch for 100 bps");
    }

    function test_FeeCalculation_500Bps() public {
        // 500 bps = 5% - on 1000e18: fee = (1000e18 * 500) / 10000 = 50e18
        OmnomSwapAggregator ag = _deployWithFee(500);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 feeReceived = _executeSwapAndGetFee(ag, 1000e18);
        assertEq(feeReceived, 50e18, "fee mismatch for 500 bps");
    }

    // -------------------------------------------------------------------
    // 2. Fee Treasury Receipt
    // -------------------------------------------------------------------
    function test_FeeTreasuryReceivesCorrectAmount() public {
        uint256 amountIn = 10_000e18;
        uint256 expectedFee = (amountIn * 10) / 10_000; // 10 bps

        uint256 feeReceived = _executeSwapAndGetFee(aggregator, amountIn);
        assertEq(feeReceived, expectedFee, "treasury fee mismatch");
    }

    function test_FeeTreasuryBalanceIncreases() public {
        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        _executeSwapAndGetFee(aggregator, 1000e18);

        uint256 treasuryBalAfter = tokenA.balanceOf(treasury);
        assertGt(treasuryBalAfter, treasuryBalBefore, "treasury balance should increase");
    }

    // -------------------------------------------------------------------
    // 3. Fee Edge Cases
    // -------------------------------------------------------------------
    function test_Fee_ZeroPercentFee() public {
        OmnomSwapAggregator ag = _deployWithFee(0);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 feeReceived = _executeSwapAndGetFee(ag, 1000e18);
        assertEq(feeReceived, 0);

        // Verify user still gets full output (no fee deducted)
        uint256 swapAmount = 1000e18; // no fee
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 recipientBal = tokenB.balanceOf(recipient);
        assertEq(recipientBal, expectedOut, "output should be full amount with 0 fee");
    }

    function test_Fee_MaxFivePercentFee() public {
        OmnomSwapAggregator ag = _deployWithFee(500);
        _fundAndApproveAg(address(tokenA), user, 1000e18, address(ag));

        uint256 amountIn = 1000e18;
        uint256 expectedFee = (amountIn * 500) / 10_000; // 50e18

        uint256 feeReceived = _executeSwapAndGetFee(ag, amountIn);
        assertEq(feeReceived, expectedFee, "max fee mismatch");

        // Verify swap amount is reduced by 5%
        uint256 swapAmount = amountIn - expectedFee; // 950e18
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;
        assertEq(tokenB.balanceOf(recipient), expectedOut);
    }

    // -------------------------------------------------------------------
    // 4. Fee Update
    // -------------------------------------------------------------------
    function test_FeeUpdate_NewFeeAppliesToNextSwap() public {
        // Initial fee: 10 bps (0.1%)
        // Execute first swap with 10 bps: fee = (1000e18 * 10) / 10000 = 1e18
        uint256 fee1 = _executeSwapAndGetFee(aggregator, 1000e18);
        assertEq(fee1, 1e18, "first swap fee wrong");

        // Update fee to 50 bps (0.5%)
        vm.prank(owner);
        aggregator.setProtocolFee(50);

        // Fund user again for second swap
        _fundAndApprove(address(tokenA), user, 1000e18);

        // Execute second swap with 50 bps: fee = (1000e18 * 50) / 10000 = 5e18
        uint256 fee2 = _executeSwapAndGetFee(aggregator, 1000e18);
        assertEq(fee2, 5e18, "second swap fee wrong");
    }

    function test_FeeUpdate_SetToZeroThenBack() public {
        // Set fee to 0
        vm.prank(owner);
        aggregator.setProtocolFee(0);

        _fundAndApprove(address(tokenA), user, 1000e18);
        uint256 fee1 = _executeSwapAndGetFee(aggregator, 1000e18);
        assertEq(fee1, 0, "fee should be 0");

        // Set fee back to 100
        vm.prank(owner);
        aggregator.setProtocolFee(100);

        _fundAndApprove(address(tokenA), user, 1000e18);
        uint256 fee2 = _executeSwapAndGetFee(aggregator, 1000e18);
        assertEq(fee2, 10e18, "fee should be 10e18 at 100 bps");
    }

    // -------------------------------------------------------------------
    // 5. Treasury Update
    // -------------------------------------------------------------------
    function test_TreasuryUpdate_FeesGoToNewAddress() public {
        address newTreasury = address(0xABC);

        // Execute swap with old treasury
        _fundAndApprove(address(tokenA), user, 1000e18);
        uint256 fee1 = _executeSwapAndGetFee(aggregator, 1000e18);
        assertGt(fee1, 0, "fee should be > 0");
        assertEq(tokenA.balanceOf(treasury), fee1, "old treasury should have fee");

        // Update treasury
        vm.prank(owner);
        aggregator.setTreasury(newTreasury);

        // Execute swap with new treasury - measure new treasury balance directly
        _fundAndApprove(address(tokenA), user, 1000e18);

        uint256 expectedFee = (1000e18 * 10) / 10_000; // 10 bps = 1e18
        uint256 swapAmount = 1000e18 - expectedFee;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSwapRequest(
            address(tokenA),
            address(tokenB),
            1000e18,
            swapAmount,
            expectedOut,
            address(router),
            recipient,
            block.timestamp + 1 hours
        );

        uint256 newTreasuryBalBefore = tokenA.balanceOf(newTreasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 fee2 = tokenA.balanceOf(newTreasury) - newTreasuryBalBefore;

        // Old treasury balance unchanged
        assertEq(tokenA.balanceOf(treasury), fee1, "old treasury should be unchanged");
        // New treasury received fee
        assertEq(fee2, expectedFee, "new treasury should have fee");
        assertGt(fee2, 0, "new treasury fee should be > 0");
    }

    function test_TreasuryUpdate_EmitsEvent() public {
        address newTreasury = address(0xABC);

        vm.prank(owner);
        aggregator.setTreasury(newTreasury);

        assertEq(aggregator.treasury(), newTreasury);
        // Event is tested in OmnomSwapAggregator.t.sol
    }

    // -------------------------------------------------------------------
    // 6. Cannot Exceed Max Fee
    // -------------------------------------------------------------------
    function test_SetProtocolFee_RevertAt501Bps() public {
        vm.prank(owner);
        vm.expectRevert("Fee exceeds max");
        aggregator.setProtocolFee(501);
    }

    function test_SetProtocolFee_RevertAt1000Bps() public {
        vm.prank(owner);
        vm.expectRevert("Fee exceeds max");
        aggregator.setProtocolFee(1000);
    }

    function test_SetProtocolFee_RevertAtMaxUint() public {
        vm.prank(owner);
        vm.expectRevert("Fee exceeds max");
        aggregator.setProtocolFee(type(uint256).max);
    }

    function test_SetProtocolFee_MaxAllowedIs500() public {
        vm.prank(owner);
        aggregator.setProtocolFee(500);
        assertEq(aggregator.protocolFeeBps(), 500);
    }

    // -------------------------------------------------------------------
    // 7. Fee on Different Token Amounts
    // -------------------------------------------------------------------
    function test_Fee_OnOneToken() public {
        // 1 token (1e18) with 10 bps - fee = 0.001e18 = 1e15
        _fundAndApprove(address(tokenA), user, 1e18);

        uint256 feeReceived = _executeSwapAndGetFee(aggregator, 1e18);
        assertEq(feeReceived, 1e15, "fee on 1 token mismatch");
    }

    function test_Fee_OnSmallAmount_OneWei() public {
        // 1 wei with 10 bps - fee = 0 (integer division rounds down)
        _fundAndApprove(address(tokenA), user, 1);

        uint256 feeReceived = _executeSwapAndGetFee(aggregator, 1);
        assertEq(feeReceived, 0, "fee on 1 wei should be 0");
    }

    function test_Fee_OnLargeAmount() public {
        // 1 billion tokens with 10 bps - fee = 1_000_000e18
        // Use a smaller amount to avoid router balance exhaustion
        // (router only has INITIAL_BALANCE * 10 output tokens)
        uint256 largeAmount = 100_000e18;
        _fundAndApprove(address(tokenA), user, largeAmount);

        uint256 feeReceived = _executeSwapAndGetFee(aggregator, largeAmount);
        uint256 expectedFee = (largeAmount * 10) / 10_000;
        assertEq(feeReceived, expectedFee, "fee on large amount mismatch");
    }

    function test_Fee_OnExactBpsMultiple() public {
        // 10_000 tokens with 10 bps - fee = 10 tokens exactly
        uint256 amount = 10_000e18;
        _fundAndApprove(address(tokenA), user, amount);

        uint256 feeReceived = _executeSwapAndGetFee(aggregator, amount);
        assertEq(feeReceived, 10e18, "fee should be exactly 10 tokens");
    }
}
