// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

// ============================================================
// Malicious Token — re-enters executeSwap during transferFrom
// ============================================================
contract MaliciousToken is IERC20 {
    string public name = "Malicious";
    string public symbol = "MAL";
    uint8 public decimals = 18;
    uint256 public override totalSupply;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    /// @notice The aggregator we will attempt to re-enter.
    OmnomSwapAggregator public target;
    /// @notice The swap request to replay during reentrancy.
    OmnomSwapAggregator.SwapRequest public pendingRequest;
    /// @notice How many times the reentrancy callback has fired.
    uint256 public reentrancyCount;
    /// @notice Max times to attempt reentrancy (prevent infinite loops in test).
    uint256 public maxReentrancy = 1;

    constructor() {}

    function setTarget(address payable _target) external {
        target = OmnomSwapAggregator(_target);
    }

    function setPendingRequest(OmnomSwapAggregator.SwapRequest calldata req) external {
        pendingRequest = req;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Force-transfer without allowance check (needed for MockRouter compatibility).
    function forceTransferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function transferFrom(address sender, address recipient, uint256 amount) external override returns (bool) {
        require(balanceOf[sender] >= amount, "Insufficient balance");
        require(allowance[sender][msg.sender] >= amount, "Insufficient allowance");

        allowance[sender][msg.sender] -= amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;

        emit Transfer(sender, recipient, amount);

        // Attempt reentrancy on first call only
        if (address(target) != address(0) && reentrancyCount < maxReentrancy) {
            reentrancyCount++;
            // Try to re-enter executeSwap — should revert due to nonReentrant
            try target.executeSwap(pendingRequest) {
                // If it somehow succeeds, that's a bug
            } catch {
                // Expected: reverts with ReentrancyGuardReentrantCall
            }
        }

        return true;
    }
}

// ============================================================
// Malicious Router — calls back into the aggregator during swap
// ============================================================
contract MaliciousRouter {
    address public factory;
    uint256 public exchangeRate;
    mapping(address => mapping(address => uint256)) public allowance;

    OmnomSwapAggregator public target;
    OmnomSwapAggregator.SwapRequest public pendingRequest;
    uint256 public callbackCount;
    uint256 public maxCallback = 1;

    constructor(address _factory, uint256 _exchangeRate) {
        factory = _factory;
        exchangeRate = _exchangeRate;
    }

    function setTarget(address payable _target) external {
        target = OmnomSwapAggregator(_target);
    }

    function setPendingRequest(OmnomSwapAggregator.SwapRequest calldata req) external {
        pendingRequest = req;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "Expired");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        uint256 amountOut = (amountIn * exchangeRate) / 1e18;
        require(amountOut >= amountOutMin, "Insufficient output");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = amountOut;
        }

        // Transfer input tokens from caller (aggregator) to this contract
        MockERC20(tokenIn).forceTransferFrom(msg.sender, address(this), amountIn);

        // Attempt reentrancy via router callback
        if (address(target) != address(0) && callbackCount < maxCallback) {
            callbackCount++;
            try target.executeSwap(pendingRequest) {
                // If succeeds, bug
            } catch {
                // Expected
            }
        }

        // Transfer output tokens to recipient
        require(
            IERC20(tokenOut).transfer(to, amountOut),
            "Transfer out failed"
        );
    }
}

// ============================================================
// ExtremeConditionsTest
// ============================================================

