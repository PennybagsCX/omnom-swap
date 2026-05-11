// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockFeeOnTransferToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title SlippageBoundariesTest
/// @notice Tests for slippage tolerance boundary conditions, tier testing,
///         cumulative multi-hop slippage, and dynamic slippage validation.
contract SlippageBoundariesTest is Test {
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

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 100_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 25; // 0.25%

    // --- Helpers ------------------------------------------------------

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _fundRouter(MockUniswapV2Router _router, address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(_router), amount);
    }

    /// @dev Computes the actual output for a single-hop swap
    function _computeExpectedOut(uint256 amountIn) internal pure returns (uint256 feeAmount, uint256 swapAmount, uint256 output) {
        feeAmount = (amountIn * FEE_BPS) / 10_000;
        swapAmount = amountIn - feeAmount;
        output = (swapAmount * EXCHANGE_RATE) / 1e18;
    }

    function _buildSingleHopRequest(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minTotalOut,
        address routerAddr
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        (, uint256 swapAmount,) = _computeExpectedOut(amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: routerAddr,
            path: path,
            amountIn: swapAmount,
            minAmountOut: 0
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minTotalAmountOut: minTotalOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });
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

        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));

        vm.stopPrank();

        // Fund user
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);

        // Fund routers
        _fundRouter(router1, address(tokenB), INITIAL_BALANCE);
        _fundRouter(router1, address(tokenC), INITIAL_BALANCE);
        _fundRouter(router1, address(tokenA), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenB), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenC), INITIAL_BALANCE);
        _fundRouter(router2, address(tokenA), INITIAL_BALANCE);
    }

    // ===================================================================
    // A. Exact Boundary Tests
    // ===================================================================

    function test_exactBoundary_minAmountOut_equalsActual() public {
        uint256 amountIn = SWAP_AMOUNT;
        (,, uint256 actualOut) = _computeExpectedOut(amountIn);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleHopRequest(address(tokenA), address(tokenB), amountIn, actualOut, address(router1));

        vm.prank(user);
        aggregator.executeSwap(req);

        // Should succeed — minTotalAmountOut exactly equals actual output
        assertEq(tokenB.balanceOf(recipient), actualOut, "output should match exact boundary");
    }

    function test_exactBoundary_minAmountOut_actualPlus1() public {
        uint256 amountIn = SWAP_AMOUNT;
        (,, uint256 actualOut) = _computeExpectedOut(amountIn);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleHopRequest(address(tokenA), address(tokenB), amountIn, actualOut + 1, address(router1));

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(req);
    }

    function test_exactBoundary_minAmountOut_actualMinus1() public {
        uint256 amountIn = SWAP_AMOUNT;
        (,, uint256 actualOut) = _computeExpectedOut(amountIn);

        // Only test if actualOut > 0
        vm.assume(actualOut > 1);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleHopRequest(address(tokenA), address(tokenB), amountIn, actualOut - 1, address(router1));

        vm.prank(user);
        aggregator.executeSwap(req);

        // Should succeed — minTotalAmountOut is 1 less than actual output
        assertEq(tokenB.balanceOf(recipient), actualOut, "output should be actual amount");
    }

    function test_exactBoundary_zeroSlippage() public {
        // minTotalAmountOut = expected exactly — succeeds if no price impact
        uint256 amountIn = SWAP_AMOUNT;
        (,, uint256 expectedOut) = _computeExpectedOut(amountIn);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleHopRequest(address(tokenA), address(tokenB), amountIn, expectedOut, address(router1));

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "zero slippage swap should match expected");
    }

    // ===================================================================
    // B. Slippage Tier Testing
    // ===================================================================

    /// @dev Helper: test a specific slippage tolerance tier
    function _testSlippageTier(uint256 slippageBps) internal {
        uint256 amountIn = SWAP_AMOUNT;
        (,, uint256 actualOut) = _computeExpectedOut(amountIn);

        // minTotalAmountOut = actualOut * (10000 - slippageBps) / 10000
        uint256 minOut = (actualOut * (10_000 - slippageBps)) / 10_000;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleHopRequest(address(tokenA), address(tokenB), amountIn, minOut, address(router1));

        vm.prank(user);
        aggregator.executeSwap(req);

        // Should succeed — actual output >= minOut
        assertGe(tokenB.balanceOf(recipient), minOut, "output should meet slippage tier");
    }

    function test_slippageTier_0_01percent() public {
        _testSlippageTier(1); // 0.01%
    }

    function test_slippageTier_0_1percent() public {
        _testSlippageTier(10); // 0.1%
    }

    function test_slippageTier_0_5percent() public {
        _testSlippageTier(50); // 0.5%
    }

    function test_slippageTier_1percent() public {
        _testSlippageTier(100); // 1%
    }

    function test_slippageTier_3percent() public {
        _testSlippageTier(300); // 3%
    }

    function test_slippageTier_5percent() public {
        _testSlippageTier(500); // 5%
    }

    // ===================================================================
    // C. Multi-Hop Cumulative Slippage
    // ===================================================================

    function test_cumulativeSlippage_2hop() public {
        // Each hop has ~1% slippage (exchange rate = 0.99x)
        // Use router with 0.99 exchange rate
        MockUniswapV2Router slippageRouter = new MockUniswapV2Router(address(0), 0.99e18);
        vm.prank(owner);
        aggregator.addRouter(address(slippageRouter));

        _fundRouter(slippageRouter, address(tokenB), INITIAL_BALANCE);
        _fundRouter(slippageRouter, address(tokenC), INITIAL_BALANCE);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Hop 1: tokenA → tokenB with 1% slippage
        uint256 hop1Out = (swapAmount * 0.99e18) / 1e18;
        // Hop 2: tokenB → tokenC with 1% slippage
        uint256 hop2Out = (hop1Out * 0.99e18) / 1e18;

        // Total slippage ≈ 2% (0.99 * 0.99 ≈ 0.9801)
        // Set minTotalAmountOut with 2.5% tolerance (should pass)
        uint256 minOut = (hop2Out * 9750) / 10_000;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(slippageRouter),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(slippageRouter),
            path: path2,
            amountIn: hop1Out,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertGe(tokenC.balanceOf(recipient), minOut, "2-hop output should meet tolerance");
    }

    function test_cumulativeSlippage_3hop() public {
        MockUniswapV2Router slippageRouter = new MockUniswapV2Router(address(0), 0.99e18);
        vm.prank(owner);
        aggregator.addRouter(address(slippageRouter));

        _fundRouter(slippageRouter, address(tokenB), INITIAL_BALANCE);
        _fundRouter(slippageRouter, address(tokenC), INITIAL_BALANCE);
        MockERC20 tokenD = new MockERC20("Token D", "TKD", 18);
        _fundRouter(slippageRouter, address(tokenD), INITIAL_BALANCE);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 hop1Out = (swapAmount * 0.99e18) / 1e18;
        uint256 hop2Out = (hop1Out * 0.99e18) / 1e18;
        uint256 hop3Out = (hop2Out * 0.99e18) / 1e18;

        // Total slippage ≈ 3% (0.99^3 ≈ 0.9703)
        // Set minTotalAmountOut with 4% tolerance
        uint256 minOut = (hop3Out * 9600) / 10_000;

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
        steps[0] = OmnomSwapAggregator.SwapStep({router: address(slippageRouter), path: path1, amountIn: swapAmount, minAmountOut: 0});
        steps[1] = OmnomSwapAggregator.SwapStep({router: address(slippageRouter), path: path2, amountIn: hop1Out, minAmountOut: 0});
        steps[2] = OmnomSwapAggregator.SwapStep({router: address(slippageRouter), path: path3, amountIn: hop2Out, minAmountOut: 0});

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenD),
            amountIn: amountIn,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertGe(tokenD.balanceOf(recipient), minOut, "3-hop output should meet tolerance");
    }

    function test_cumulativeSlippage_withFeeOnTransfer() public {
        // Fee-on-transfer token adds to effective slippage
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken("FeeToken", "FEE", 18, 100, treasury); // 1% fee
        MockERC20 outputToken = new MockERC20("Output", "OUT", 18);

        outputToken.mint(address(router1), INITIAL_BALANCE);

        uint256 amountIn = SWAP_AMOUNT;
        feeToken.mint(user, amountIn);
        vm.prank(user);
        feeToken.approve(address(aggregator), amountIn);

        // Fee-on-transfer: user sends 1000, aggregator receives 990 (1% fee)
        // Protocol fee: 990 * 25 / 10000 = 2.475
        // swapAmount: 990 - 2.475 = 987.525
        // Router output: 987.525 * 2 = 1975.05
        uint256 receivedAfterFee = amountIn - (amountIn * 100) / 10_000; // 990
        uint256 protocolFee = (receivedAfterFee * FEE_BPS) / 10_000; // 2.475
        uint256 swapAmount = receivedAfterFee - protocolFee; // 987.525
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18; // 1975.05

        address[] memory path = new address[](2);
        path[0] = address(feeToken);
        path[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: 0, // ignored for step 0
            minAmountOut: 0
        });

        // Set minTotalAmountOut accounting for fee-on-transfer + protocol fee
        uint256 minOut = (expectedOut * 9800) / 10_000; // 2% additional tolerance

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(feeToken),
            tokenOut: address(outputToken),
            amountIn: amountIn,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertGe(outputToken.balanceOf(recipient), minOut, "fee-on-transfer output should meet tolerance");
    }

    function test_cumulativeSlippage_withProtocolFee() public {
        // Protocol fee (0.25%) adds to effective slippage
        uint256 amountIn = SWAP_AMOUNT;

        // With protocol fee: effective output = (amountIn * (1 - 0.0025)) * exchangeRate
        (,, uint256 outputWithFee) = _computeExpectedOut(amountIn);

        // Without protocol fee: output = amountIn * exchangeRate
        uint256 outputNoFee = (amountIn * EXCHANGE_RATE) / 1e18;

        // Difference is the protocol fee impact
        uint256 feeImpact = outputNoFee - outputWithFee;
        assertGt(feeImpact, 0, "protocol fee should reduce output");

        console2.log("Output without fee:", outputNoFee);
        console2.log("Output with fee:", outputWithFee);
        console2.log("Fee impact:", feeImpact);

        // Verify swap succeeds with minTotalAmountOut = outputWithFee
        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleHopRequest(address(tokenA), address(tokenB), amountIn, outputWithFee, address(router1));

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), outputWithFee, "output should match fee-adjusted expected");
    }

    // ===================================================================
    // D. Dynamic Slippage Validation
    // ===================================================================

    function test_dynamicSlippage_highLiquidity_tightTolerance() public {
        // Simulate high TVL: tight slippage tolerance (0.5%)
        uint256 amountIn = SWAP_AMOUNT;
        (,, uint256 actualOut) = _computeExpectedOut(amountIn);

        // Tight tolerance: 0.5%
        uint256 minOut = (actualOut * 9950) / 10_000;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleHopRequest(address(tokenA), address(tokenB), amountIn, minOut, address(router1));

        vm.prank(user);
        aggregator.executeSwap(req);

        assertGe(tokenB.balanceOf(recipient), minOut, "high liquidity tight tolerance");
    }

    function test_dynamicSlippage_lowLiquidity_wideTolerance() public {
        // Simulate low TVL: wide slippage tolerance (5%)
        // Use a router with lower exchange rate to simulate price impact
        MockUniswapV2Router lowLiqRouter = new MockUniswapV2Router(address(0), 1.95e18); // 2.5% price impact
        vm.prank(owner);
        aggregator.addRouter(address(lowLiqRouter));

        _fundRouter(lowLiqRouter, address(tokenB), INITIAL_BALANCE);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 actualOut = (swapAmount * 1.95e18) / 1e18;

        // Wide tolerance: 5%
        uint256 minOut = (actualOut * 9500) / 10_000;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(lowLiqRouter),
            path: path,
            amountIn: swapAmount,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertGe(tokenB.balanceOf(recipient), minOut, "low liquidity wide tolerance");
    }

    function test_dynamicSlippage_mediumLiquidity_mediumTolerance() public {
        // Simulate medium TVL: 1% slippage tolerance
        MockUniswapV2Router medLiqRouter = new MockUniswapV2Router(address(0), 1.98e18); // 1% price impact
        vm.prank(owner);
        aggregator.addRouter(address(medLiqRouter));

        _fundRouter(medLiqRouter, address(tokenB), INITIAL_BALANCE);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 actualOut = (swapAmount * 1.98e18) / 1e18;

        // Medium tolerance: 1%
        uint256 minOut = (actualOut * 9900) / 10_000;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(medLiqRouter),
            path: path,
            amountIn: swapAmount,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertGe(tokenB.balanceOf(recipient), minOut, "medium liquidity medium tolerance");
    }
}
