// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockInflationaryToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title InflationaryTokenTest
/// @notice Tests for inflationary tokens (mint-on-transfer) interacting with the aggregator.
/// @dev Inflationary tokens mint extra tokens on EVERY transfer, including fee transfers.
///      The aggregator's balance-diff measurement correctly handles this.
contract InflationaryTokenTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockInflationaryToken public inflatedToken;
    MockInflationaryToken public inflatedTokenZero;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 10; // 0.1%

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);
        inflatedToken = new MockInflationaryToken("Inflated", "INFL", 18, 100); // 1% inflation
        inflatedTokenZero = new MockInflationaryToken("Zero Infl", "ZINF", 18, 0); // 0% inflation

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user
        tokenA.mint(user, INITIAL_BALANCE);
        inflatedToken.mint(user, INITIAL_BALANCE);
        inflatedTokenZero.mint(user, INITIAL_BALANCE);

        // Fund router with output tokens
        tokenA.mint(address(router), INITIAL_BALANCE * 10);
        inflatedToken.mint(address(router), INITIAL_BALANCE * 10);
        inflatedTokenZero.mint(address(router), INITIAL_BALANCE * 10);
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

    /// @notice Recipient receives amount + inflation bonus when output token is inflationary.
    function test_inflationary_singleHop_recipientGetsMore() public {
        uint256 userBalBefore = inflatedToken.balanceOf(user);

        // User swaps tokenA for inflatedToken (output)
        vm.startPrank(user);
        tokenA.approve(address(aggregator), SWAP_AMOUNT);

        // Calculate expected output after protocol fee
        uint256 expectedFee = (SWAP_AMOUNT * FEE_BPS) / 10000;
        uint256 swapAmt = SWAP_AMOUNT - expectedFee;
        uint256 routerOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        // Set minAmountOut to the router's calculated output (before inflation)
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(inflatedToken),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            routerOutput, // minAmountOut = router output (inflation will exceed this)
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        vm.stopPrank();

        // User should receive MORE than routerOutput due to 1% inflation on transfers
        uint256 received = inflatedToken.balanceOf(user) - userBalBefore;
        assertGt(received, routerOutput, "Should receive more due to inflation");
    }

    /// @notice Aggregator measures actual received (inflated) amount via balance diff.
    function test_inflationary_balanceDiffMeasurement() public {
        // User swaps inflatedToken (input) for tokenA
        vm.startPrank(user);
        inflatedToken.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(inflatedToken),
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

        // Verify: aggregator should have 0 inflatedToken remaining (all sent to router and treasury)
        assertEq(inflatedToken.balanceOf(address(aggregator)), 0, "Aggregator should have 0 remaining");

        // Treasury should have received fee — which includes inflation bonus from user→aggregator transfer
        // AND inflation bonus from aggregator→treasury fee transfer
        uint256 treasuryBal = inflatedToken.balanceOf(treasury);
        assertGt(treasuryBal, 0, "Treasury should have fees");

        // Fee on inflated amount should be greater than fee on base amount
        uint256 feeOnBase = (SWAP_AMOUNT * FEE_BPS) / 10000;
        assertGt(treasuryBal, feeOnBase, "Fee should exceed base fee due to inflation");
    }

    /// @notice Protocol fee is calculated on the inflated received amount.
    function test_inflationary_protocolFeeOnInflatedAmount() public {
        vm.startPrank(user);
        inflatedToken.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(inflatedToken),
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

        // The aggregator receives SWAP_AMOUNT + 1% inflation from user transfer
        // Fee is calculated on this inflated amount
        // Then the fee transfer to treasury ALSO inflates
        uint256 treasuryBal = inflatedToken.balanceOf(treasury);

        // Fee on inflated received > fee on base amount
        uint256 feeOnBase = (SWAP_AMOUNT * FEE_BPS) / 10000;
        assertGt(treasuryBal, feeOnBase, "Fee on inflated should exceed fee on base");

        // Verify the exact calculation:
        // received = SWAP_AMOUNT + SWAP_AMOUNT * 1% = 1010e18
        // feeAmount = 1010e18 * 0.1% = 1.01e18
        // treasury receives feeAmount + feeAmount * 1% = 1.01e18 + 0.0101e18 = 1.0201e18
        uint256 inflatedReceived = SWAP_AMOUNT + (SWAP_AMOUNT * 100) / 10000;
        uint256 feeOnInflated = (inflatedReceived * FEE_BPS) / 10000;
        uint256 expectedTreasury = feeOnInflated + (feeOnInflated * 100) / 10000;
        assertEq(treasuryBal, expectedTreasury, "Treasury fee mismatch");
    }

    /// @notice Inflation compounds across hops in a multi-step swap.
    function test_inflationary_multiHop_inflationAtEachStep() public {
        // Set up a second router for multi-hop
        MockUniswapV2Router router2 = new MockUniswapV2Router(address(0), 1e18); // 1:1 rate
        vm.prank(owner);
        aggregator.addRouter(address(router2));

        MockERC20 tokenC = new MockERC20("Token C", "TKC", 18);
        tokenC.mint(address(router2), INITIAL_BALANCE * 10);

        // Fund router with inflatedToken for step 1 output
        inflatedToken.mint(address(router), INITIAL_BALANCE * 10);

        // Step 1: tokenA → inflatedToken via router1 (2:1 rate)
        // Step 2: inflatedToken → tokenC via router2 (1:1 rate)
        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(inflatedToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(inflatedToken);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path1,
            amountIn: SWAP_AMOUNT,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: (SWAP_AMOUNT * EXCHANGE_RATE) / 1e18, // expected intermediate amount
            minAmountOut: 0
        });

        vm.startPrank(user);
        tokenA.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: user
        });

        uint256 userBalBefore = tokenC.balanceOf(user);
        aggregator.executeSwap(req);
        vm.stopPrank();

        // User should have received tokenC
        uint256 userBalAfter = tokenC.balanceOf(user);
        assertGt(userBalAfter, userBalBefore, "User should receive output tokens");
    }

    /// @notice User receives inflated amount when inflationary token is the output.
    function test_inflationary_asOutput_userGetsInflatedAmount() public {
        // Calculate expected output after protocol fee (before inflation)
        uint256 expectedFee = (SWAP_AMOUNT * FEE_BPS) / 10000;
        uint256 swapAmt = SWAP_AMOUNT - expectedFee;
        uint256 routerOutput = (swapAmt * EXCHANGE_RATE) / 1e18;

        vm.startPrank(user);
        tokenA.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(inflatedToken),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            routerOutput, // minAmountOut = router output (inflation will exceed this)
            address(router),
            user,
            _defaultDeadline()
        );

        uint256 userBalBefore = inflatedToken.balanceOf(user);
        aggregator.executeSwap(req);
        vm.stopPrank();

        uint256 received = inflatedToken.balanceOf(user) - userBalBefore;

        // Router sends routerOutput to aggregator → aggregator gets routerOutput + 1% inflation
        // Aggregator sends (routerOutput + inflation) to user → user gets (routerOutput + inflation) + 1% on that
        assertGt(received, routerOutput, "User should receive more than base exchange rate");
    }

    /// @notice 1% inflation — swap succeeds normally.
    function test_inflationary_1percent_normalOperation() public {
        vm.startPrank(user);
        inflatedToken.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(inflatedToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        // Should not revert
        aggregator.executeSwap(req);
        vm.stopPrank();

        // User should have received tokenA
        assertGt(tokenA.balanceOf(user), 0, "User should have output tokens");
    }

    /// @notice 5% inflation — swap succeeds.
    function test_inflationary_5percent_succeeds() public {
        MockInflationaryToken inflated5 = new MockInflationaryToken("Infl5", "I5", 18, 500); // 5%
        inflated5.mint(user, INITIAL_BALANCE);
        inflated5.mint(address(router), INITIAL_BALANCE * 10);

        vm.startPrank(user);
        inflated5.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(inflated5),
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

        // Verify 5% inflation was applied — treasury receives fee with inflation on fee transfer
        // received = SWAP_AMOUNT + 5% = 1050e18
        // feeAmount = 1050e18 * 0.1% = 1.05e18
        // treasury receives feeAmount + 5% inflation on fee = 1.05e18 + 0.0525e18 = 1.1025e18
        uint256 inflatedReceived = SWAP_AMOUNT + (SWAP_AMOUNT * 500) / 10000;
        uint256 feeOnInflated = (inflatedReceived * FEE_BPS) / 10000;
        uint256 expectedTreasury = feeOnInflated + (feeOnInflated * 500) / 10000;
        assertEq(inflated5.balanceOf(treasury), expectedTreasury, "Fee on 5% inflated amount");
    }

    /// @notice 0% inflation behaves identically to a standard ERC20.
    function test_inflationary_zeroInflation_sameAsStandard() public {
        uint256 userBalBefore = tokenA.balanceOf(user);

        vm.startPrank(user);
        inflatedTokenZero.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(inflatedTokenZero),
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

        // With 0% inflation, received = SWAP_AMOUNT (no bonus)
        // fee = SWAP_AMOUNT * 10 / 10000 = 1e18
        // swapAmount = SWAP_AMOUNT - 1e18 = 999e18
        // output = 999e18 * 2 = 1998e18
        uint256 expectedFee = (SWAP_AMOUNT * FEE_BPS) / 10000;
        uint256 swapAmount = SWAP_AMOUNT - expectedFee;
        uint256 expectedOutput = (swapAmount * EXCHANGE_RATE) / 1e18;

        assertEq(tokenA.balanceOf(user) - userBalBefore, expectedOutput, "Output should match standard ERC20");
        assertEq(inflatedTokenZero.balanceOf(treasury), expectedFee, "Fee should match standard");
    }
}