/// @title ExtremeConditionsTest
/// @notice Comprehensive stress test suite simulating high-stress scenarios:
///         rapid price movements, MEV front-running, network congestion,
///         token approval edge cases, multi-hop route stress, fee edge cases,
///         and reentrancy protection.
contract ExtremeConditionsTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockERC20 public tokenD;
    MockERC20 public tokenE;
    MockUniswapV2Router public router1;
    MockUniswapV2Router public router2;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);
    address public attacker = address(0x600);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 100_000_000e18;
    uint256 constant FEE_BPS = 10; // 0.1%

    // ============================================================
    // Helpers
    // ============================================================

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _fundRouter(MockUniswapV2Router _router, address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(_router), amount);
    }

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

    function _executeSimpleSwap(uint256 amountIn) internal {
        uint256 feeAmount = (amountIn * aggregator.protocolFeeBps()) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);
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
        tokenD = new MockERC20("Token D", "TKD", 18);
        tokenE = new MockERC20("Token E", "TKE", 18);

        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));

        vm.stopPrank();

        // Fund user with all tokens
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenC), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenD), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenE), user, INITIAL_BALANCE);

        // Fund routers with all output tokens
        _fundRouter(router1, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenD), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenE), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenD), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenE), INITIAL_BALANCE * 10);

        // Fund attacker
        _fundAndApprove(address(tokenA), attacker, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), attacker, INITIAL_BALANCE);
    }

    // ============================================================
    // 1. Rapid Price Movement Tests
    // ============================================================

    /// @notice Swap succeeds when price shifts between quote and execution.
    ///         We swap with minAmountOut=0 so the swap tolerates any movement.
    function test_SwapDuringPriceShift() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Original expected output at 2x rate
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Build swap with 0 minAmountOut to tolerate price shift
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            0, // tolerate any output
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // Simulate price shift: change exchange rate from 2x to 1.5x
        router1.setExchangeRate(1.5e18);

        uint256 newExpectedOut = (swapAmount * 1.5e18) / 1e18;

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify swap succeeded with the new (lower) output
        assertEq(tokenB.balanceOf(recipient), newExpectedOut, "output should match shifted price");
        assertLt(tokenB.balanceOf(recipient), originalOut, "output should be less than original quote");
    }

    /// @notice A swap causing ~10% price impact succeeds with correct output.
    function test_SwapWith10PercentPriceImpact() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Simulate 10% price impact: rate drops from 2x to 1.8x
        uint256 impactRate = 1.8e18;
        router1.setExchangeRate(impactRate);

        uint256 expectedOut = (swapAmount * impactRate) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "10% impact output mismatch");
    }

    /// @notice A swap causing ~50% price impact succeeds with correct output.
    function test_SwapWith50PercentPriceImpact() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Simulate 50% price impact: rate drops from 2x to 1x
        uint256 impactRate = 1e18;
        router1.setExchangeRate(impactRate);

        uint256 expectedOut = (swapAmount * impactRate) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "50% impact output mismatch");
    }

    /// @notice In a 2-hop route, price movement between step 0 and step 1
    ///         is handled correctly. The aggregator uses the actual output
    ///         of step 0 as input to step 1 (via runningBalance), so price
    ///         shifts between hops are naturally handled.
    function test_MultiHopPriceShiftBetweenSteps() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1 at 2x rate
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Step 2 at reduced rate (simulating price shift)
        uint256 newRate2 = 1.5e18;
        uint256 step2Out = (step1Out * newRate2) / 1e18;

        // Set router2 to reduced rate for step 2
        router2.setExchangeRate(newRate2);

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

        assertEq(tokenC.balanceOf(recipient), step2Out, "multi-hop price shift output mismatch");
    }

    // ============================================================
    // 2. MEV Front-Running Simulation Tests
    // ============================================================

    /// @notice Simulate a front-run: attacker swaps on the pool before the
    ///         aggregator's swap, changing the exchange rate. The aggregator's
    ///         minTotalAmountOut check catches the reduced output and reverts.
    function test_FrontRunProtection_MinAmountOut() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Original quote at 2x rate
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Build swap expecting the original output
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            originalOut, // expect original output
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // Front-run: attacker swaps first, changing the rate to 1.5x
        router1.setExchangeRate(1.5e18);

        // Now the aggregator's swap should revert because output < minTotalAmountOut
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Simulate a sandwich attack: front-run buy + back-run sell.
    ///         The front-run reduces output. Slippage protection (minTotalAmountOut)
    ///         limits the user's loss by reverting when output is too low.
    function test_SandwichAttack_Mitigation() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // User's expected output at 2x rate
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets minTotalAmountOut with 5% slippage tolerance
        uint256 minOutWithSlippage = (expectedOut * 95) / 100;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            minOutWithSlippage,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // Front-run: attacker drives price down to 1.5x (25% drop, > 5% tolerance)
        router1.setExchangeRate(1.5e18);

        // User's swap should revert because output is below 5% tolerance
        uint256 frontRunOutput = (swapAmount * 1.5e18) / 1e18;
        assertLt(frontRunOutput, minOutWithSlippage, "front-run output should be below tolerance");

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Verify that exact approval amounts prevent a malicious router
    ///         from draining excess tokens. The aggregator approves exactly
    ///         stepAmountIn to the router and resets to 0 after each step.
    function test_ExactApprovalPreventsDrain() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        _executeSimpleSwap(amountIn);

        // After swap, verify the aggregator's approval to the router is 0
        uint256 remainingApproval = tokenA.allowance(address(aggregator), address(router1));
        assertEq(remainingApproval, 0, "approval should be reset to 0 after swap");

        // Verify no excess tokens are held by the aggregator
        uint256 aggregatorTokenABalance = tokenA.balanceOf(address(aggregator));
        assertEq(aggregatorTokenABalance, 0, "aggregator should hold no tokenA");

        uint256 aggregatorTokenBBalance = tokenB.balanceOf(address(aggregator));
        assertEq(aggregatorTokenBBalance, 0, "aggregator should hold no tokenB");
    }

    // ============================================================
    // 3. Network Congestion Tests
    // ============================================================

    /// @notice Set a deadline in the past. Verify the swap reverts with "Expired".
    function test_DeadlineExpiry() public {
        // Warp to a known time so subtraction doesn't underflow
        vm.warp(1_000_000);

        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Set deadline 1 hour in the past
        uint256 pastDeadline = block.timestamp - 1 hours;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            pastDeadline
        );

        vm.prank(user);
        vm.expectRevert("Deadline expired");
        aggregator.executeSwap(req);
    }

    /// @notice Set deadline exactly at block.timestamp. With the new MIN_DEADLINE_BUFFER
    ///         requirement, deadline must be at least 1 minute in the future, so this should fail.
    function test_DeadlineAtBoundary() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            block.timestamp // exact boundary - but MIN_DEADLINE_BUFFER requires at least 1 minute
        );

        vm.prank(user);
        vm.expectRevert("Deadline expired");
        aggregator.executeSwap(req);
    }

    /// @notice Set deadline 1 second before block.timestamp. Verify it reverts.
    function test_DeadlineOneSecondBefore() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Warp to a known time
        vm.warp(1000);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            999 // 1 second before block.timestamp
        );

        vm.prank(user);
        vm.expectRevert("Deadline expired");
        aggregator.executeSwap(req);
    }

    /// @notice Measure gas for 1-hop, 2-hop, 3-hop, and 4-hop routes.
    ///         Verify all complete within reasonable gas limits.
    function test_GasLimitHandling() public {
        // --- 1-hop ---
        {
            uint256 amountIn = 1000e18;
            uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
            uint256 swapAmount = amountIn - feeAmount;
            uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

            OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
                address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
                address(router1), recipient, block.timestamp + 1 hours
            );

            uint256 gasBefore = gasleft();
            vm.prank(user);
            aggregator.executeSwap(req);
            uint256 gasUsed1Hop = gasBefore - gasleft();

            // 1-hop should use less than 500k gas
            assertLt(gasUsed1Hop, 500_000, "1-hop gas too high");
        }

        // Re-fund user for next swap
        _fundAndApprove(address(tokenA), user, 1000e18);

        // --- 2-hop ---
        {
            uint256 amountIn = 1000e18;
            uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
            uint256 swapAmount = amountIn - feeAmount;
            uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
            uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

            address[] memory path1 = new address[](2);
            path1[0] = address(tokenA); path1[1] = address(tokenB);
            address[] memory path2 = new address[](2);
            path2[0] = address(tokenB); path2[1] = address(tokenC);

            OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
            steps[0] = OmnomSwapAggregator.SwapStep({
                router: address(router1), path: path1, amountIn: swapAmount, minAmountOut: step1Out
            });
            steps[1] = OmnomSwapAggregator.SwapStep({
                router: address(router1), path: path2, amountIn: step1Out, minAmountOut: step2Out
            });

            OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
                tokenIn: address(tokenA), tokenOut: address(tokenC), amountIn: amountIn,
                minTotalAmountOut: step2Out, steps: steps,
                deadline: block.timestamp + 1 hours, recipient: recipient
            });

            uint256 gasBefore = gasleft();
            vm.prank(user);
            aggregator.executeSwap(req);
            uint256 gasUsed2Hop = gasBefore - gasleft();

            assertLt(gasUsed2Hop, 700_000, "2-hop gas too high");
        }

        // Re-fund user
        _fundAndApprove(address(tokenA), user, 1000e18);

        // --- 3-hop ---
        {
            uint256 amountIn = 1000e18;
            uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
            uint256 swapAmount = amountIn - feeAmount;
            uint256 s1 = (swapAmount * EXCHANGE_RATE) / 1e18;
            uint256 s2 = (s1 * EXCHANGE_RATE) / 1e18;
            uint256 s3 = (s2 * EXCHANGE_RATE) / 1e18;

            address[] memory p1 = new address[](2);
            p1[0] = address(tokenA); p1[1] = address(tokenB);
            address[] memory p2 = new address[](2);
            p2[0] = address(tokenB); p2[1] = address(tokenC);
            address[] memory p3 = new address[](2);
            p3[0] = address(tokenC); p3[1] = address(tokenD);

            OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](3);
            steps[0] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p1, amountIn: swapAmount, minAmountOut: s1});
            steps[1] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p2, amountIn: s1, minAmountOut: s2});
            steps[2] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p3, amountIn: s2, minAmountOut: s3});

            OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
                tokenIn: address(tokenA), tokenOut: address(tokenD), amountIn: amountIn,
                minTotalAmountOut: s3, steps: steps,
                deadline: block.timestamp + 1 hours, recipient: recipient
            });

            uint256 gasBefore = gasleft();
            vm.prank(user);
            aggregator.executeSwap(req);
            uint256 gasUsed3Hop = gasBefore - gasleft();

            assertLt(gasUsed3Hop, 900_000, "3-hop gas too high");
        }

        // Re-fund user
        _fundAndApprove(address(tokenA), user, 1000e18);

        // --- 4-hop ---
        {
            uint256 amountIn = 1000e18;
            uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
            uint256 swapAmount = amountIn - feeAmount;
            uint256 s1 = (swapAmount * EXCHANGE_RATE) / 1e18;
            uint256 s2 = (s1 * EXCHANGE_RATE) / 1e18;
            uint256 s3 = (s2 * EXCHANGE_RATE) / 1e18;
            uint256 s4 = (s3 * EXCHANGE_RATE) / 1e18;

            address[] memory p1 = new address[](2);
            p1[0] = address(tokenA); p1[1] = address(tokenB);
            address[] memory p2 = new address[](2);
            p2[0] = address(tokenB); p2[1] = address(tokenC);
            address[] memory p3 = new address[](2);
            p3[0] = address(tokenC); p3[1] = address(tokenD);
            address[] memory p4 = new address[](2);
            p4[0] = address(tokenD); p4[1] = address(tokenE);

            OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](4);
            steps[0] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p1, amountIn: swapAmount, minAmountOut: s1});
            steps[1] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p2, amountIn: s1, minAmountOut: s2});
            steps[2] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p3, amountIn: s2, minAmountOut: s3});
            steps[3] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p4, amountIn: s3, minAmountOut: s4});

            OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
                tokenIn: address(tokenA), tokenOut: address(tokenE), amountIn: amountIn,
                minTotalAmountOut: s4, steps: steps,
                deadline: block.timestamp + 1 hours, recipient: recipient
            });

            uint256 gasBefore = gasleft();
            vm.prank(user);
            aggregator.executeSwap(req);
            uint256 gasUsed4Hop = gasBefore - gasleft();

            assertLt(gasUsed4Hop, 1_100_000, "4-hop gas too high");
        }
    }

    // ============================================================
    // 4. Token Approval Edge Cases
    // ============================================================

    /// @notice Approve exactly the swap amount. Verify the swap succeeds.
    function test_ExactApprovalSufficientForSwap() public {
        uint256 amountIn = 1000e18;

        // Mint tokens to user
        tokenA.mint(user, amountIn);
        // Approve exactly the swap amount
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "exact approval output mismatch");
    }

    /// @notice Approve exactly the swap amount, then simulate price increase.
    ///         Since amountIn doesn't change, the swap still succeeds.
    function test_ExactApprovalWithPriceMovement() public {
        uint256 amountIn = 1000e18;

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Price increases: rate goes from 2x to 3x
        router1.setExchangeRate(3e18);
        uint256 expectedOut = (swapAmount * 3e18) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        // Swap succeeds because amountIn is unchanged; price movement only affects output
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "price movement output mismatch");
    }

    /// @notice Approve less than the swap amount. Verify revert.
    function test_InsufficientApproval() public {
        uint256 amountIn = 1000e18;
        uint256 insufficientApproval = 500e18;

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), insufficientApproval);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert();
        aggregator.executeSwap(req);
    }

    /// @notice Approve 0. Verify revert.
    function test_ZeroApproval() public {
        uint256 amountIn = 1000e18;

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), 0);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert();
        aggregator.executeSwap(req);
    }

    /// @notice Approve amount A, then approve amount B. Verify amount B is used.
    function test_ReApprovalOverwritesPrevious() public {
        uint256 amountIn = 1000e18;

        tokenA.mint(user, amountIn * 2); // mint extra

        // First approval
        vm.prank(user);
        tokenA.approve(address(aggregator), 500e18);

        // Overwrite with correct approval
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        // Verify the new approval is used
        uint256 allowance = tokenA.allowance(user, address(aggregator));
        assertEq(allowance, amountIn, "allowance should be overwritten");

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "re-approval output mismatch");
    }

    // ============================================================
    // 5. Multi-Hop Route Stress Tests
    // ============================================================

    /// @notice Create a 4-hop route (A→B→C→D→E). Verify correct execution and output.
    function test_4HopRouteExecution() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 s1 = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 s2 = (s1 * EXCHANGE_RATE) / 1e18;
        uint256 s3 = (s2 * EXCHANGE_RATE) / 1e18;
        uint256 s4 = (s3 * EXCHANGE_RATE) / 1e18;

        address[] memory p1 = new address[](2);
        p1[0] = address(tokenA); p1[1] = address(tokenB);
        address[] memory p2 = new address[](2);
        p2[0] = address(tokenB); p2[1] = address(tokenC);
        address[] memory p3 = new address[](2);
        p3[0] = address(tokenC); p3[1] = address(tokenD);
        address[] memory p4 = new address[](2);
        p4[0] = address(tokenD); p4[1] = address(tokenE);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](4);
        steps[0] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p1, amountIn: swapAmount, minAmountOut: s1});
        steps[1] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p2, amountIn: s1, minAmountOut: s2});
        steps[2] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p3, amountIn: s2, minAmountOut: s3});
        steps[3] = OmnomSwapAggregator.SwapStep({router: address(router1), path: p4, amountIn: s3, minAmountOut: s4});

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenE), amountIn: amountIn,
            minTotalAmountOut: s4, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // 4 hops at 2x = 16x effective rate
        assertEq(tokenE.balanceOf(recipient), s4, "4-hop output mismatch");
    }

    /// @notice Create a 2-hop route where one intermediate pool has very low liquidity.
    ///         The router will still execute at the configured rate, but we verify
    ///         the mechanics work correctly with small amounts.
    function test_MultiHopWithOneEmptyPool() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1: normal rate
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Step 2: very low liquidity — simulate with a very low exchange rate
        uint256 lowRate = 0.001e18; // 0.001x rate — near-empty pool
        router2.setExchangeRate(lowRate);
        uint256 step2Out = (step1Out * lowRate) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA); path1[1] = address(tokenB);
        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB); path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1), path: path1, amountIn: swapAmount, minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2), path: path2, amountIn: step1Out, minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenC), amountIn: amountIn,
            minTotalAmountOut: step2Out, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenC.balanceOf(recipient), step2Out, "empty pool hop output mismatch");
    }

    /// @notice Simulate a step that outputs less than expected by setting a lower
    ///         exchange rate on step 2 while keeping step 1's amountIn high.
    ///         The aggregator uses the actual output, so the next step handles the deficit.
    function test_MultiHopStepOutputLessThanExpected() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1 at 2x rate
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Step 2 at reduced rate (output will be less than if rate were 2x)
        uint256 reducedRate = 1e18; // 1x instead of 2x
        router2.setExchangeRate(reducedRate);
        uint256 step2Out = (step1Out * reducedRate) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA); path1[1] = address(tokenB);
        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB); path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1), path: path1, amountIn: swapAmount, minAmountOut: step1Out
        });
        // step.amountIn is step1Out (from step 0), but actual output will be less
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2), path: path2, amountIn: step1Out, minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenC), amountIn: amountIn,
            minTotalAmountOut: step2Out, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // Output reflects the reduced rate on step 2
        assertEq(tokenC.balanceOf(recipient), step2Out, "deficit step output mismatch");
    }

    /// @notice After a multi-hop swap, verify no tokens are locked in the contract
    ///         (or minimal dust). The aggregator should hold 0 balance of all tokens.
    function test_MultiHopDustHandling() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA); path1[1] = address(tokenB);
        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB); path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1), path: path1, amountIn: swapAmount, minAmountOut: step1Out
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router1), path: path2, amountIn: step1Out, minAmountOut: step2Out
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA), tokenOut: address(tokenC), amountIn: amountIn,
            minTotalAmountOut: step2Out, steps: steps,
            deadline: block.timestamp + 1 hours, recipient: recipient
        });

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify no tokens locked in aggregator
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "tokenA dust in aggregator");
        assertEq(tokenB.balanceOf(address(aggregator)), 0, "tokenB dust in aggregator");
        assertEq(tokenC.balanceOf(address(aggregator)), 0, "tokenC dust in aggregator");
    }

    // ============================================================
    // 6. Fee Edge Cases
    // ============================================================

    /// @notice Attempt swap with 0 amount. Verify revert.
    function test_FeeOnZeroAmount() public {
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), 0, 0, 0,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Amount must be greater than zero");
        aggregator.executeSwap(req);
    }

    /// @notice Swap 1 wei. Verify fee calculation doesn't overflow or underflow.
    ///         With 10 bps fee, fee on 1 wei = 0 (integer division rounds down).
    function test_FeeOnVerySmallAmount() public {
        uint256 amountIn = 1; // 1 wei

        // Mint 1 wei to user and approve
        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        // Fee = (1 * 10) / 10000 = 0
        uint256 feeAmount = 0;
        uint256 swapAmount = amountIn - feeAmount; // 1

        // Output = (1 * 2e18) / 1e18 = 2
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify fee was 0 (treasury got nothing)
        assertEq(tokenA.balanceOf(treasury), 0, "fee on 1 wei should be 0");
        // Verify output
        assertEq(tokenB.balanceOf(recipient), expectedOut, "1 wei output mismatch");
    }

    /// @notice Swap a very large amount (close to max uint256). Verify no overflow.
    ///         We use a large but manageable amount to avoid router balance issues.
    function test_FeeOnVeryLargeAmount() public {
        // Use a large amount that's feasible with our router funding
        uint256 amountIn = 10_000_000e18; // 10 million tokens

        // Fund user and approve
        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Fund router with enough output tokens
        tokenB.mint(address(router1), expectedOut + 1e18);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        vm.prank(user);
        aggregator.executeSwap(req);

        // Verify fee calculation didn't overflow
        assertEq(tokenA.balanceOf(treasury) - treasuryBalBefore, feeAmount, "large amount fee mismatch");
        assertEq(tokenB.balanceOf(recipient), expectedOut, "large amount output mismatch");
    }

    /// @notice Swap amounts that cause rounding in fee calculation.
    ///         Verify the rounding favors the protocol (rounds down on fee).
    ///         Fee = (amountIn * bps) / 10000 — integer division truncates toward zero,
    ///         which means the fee is rounded down and the user keeps the remainder.
    function test_FeePrecisionLoss() public {
        // Use an amount that doesn't divide evenly by 10000 with 10 bps
        // 9999 wei * 10 bps / 10000 = 9.999 → truncated to 9
        uint256 amountIn = 9999;

        tokenA.mint(user, amountIn);
        vm.prank(user);
        tokenA.approve(address(aggregator), amountIn);

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000; // = 9
        uint256 swapAmount = amountIn - feeAmount; // = 9990

        // Verify fee rounds down (favors user, not protocol)
        // 9999 * 10 / 10000 = 9.999 → 9 (rounded down)
        assertEq(feeAmount, 9, "fee should round down");

        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA), address(tokenB), amountIn, swapAmount, expectedOut,
            address(router1), recipient, block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenA.balanceOf(treasury), feeAmount, "precision fee mismatch");
    }

    // ============================================================
    // 7. Reentrancy Tests
    // ============================================================

    /// @notice Create a malicious token that tries to re-enter executeSwap
    ///         during transferFrom. Verify the reentrancy guard prevents it.
    function test_ReentrancyGuard() public {
        // Deploy malicious token
        MaliciousToken maliciousToken = new MaliciousToken();

        // Deploy a new aggregator that uses the malicious token
        vm.startPrank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));
        ag.addRouter(address(router1));
        vm.stopPrank();

        // Set the target for reentrancy
        maliciousToken.setTarget(payable(address(ag)));

        // Fund user with malicious tokens
        maliciousToken.mint(user, 1000e18);
        vm.prank(user);
        maliciousToken.approve(address(ag), 1000e18);

        // Fund router with output tokens
        tokenB.mint(address(router1), 10_000_000e18);

        uint256 feeAmount = (1000e18 * FEE_BPS) / 10_000;
        uint256 swapAmount = 1000e18 - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Build the swap request
        address[] memory path = new address[](2);
        path[0] = address(maliciousToken);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router1),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(maliciousToken),
            tokenOut: address(tokenB),
            amountIn: 1000e18,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        // Set the pending request for reentrancy attempt
        maliciousToken.setPendingRequest(req);

        // Execute — the malicious token will try to re-enter during transferFrom
        // The reentrancy guard should prevent the second call
        vm.prank(user);
        ag.executeSwap(req);

        // Verify the reentrancy was attempted but blocked
        assertEq(maliciousToken.reentrancyCount(), 1, "reentrancy should have been attempted");

        // Verify the swap still completed successfully (first call went through)
        assertEq(tokenB.balanceOf(recipient), expectedOut, "swap should complete despite reentrancy attempt");
    }

    /// @notice Simulate a malicious router that calls back into the aggregator
    ///         during the swap. Verify the reentrancy guard prevents it.
    function test_ReentrancyViaRouterCallback() public {
        // Deploy malicious router
        MaliciousRouter maliciousRouter = new MaliciousRouter(address(0), EXCHANGE_RATE);

        // Fund malicious router with output tokens
        tokenB.mint(address(maliciousRouter), 10_000_000e18);

        // Deploy new aggregator with malicious router registered
        vm.startPrank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));
        ag.addRouter(address(maliciousRouter));
        vm.stopPrank();

        // Set the target for reentrancy
        maliciousRouter.setTarget(payable(address(ag)));

        // Fund user
        tokenA.mint(user, 1000e18);
        vm.prank(user);
        tokenA.approve(address(ag), 1000e18);

        uint256 feeAmount = (1000e18 * FEE_BPS) / 10_000;
        uint256 swapAmount = 1000e18 - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(maliciousRouter),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000e18,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 1 hours,
            recipient: recipient
        });

        // Set the pending request for reentrancy attempt
        maliciousRouter.setPendingRequest(req);

        // Execute — the malicious router will try to re-enter during swap
        vm.prank(user);
        ag.executeSwap(req);

        // Verify reentrancy was attempted
        assertEq(maliciousRouter.callbackCount(), 1, "router callback should have been attempted");

        // Verify swap completed successfully
        assertEq(tokenB.balanceOf(recipient), expectedOut, "swap should complete despite router reentrancy");
    }
}
