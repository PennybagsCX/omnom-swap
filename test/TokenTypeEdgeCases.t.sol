// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockFeeOnTransferToken.sol";
import "../contracts/mocks/MockBurnOnTransferToken.sol";
import "../contracts/mocks/MockUSDTStyleToken.sol";
import "../contracts/mocks/MockEmptyReturnToken.sol";
import "../contracts/mocks/MockBlocklistToken.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";
import "../contracts/interfaces/IERC20.sol";

/**
 * @title MockSafeOutputRouter
 * @notice Router variant that handles non-standard output tokens (empty return bytes).
 *         Uses low-level calls for output transfers to support tokens like Bag/eShrek.
 *         Identical to MockUniswapV2Router except output transfer uses low-level call
 *         that does not decode the return value, supporting empty-return tokens.
 */
contract MockSafeOutputRouter {
    address public factory;
    uint256 public exchangeRate;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(address _factory, uint256 _exchangeRate) {
        factory = _factory;
        exchangeRate = _exchangeRate;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external {
        require(block.timestamp <= deadline, "Expired");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        uint256 amountOut = (amountIn * exchangeRate) / 1e18;
        require(amountOut >= amountOutMin, "Insufficient output");

        // Pull input tokens via forceTransferFrom (works with all mock token types)
        (bool pullOk,) = tokenIn.call(
            abi.encodeWithSignature("forceTransferFrom(address,address,uint256)", msg.sender, address(this), amountIn)
        );
        require(pullOk, "Transfer in failed");

        // Send output tokens via low-level call — does NOT decode return value,
        // so tokens returning empty bytes (no bool) are handled correctly.
        (bool sendOk,) = tokenOut.call(
            abi.encodeCall(IERC20.transfer, (to, amountOut))
        );
        require(sendOk, "Transfer out failed");
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setExchangeRate(uint256 _exchangeRate) external {
        exchangeRate = _exchangeRate;
    }
}

/**
 * @title TokenTypeEdgeCasesTest
 * @notice Comprehensive tests for non-standard token types interacting with the aggregator.
 *         Covers burn-on-transfer, USDT-style approve, empty-return, and blocklist tokens.
 */
contract TokenTypeEdgeCasesTest is Test {
    // ============================================================
    // Contracts
    // ============================================================

    OmnomSwapAggregator public aggregator;
    MockUniswapV2Router public router;
    MockSafeOutputRouter public safeRouter;
    MockWWDOGE public wwdoge;

    // Token types under test
    MockBurnOnTransferToken public burnToken;
    MockUSDTStyleToken public usdtToken;
    MockEmptyReturnToken public emptyReturnToken;
    MockBlocklistToken public blocklistToken;

    // Standard tokens for swap pairs
    MockERC20 public normalToken;
    MockERC20 public outputToken;
    MockFeeOnTransferToken public feeToken;

    // ============================================================
    // Actors
    // ============================================================

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x400);
    address public outsider = address(0x999);

    // ============================================================
    // Constants
    // ============================================================

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant PROTOCOL_FEE_BPS = 25; // 0.25%
    uint256 constant BURN_BPS = 500; // 5% burn
    uint256 constant TOKEN_FEE_BPS = 300; // 3% fee
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant MINT_AMOUNT = 1_000_000e18;
    uint256 constant DEADLINE_OFFSET = 600; // 10 minutes

    // ============================================================
    // Setup
    // ============================================================

    function setUp() public {
        vm.startPrank(owner);

        // Deploy WWDOGE mock
        wwdoge = new MockWWDOGE();

        // Deploy aggregator
        aggregator = new OmnomSwapAggregator(treasury, PROTOCOL_FEE_BPS, address(wwdoge));

        // Deploy edge-case tokens
        burnToken = new MockBurnOnTransferToken("BurnToken", "BURN", 18, BURN_BPS);
        usdtToken = new MockUSDTStyleToken("USDTStyle", "USDT", 18);
        emptyReturnToken = new MockEmptyReturnToken("EmptyReturn", "EMPTY", 18);
        blocklistToken = new MockBlocklistToken("BlockToken", "BLK", 18);

        // Deploy standard tokens
        normalToken = new MockERC20("Normal", "NRM", 18);
        outputToken = new MockERC20("Output", "OUT", 18);
        feeToken = new MockFeeOnTransferToken("FeeToken", "FEE", 18, TOKEN_FEE_BPS, treasury);

        // Deploy routers and register
        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        safeRouter = new MockSafeOutputRouter(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));
        aggregator.addRouter(address(safeRouter));

        vm.stopPrank();

        // Fund user with all token types
        burnToken.mint(user, MINT_AMOUNT);
        usdtToken.mint(user, MINT_AMOUNT);
        emptyReturnToken.mint(user, MINT_AMOUNT);
        blocklistToken.mint(user, MINT_AMOUNT);
        normalToken.mint(user, MINT_AMOUNT);
        feeToken.mint(user, MINT_AMOUNT);

        // Fund routers with output tokens for swaps
        outputToken.mint(address(router), MINT_AMOUNT * 10);
        outputToken.mint(address(safeRouter), MINT_AMOUNT * 10);
        normalToken.mint(address(router), MINT_AMOUNT * 10);
        normalToken.mint(address(safeRouter), MINT_AMOUNT * 10);
        emptyReturnToken.mint(address(router), MINT_AMOUNT * 10);
        emptyReturnToken.mint(address(safeRouter), MINT_AMOUNT * 10);
        burnToken.mint(address(router), MINT_AMOUNT * 10);
        burnToken.mint(address(safeRouter), MINT_AMOUNT * 10);
        feeToken.mint(address(router), MINT_AMOUNT * 10);
        feeToken.mint(address(safeRouter), MINT_AMOUNT * 10);
        blocklistToken.mint(address(router), MINT_AMOUNT * 10);
        blocklistToken.mint(address(safeRouter), MINT_AMOUNT * 10);
    }

    // ============================================================
    // Helpers
    // ============================================================

    /// @dev Builds a single-step SwapRequest.
    function _buildSingleSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address swapRouter
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: swapRouter,
            path: path,
            amountIn: amountIn,
            minAmountOut: minAmountOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minTotalAmountOut: minAmountOut,
            steps: steps,
            deadline: block.timestamp + DEADLINE_OFFSET,
            recipient: recipient
        });
    }

    /// @dev Builds a two-step (multi-hop) SwapRequest.
    function _buildTwoHopSwap(
        address tokenA,
        address tokenB,
        address tokenC,
        uint256 amountIn,
        uint256 minAmountOut,
        address swapRouter
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path1 = new address[](2);
        path1[0] = tokenA;
        path1[1] = tokenB;

        address[] memory path2 = new address[](2);
        path2[0] = tokenB;
        path2[1] = tokenC;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: swapRouter,
            path: path1,
            amountIn: amountIn,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: swapRouter,
            path: path2,
            amountIn: 0, // Will be computed from step 0 output
            minAmountOut: minAmountOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenA,
            tokenOut: tokenC,
            amountIn: amountIn,
            minTotalAmountOut: minAmountOut,
            steps: steps,
            deadline: block.timestamp + DEADLINE_OFFSET,
            recipient: recipient
        });
    }

    // ============================================================
    // A. Burn-on-Transfer Tests
    // ============================================================

    /// @notice Deflationary token as input — aggregator measures correct received amount via balance-diff.
    function test_burnOnTransfer_singleHop_succeeds() public {
        uint256 amount = 1000e18;

        // Approve aggregator
        vm.prank(user);
        burnToken.approve(address(aggregator), amount);

        // User sends 1000 tokens, 5% burned → aggregator receives 950
        // Protocol fee: 950 * 25 / 10000 = 2.375
        // Swap amount: 950 - 2.375 = 947.625
        // Router output: 947.625 * 2 = 1895.25
        uint256 minOut = 1800e18;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(burnToken), address(outputToken), amount, minOut, address(router));

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received output tokens");

        // Verify: received ≈ 947.625 * 2 = 1895.25
        assertApproxEqAbs(received, 1895.25e18, 0.01e18, "Output amount mismatch");
    }

    /// @notice Deflationary token as output — user receives post-burn amount.
    function test_burnOnTransfer_outputUserReceivesLess() public {
        uint256 amount = 1000e18;

        // Use normal token as input, burn token as output
        vm.prank(user);
        normalToken.approve(address(aggregator), amount);

        // Normal input: 1000 tokens, no burn
        // Protocol fee: 1000 * 25 / 10000 = 2.5
        // Swap amount: 1000 - 2.5 = 997.5
        // Router output: 997.5 * 2 = 1995
        // But burnToken transfer burns 5%, so aggregator receives 1995 * 0.95 = 1895.25
        // Then aggregator transfers to recipient via safeTransfer, which also burns 5%
        // Recipient receives: 1895.25 * 0.95 ≈ 1800.4875
        uint256 minOut = 1700e18;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(normalToken), address(burnToken), amount, minOut, address(router));

        uint256 balanceBefore = burnToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = burnToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received burn tokens");

        // Recipient receives less than the router's calculated output due to burn
        // Router output: 1995, but with 5% burn on transfer to aggregator (1895.25 received)
        // Then 5% burn on transfer to recipient: 1895.25 * 0.95 ≈ 1800.4875
        assertLt(received, 1995e18, "Should receive less due to burn");
    }

    /// @notice Deflationary token as intermediary in 2-hop route.
    function test_burnOnTransfer_multiHop_intermediary() public {
        uint256 amount = 1000e18;

        // Route: normalToken → burnToken → outputToken
        vm.prank(user);
        normalToken.approve(address(aggregator), amount);

        // Pre-compute intermediary amounts:
        // Step 0: 1000 normal, fee=2.5, swap=997.5, router out=1995 burn tokens
        // Burn on transfer to aggregator: 1995 * 0.95 = 1895.25
        // Step 1: amountIn=1895.25 burn tokens, router out=1895.25*2=3790.5 output tokens
        // Burn on forceTransferFrom to router: 1895.25 * 0.95 = 1800.4875 (router receives less)
        // But router calculates output based on amountIn, so output = 1895.25 * 2 = 3790.5
        uint256 step1AmountIn = 1895.25e18;
        uint256 minOut = 3000e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(normalToken);
        path1[1] = address(burnToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(burnToken);
        path2[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path1,
            amountIn: amount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path2,
            amountIn: step1AmountIn,
            minAmountOut: minOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(normalToken),
            tokenOut: address(outputToken),
            amountIn: amount,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + DEADLINE_OFFSET,
            recipient: recipient
        });

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received output tokens in multi-hop");

        // Verify output is reduced due to burn on intermediary transfers
        // Without burn: 997.5 * 2 * 2 = 3990
        // With 5% burn on intermediary, output should be significantly less
        assertLt(received, 3990e18, "Multi-hop burn should reduce output");
    }

    /// @notice Protocol fee calculated on post-burn received amount.
    function test_burnOnTransfer_protocolFeeOnPostBurnAmount() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        burnToken.approve(address(aggregator), amount);

        uint256 treasuryBalBefore = burnToken.balanceOf(treasury);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(burnToken), address(outputToken), amount, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 feeReceived = burnToken.balanceOf(treasury) - treasuryBalBefore;

        // Protocol fee is on the POST-burn received amount:
        // User sends 1000, aggregator receives 950 (5% burn)
        // Fee calculated: 950 * 25 / 10000 = 2.375
        // But fee transfer itself also burns 5%: 2.375 * 0.95 = 2.25625
        // Treasury receives: 2.25625
        assertApproxEqAbs(feeReceived, 2.25625e18, 0.01e18, "Fee should be on post-burn amount");
    }

    /// @notice 50% burn rate — slippage protection catches insufficient output.
    function test_burnOnTransfer_50percentBurn_slippageCatches() public {
        // Deploy a 50% burn token
        MockBurnOnTransferToken heavyBurnToken =
            new MockBurnOnTransferToken("HeavyBurn", "HBURN", 18, 5000);
        heavyBurnToken.mint(user, MINT_AMOUNT);
        outputToken.mint(address(router), MINT_AMOUNT * 10);

        uint256 amount = 1000e18;

        vm.prank(user);
        heavyBurnToken.approve(address(aggregator), amount);

        // User sends 1000, 50% burned → aggregator receives 500
        // Protocol fee: 500 * 25 / 10000 = 1.25
        // Swap amount: 500 - 1.25 = 498.75
        // Router output: 498.75 * 2 = 997.5
        // Set minTotalAmountOut to 1000 (higher than 997.5) → should revert with "Slippage"
        // Note: step.minAmountOut must be 0 so the router doesn't reject first
        address[] memory path = new address[](2);
        path[0] = address(heavyBurnToken);
        path[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path,
            amountIn: amount,
            minAmountOut: 0 // Let router produce any output; aggregator slippage catches it
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(heavyBurnToken),
            tokenOut: address(outputToken),
            amountIn: amount,
            minTotalAmountOut: 1000e18, // Higher than 997.5 → triggers "Slippage"
            steps: steps,
            deadline: block.timestamp + DEADLINE_OFFSET,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(req);
    }

    // ============================================================
    // B. USDT-Style Token Tests
    // ============================================================

    /// @notice Swap with USDT-style token — SafeERC20 handles approve(0)→approve(amount) pattern.
    function test_usdtStyle_swapSucceeds() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        usdtToken.approve(address(aggregator), amount);

        // Normal swap: 1000 input, protocol fee = 2.5, swap amount = 997.5
        // Output: 997.5 * 2 = 1995
        uint256 minOut = 1900e18;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(usdtToken), address(outputToken), amount, minOut, address(router));

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertApproxEqAbs(received, 1995e18, 0.01e18, "Output amount mismatch");
    }

    /// @notice USDT-style token as first hop input in multi-hop route.
    function test_usdtStyle_multiHop_firstHop() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        usdtToken.approve(address(aggregator), amount);

        // Route: usdtToken → normalToken → outputToken
        // Step 0: 1000 USDT, fee=2.5, swap=997.5, router out=1995 normalToken
        // Step 1: amountIn=1995, router out=1995*2=3990 outputToken
        uint256 step1AmountIn = 1995e18;
        uint256 minOut = 3500e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(usdtToken);
        path1[1] = address(normalToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(normalToken);
        path2[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path1,
            amountIn: amount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path2,
            amountIn: step1AmountIn,
            minAmountOut: minOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(usdtToken),
            tokenOut: address(outputToken),
            amountIn: amount,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + DEADLINE_OFFSET,
            recipient: recipient
        });

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received output tokens in multi-hop");
    }

    /// @notice Verify approval is reset to 0 after swap (no lingering allowance).
    function test_usdtStyle_approvalResetAfterSwap() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        usdtToken.approve(address(aggregator), amount);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(usdtToken), address(outputToken), amount, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req);

        // After swap, aggregator resets approval to 0 on the USDT-style token
        uint256 remainingAllowance =
            usdtToken.allowance(address(aggregator), address(router));
        assertEq(remainingAllowance, 0, "Approval should be reset to 0 after swap");
    }

    /// @notice Direct approve(non-zero) without reset reverts on USDT-style token.
    function test_usdtStyle_directApproveNonZero_reverts() public {
        // First approve succeeds (allowance is 0)
        vm.prank(user);
        usdtToken.approve(address(aggregator), 1000e18);

        // Second approve to non-zero amount WITHOUT resetting to 0 first should revert
        vm.prank(user);
        vm.expectRevert("USDT-style: reset to 0 first");
        usdtToken.approve(address(aggregator), 2000e18);
    }

    /// @notice USDT-style token as input + fee-on-transfer token as output.
    function test_usdtStyle_feeOnTransfer_combo() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        usdtToken.approve(address(aggregator), amount);

        // Input: USDT-style (1000), output: fee-on-transfer (3% fee)
        // Protocol fee: 1000 * 25 / 10000 = 2.5
        // Swap amount: 997.5
        // Router output: 997.5 * 2 = 1995
        // Fee-on-transfer output: 1995 * 97% = 1935.15 received by aggregator
        // Then aggregator sends 1935.15 to recipient, fee-on-transfer again: 1935.15 * 97% ≈ 1877.10
        uint256 minOut = 1800e18;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(usdtToken), address(feeToken), amount, minOut, address(router));

        uint256 balanceBefore = feeToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = feeToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received fee tokens");

        // Recipient receives less than router output due to fee-on-transfer
        assertLt(received, 1995e18, "Should receive less due to transfer fee");
    }

    // ============================================================
    // C. Empty Return Token Tests
    // ============================================================

    /// @notice Swap with token returning empty bytes — SafeERC20 handles it.
    function test_emptyReturn_swapSucceeds() public {
        uint256 amount = 1000e18;

        // Approve aggregator (empty-return token's approve returns empty bytes)
        vm.prank(user);
        emptyReturnToken.approve(address(aggregator), amount);

        // Swap: empty-return token (input) → normal token (output)
        // Protocol fee: 1000 * 25 / 10000 = 2.5
        // Swap amount: 997.5, output: 997.5 * 2 = 1995
        uint256 minOut = 1900e18;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(emptyReturnToken), address(outputToken), amount, minOut, address(router));

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertApproxEqAbs(received, 1995e18, 0.01e18, "Output amount mismatch");
    }

    /// @notice Empty-return token in multi-hop route as first hop input.
    function test_emptyReturn_multiHop() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        emptyReturnToken.approve(address(aggregator), amount);

        // Route: emptyReturnToken → normalToken → outputToken
        // Step 0: 1000 EMPTY, fee=2.5, swap=997.5, router out=1995 normalToken
        // Step 1: amountIn=1995, router out=1995*2=3990 outputToken
        uint256 step1AmountIn = 1995e18;
        uint256 minOut = 3500e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(emptyReturnToken);
        path1[1] = address(normalToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(normalToken);
        path2[1] = address(outputToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path1,
            amountIn: amount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path2,
            amountIn: step1AmountIn,
            minAmountOut: minOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(emptyReturnToken),
            tokenOut: address(outputToken),
            amountIn: amount,
            minTotalAmountOut: minOut,
            steps: steps,
            deadline: block.timestamp + DEADLINE_OFFSET,
            recipient: recipient
        });

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received output in multi-hop with empty-return input");
    }

    /// @notice Swap native DOGE → empty-return token using safe output router.
    function test_emptyReturn_nativeDogeSwap() public {
        uint256 amount = 1 ether;

        // Fund user with native DOGE
        vm.deal(user, amount);

        // Route: WWDOGE → emptyReturnToken using safeRouter (handles empty return output)
        address[] memory path = new address[](2);
        path[0] = address(wwdoge);
        path[1] = address(emptyReturnToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(safeRouter),
            path: path,
            amountIn: amount,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(wwdoge),
            tokenOut: address(emptyReturnToken),
            amountIn: amount,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + DEADLINE_OFFSET,
            recipient: recipient
        });

        // Need to approve aggregator to spend WWDOGE (wrap first via deposit)
        // Actually for native DOGE swaps, msg.value is used and auto-wrapped
        uint256 balanceBefore = emptyReturnToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap{value: amount}(req);

        uint256 received = emptyReturnToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received empty-return tokens for native DOGE");
    }

    /// @notice Verify balance-diff measurement works correctly with empty-return tokens.
    function test_emptyReturn_balanceDiffCorrect() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        emptyReturnToken.approve(address(aggregator), amount);

        uint256 userBalBefore = emptyReturnToken.balanceOf(user);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(emptyReturnToken), address(outputToken), amount, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify user's balance decreased by exactly `amount`
        uint256 userBalAfter = emptyReturnToken.balanceOf(user);
        assertEq(userBalBefore - userBalAfter, amount, "Balance diff should match amount");
    }

    // ============================================================
    // D. Blocklist Token Tests
    // ============================================================

    /// @notice Swap when no addresses are blocked — succeeds normally.
    function test_blocklist_normalSwap_succeeds() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        blocklistToken.approve(address(aggregator), amount);

        uint256 minOut = 1900e18;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(blocklistToken), address(outputToken), amount, minOut, address(router));

        uint256 balanceBefore = outputToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = outputToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should have received output tokens");
    }

    /// @notice User is blocked — transferFrom reverts.
    function test_blocklist_userBlocked_swapReverts() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        blocklistToken.approve(address(aggregator), amount);

        // Block the user
        vm.prank(owner);
        blocklistToken.blocklist(user, true);
        assertTrue(blocklistToken.isBlocked(user));

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(blocklistToken), address(outputToken), amount, 0, address(router));

        vm.prank(user);
        vm.expectRevert("Sender blocked");
        aggregator.executeSwap(req);
    }

    /// @notice Aggregator is blocked — transferFrom reverts (aggregator is recipient).
    function test_blocklist_aggregatorBlocked_swapReverts() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        blocklistToken.approve(address(aggregator), amount);

        // Block the aggregator
        vm.prank(owner);
        blocklistToken.blocklist(address(aggregator), true);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(blocklistToken), address(outputToken), amount, 0, address(router));

        vm.prank(user);
        vm.expectRevert("Recipient blocked");
        aggregator.executeSwap(req);
    }

    /// @notice Router is blocked — swap fails when router tries to send blocklist output tokens.
    function test_blocklist_routerBlocked_swapReverts() public {
        uint256 amount = 1000e18;

        // Use blocklist token as OUTPUT, normal token as input
        vm.prank(user);
        normalToken.approve(address(aggregator), amount);

        // Block the router on the blocklist token
        vm.prank(owner);
        blocklistToken.blocklist(address(router), true);

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(normalToken), address(blocklistToken), amount, 0, address(router));

        // Router tries to transfer blocklist tokens to aggregator, but router is blocked
        vm.prank(user);
        vm.expectRevert("Sender blocked");
        aggregator.executeSwap(req);
    }

    /// @notice Tokens stuck in aggregator recoverable via rescueTokens after unblock.
    function test_blocklist_blockedMidSwap_tokensRecoverable() public {
        // Simulate tokens stuck in aggregator by minting directly
        uint256 stuckAmount = 500e18;
        blocklistToken.mint(address(aggregator), stuckAmount);

        // Verify aggregator has the tokens
        assertEq(blocklistToken.balanceOf(address(aggregator)), stuckAmount);

        // Block the aggregator — rescueTokens should fail
        vm.prank(owner);
        blocklistToken.blocklist(address(aggregator), true);

        vm.prank(owner);
        vm.expectRevert("Sender blocked");
        aggregator.rescueTokens(address(blocklistToken), stuckAmount);

        // Unblock the aggregator — rescueTokens should now succeed
        vm.prank(owner);
        blocklistToken.blocklist(address(aggregator), false);

        uint256 ownerBalBefore = blocklistToken.balanceOf(owner);
        vm.prank(owner);
        aggregator.rescueTokens(address(blocklistToken), stuckAmount);

        assertEq(blocklistToken.balanceOf(owner) - ownerBalBefore, stuckAmount, "Owner should receive rescued tokens");
        assertEq(blocklistToken.balanceOf(address(aggregator)), 0, "Aggregator should have no remaining tokens");
    }

    // ============================================================
    // E. Combined Edge Case Tests
    // ============================================================

    /// @notice Burn-on-transfer + protocol fee — verify correct accounting.
    function test_combined_burnOnTransfer_plusProtocolFee() public {
        uint256 amount = 1000e18;

        vm.prank(user);
        burnToken.approve(address(aggregator), amount);

        uint256 treasuryBalBefore = burnToken.balanceOf(treasury);
        uint256 supplyBefore = burnToken.totalSupply();

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(burnToken), address(outputToken), amount, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req);

        // Protocol fee = post-burn received * BPS / 10000
        // Received: 1000 * 0.95 = 950 (5% burn on user→aggregator transfer)
        // Fee calculated: 950 * 25 / 10000 = 2.375
        // Fee transfer also burns 5%: 2.375 * 0.95 = 2.25625
        uint256 feeReceived = burnToken.balanceOf(treasury) - treasuryBalBefore;
        assertApproxEqAbs(feeReceived, 2.25625e18, 0.01e18, "Protocol fee mismatch");

        // Verify total supply decreased due to burns on both transfers
        assertLt(burnToken.totalSupply(), supplyBefore, "Total supply should decrease from burns");
    }

    /// @notice USDT-style approve pattern with fee-on-transfer output token.
    function test_combined_usdtStyle_plusFeeOnTransfer() public {
        uint256 amount = 1000e18;

        // First approve to 0 (USDT-style requires this if allowance was previously set)
        // Since allowance starts at 0, direct approve works
        vm.prank(user);
        usdtToken.approve(address(aggregator), amount);

        // Verify USDT-style approve behavior: second non-zero approve fails
        // But SafeERC20 handles this by resetting to 0 first

        uint256 minOut = 1800e18;

        OmnomSwapAggregator.SwapRequest memory req =
            _buildSingleSwap(address(usdtToken), address(feeToken), amount, minOut, address(router));

        uint256 balanceBefore = feeToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        uint256 received = feeToken.balanceOf(recipient) - balanceBefore;
        assertGt(received, 0, "Should receive fee tokens from USDT-style swap");

        // Verify the USDT-style token's allowance was properly reset
        uint256 remainingAllowance =
            usdtToken.allowance(address(aggregator), address(router));
        assertEq(remainingAllowance, 0, "USDT-style allowance should be reset after swap");
    }

    /// @notice Multiple edge-case token types in sequence — stress test.
    function test_combined_allEdgeCases_stress() public {
        // --- Swap 1: Burn-on-transfer token ---
        uint256 amount1 = 500e18;
        vm.prank(user);
        burnToken.approve(address(aggregator), amount1);

        OmnomSwapAggregator.SwapRequest memory req1 =
            _buildSingleSwap(address(burnToken), address(outputToken), amount1, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req1);

        uint256 outputAfterSwap1 = outputToken.balanceOf(recipient);
        assertGt(outputAfterSwap1, 0, "Swap 1: burn token swap should produce output");

        // --- Swap 2: USDT-style token ---
        uint256 amount2 = 600e18;
        vm.prank(user);
        usdtToken.approve(address(aggregator), amount2);

        OmnomSwapAggregator.SwapRequest memory req2 =
            _buildSingleSwap(address(usdtToken), address(normalToken), amount2, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req2);

        uint256 normalAfterSwap2 = normalToken.balanceOf(recipient);
        assertGt(normalAfterSwap2, 0, "Swap 2: USDT-style swap should produce output");

        // --- Swap 3: Empty-return token ---
        uint256 amount3 = 700e18;
        vm.prank(user);
        emptyReturnToken.approve(address(aggregator), amount3);

        OmnomSwapAggregator.SwapRequest memory req3 =
            _buildSingleSwap(address(emptyReturnToken), address(outputToken), amount3, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req3);

        uint256 outputAfterSwap3 = outputToken.balanceOf(recipient);
        assertGt(outputAfterSwap3, outputAfterSwap1, "Swap 3: output should accumulate");

        // --- Swap 4: Blocklist token (no blocks active) ---
        uint256 amount4 = 800e18;
        vm.prank(user);
        blocklistToken.approve(address(aggregator), amount4);

        OmnomSwapAggregator.SwapRequest memory req4 =
            _buildSingleSwap(address(blocklistToken), address(outputToken), amount4, 0, address(router));

        vm.prank(user);
        aggregator.executeSwap(req4);

        uint256 outputAfterSwap4 = outputToken.balanceOf(recipient);
        assertGt(outputAfterSwap4, outputAfterSwap3, "Swap 4: output should keep accumulating");

        // Verify all swaps succeeded and recipient has tokens from all 4
        assertGt(outputToken.balanceOf(recipient), 0, "Should have output tokens");
        assertGt(normalToken.balanceOf(recipient), 0, "Should have normal tokens");
    }
}
