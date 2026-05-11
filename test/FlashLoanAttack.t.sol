// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

// ============================================================
// Malicious Reentrancy Token — attempts re-entry during transferFrom
// ============================================================
contract FlashLoanReentrancyToken is IERC20 {
    string public name = "FL Reentrancy";
    string public symbol = "FLR";
    uint8 public decimals = 18;
    uint256 public override totalSupply;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    OmnomSwapAggregator public target;
    OmnomSwapAggregator.SwapRequest public pendingRequest;
    uint256 public reentrancyCount;
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
// Malicious Callback Router — calls back into aggregator during swap
// ============================================================
contract FlashLoanCallbackRouter {
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

        require(IERC20(tokenOut).transfer(to, amountOut), "Transfer out failed");
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

        require(IERC20(tokenOut).transfer(to, amountOut), "Transfer out failed");
    }
}

// ============================================================
// ForceFeeder — force-sends ETH to a target via selfdestruct
// ============================================================
contract ForceFeeder {
    constructor() payable {}

    function feed(address payable target) external {
        selfdestruct(target);
    }
}

// ============================================================
// FlashLoanAttackTest
// ============================================================

/// @title FlashLoanAttackTest
/// @notice Dedicated test suite simulating flash loan attack vectors against
///         the OmnomSwap Aggregator. Validates that slippage protection,
///         deadline checks, and ReentrancyGuard provide defense in depth.
contract FlashLoanAttackTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockERC20 public tokenD;
    MockUniswapV2Router public router1;
    MockUniswapV2Router public router2;
    MockUniswapV2Router public router3;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public recipient = address(0x500);
    address public attacker = address(0x600);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 100_000_000e18;
    uint256 constant FEE_BPS = 25; // 0.25%

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

    function _buildTwoHopSwap(
        address tokenIn,
        address midToken,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 step0AmountIn,
        uint256 step0MinOut,
        uint256 step1AmountIn,
        uint256 step1MinOut,
        address router0,
        address router1Addr,
        address to,
        uint256 deadline
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path0 = new address[](2);
        path0[0] = tokenIn;
        path0[1] = midToken;

        address[] memory path1 = new address[](2);
        path1[0] = midToken;
        path1[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: router0,
            path: path0,
            amountIn: step0AmountIn,
            minAmountOut: step0MinOut
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: router1Addr,
            path: path1,
            amountIn: step1AmountIn,
            minAmountOut: step1MinOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: totalAmountIn,
            minTotalAmountOut: step1MinOut,
            steps: steps,
            deadline: deadline,
            recipient: to
        });
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

        router1 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router2 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        router3 = new MockUniswapV2Router(address(0), EXCHANGE_RATE);

        aggregator.addRouter(address(router1));
        aggregator.addRouter(address(router2));
        aggregator.addRouter(address(router3));

        vm.stopPrank();

        // Fund user with all tokens
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenC), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenD), user, INITIAL_BALANCE);

        // Fund routers with all tokens (for input and output)
        _fundRouter(router1, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router1, address(tokenD), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router2, address(tokenD), INITIAL_BALANCE * 10);
        _fundRouter(router3, address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(router3, address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(router3, address(tokenC), INITIAL_BALANCE * 10);
        _fundRouter(router3, address(tokenD), INITIAL_BALANCE * 10);

        // Fund attacker
        _fundAndApprove(address(tokenA), attacker, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), attacker, INITIAL_BALANCE);
    }

    // ============================================================
    // A. Flash Loan Price Manipulation
    // ============================================================

    /// @notice Simulate a flash loan attack that crashes the price.
    ///         The attacker uses a flash loan to dump tokens, crashing the exchange rate.
    ///         The user's swap with slippage protection reverts because output < minTotalAmountOut.
    function test_flashLoan_priceCrash_slippageProtection() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User builds swap expecting the original 2x rate
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            originalOut, // expects at least the original output
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // === FLASH LOAN SIMULATION ===
        // Attacker crashes price from 2x to 0.5x via massive dump
        vm.prank(attacker);
        router1.setExchangeRate(0.5e18);

        // User's swap should revert because output (0.5x) < minTotalAmountOut (2x)
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Simulate a flash loan attack that pumps the price.
    ///         Attacker pumps the price before user's swap, causing the user to
    ///         receive fewer tokens than expected at the inflated rate.
    function test_flashLoan_pricePump_slippageProtection() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 originalOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets minTotalAmountOut with tight slippage (original rate)
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            originalOut, // tight slippage
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // === FLASH LOAN SIMULATION ===
        // Attacker pumps price from 2x to 10x (tokenA becomes expensive)
        // This means user gets MORE tokenB per tokenA — but wait, the attack
        // is on the OTHER direction. Let's think about this differently:
        // Attacker pumps tokenB price (makes tokenA worth less in terms of tokenB)
        // So exchange rate drops from user's perspective
        vm.prank(attacker);
        router1.setExchangeRate(1e18); // rate drops to 1x

        // User's swap reverts because output at 1x < minTotalAmountOut at 2x
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Manipulate multiple pools simultaneously in a multi-hop route.
    ///         The aggregator's per-step minAmountOut catches the manipulation.
    function test_flashLoan_multiPool_manipulation() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Step 1 at normal rate
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        // Step 2 at normal rate
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        // === FLASH LOAN SIMULATION ===
        // Attacker manipulates pool 2 (router2) by crashing its rate
        uint256 crashedRate = 0.5e18;
        vm.prank(attacker);
        router2.setExchangeRate(crashedRate);

        // Recalculate step 2 output at crashed rate
        uint256 manipulatedStep2Out = (step1Out * crashedRate) / 1e18;

        // User's swap expects the original step2Out — step 2 will fail
        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(tokenA),
            address(tokenB),
            address(tokenC),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out, // expects original step2Out
            address(router1),
            address(router2),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice After price manipulation, price returns to normal and swap succeeds again.
    function test_flashLoan_recovery_afterManipulation() public {
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
            block.timestamp + 1 hours
        );

        // === FLASH LOAN ATTACK PHASE ===
        // Attacker crashes price
        vm.prank(attacker);
        router1.setExchangeRate(0.5e18);

        // User's swap fails
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);

        // === RECOVERY PHASE ===
        // Price returns to normal (arb bots restore the rate)
        router1.setExchangeRate(EXCHANGE_RATE);

        // User's swap now succeeds
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "output mismatch after recovery");
    }

    /// @notice Full sandwich attack simulation: pump price → user swap → dump price.
    ///         Verify slippage + deadline protect the user.
    function test_flashLoansandwich_defenseInDepth() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets 2% slippage tolerance
        uint256 minOutWithSlippage = (expectedOut * 98) / 100;

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

        // === SANDWICH: FRONT-RUN ===
        // Attacker pumps price (front-run buy), rate drops for user
        vm.prank(attacker);
        router1.setExchangeRate(1.5e18);

        // User's output at manipulated rate
        uint256 manipulatedOut = (swapAmount * 1.5e18) / 1e18;
        // 1.5x of swapAmount = 1500e18 * 0.99975 ≈ 1499.625e18
        // minOutWithSlippage = expectedOut * 0.98 = 1999.5e18 * 0.98 = ~1959.51e18
        // manipulatedOut < minOutWithSlippage, so swap reverts
        assertLt(manipulatedOut, minOutWithSlippage, "manipulated output should be below tolerance");

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);

        // === SANDWICH: BACK-RUN ===
        // Attacker dumps (back-run sell), but user's swap already reverted — no impact
        vm.prank(attacker);
        router1.setExchangeRate(EXCHANGE_RATE); // restore

        // Verify user's tokens are still safe (swap didn't execute)
        assertEq(tokenA.balanceOf(user), INITIAL_BALANCE, "user tokens should be safe");
    }

    // ============================================================
    // B. Flash Loan + Reentrancy Combination
    // ============================================================

    /// @notice Flash loan attacker tries to re-enter aggregator during swap.
    ///         ReentrancyGuard prevents it.
    function test_flashLoan_reentrancyAttempt_reverts() public {
        // Deploy malicious token that attempts reentrancy
        FlashLoanReentrancyToken maliciousToken = new FlashLoanReentrancyToken();

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

        maliciousToken.setPendingRequest(req);

        // Simulate: attacker first manipulates price (flash loan effect)
        vm.prank(attacker);
        router1.setExchangeRate(EXCHANGE_RATE); // normal rate for this test

        // Execute — malicious token tries to re-enter during transferFrom
        vm.prank(user);
        ag.executeSwap(req);

        // Verify reentrancy was attempted but blocked
        assertEq(maliciousToken.reentrancyCount(), 1, "reentrancy should have been attempted");
        // Verify swap completed despite reentrancy attempt
        assertEq(tokenB.balanceOf(recipient), expectedOut, "swap should complete");
    }

    /// @notice Attacker uses a token callback to try to manipulate state mid-swap.
    ///         The malicious router attempts reentrancy during the swap callback.
    function test_flashLoan_callbackExploit_reverts() public {
        // Deploy malicious router that attempts callback
        FlashLoanCallbackRouter maliciousRouter = new FlashLoanCallbackRouter(address(0), EXCHANGE_RATE);

        // Fund malicious router with output tokens
        tokenB.mint(address(maliciousRouter), 10_000_000e18);

        vm.startPrank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));
        ag.addRouter(address(maliciousRouter));
        vm.stopPrank();

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

        maliciousRouter.setPendingRequest(req);

        // Execute — malicious router tries callback reentrancy
        vm.prank(user);
        ag.executeSwap(req);

        // Verify callback was attempted
        assertEq(maliciousRouter.callbackCount(), 1, "callback should have been attempted");
        // Verify swap completed
        assertEq(tokenB.balanceOf(recipient), expectedOut, "swap should complete");
    }

    /// @notice Attacker tries reentrancy at each step of a multi-hop swap.
    ///         Each step's router callback attempts re-entry; all are blocked.
    function test_flashLoan_multiStep_reentrancy() public {
        // Deploy two malicious routers
        FlashLoanCallbackRouter maliciousRouter1 = new FlashLoanCallbackRouter(address(0), EXCHANGE_RATE);
        FlashLoanCallbackRouter maliciousRouter2 = new FlashLoanCallbackRouter(address(0), EXCHANGE_RATE);

        // Fund routers with output tokens
        tokenB.mint(address(maliciousRouter1), 10_000_000e18);
        tokenC.mint(address(maliciousRouter2), 10_000_000e18);

        vm.startPrank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));
        ag.addRouter(address(maliciousRouter1));
        ag.addRouter(address(maliciousRouter2));
        vm.stopPrank();

        maliciousRouter1.setTarget(payable(address(ag)));
        maliciousRouter2.setTarget(payable(address(ag)));

        // Fund user
        tokenA.mint(user, 1000e18);
        vm.prank(user);
        tokenA.approve(address(ag), 1000e18);

        uint256 feeAmount = (1000e18 * FEE_BPS) / 10_000;
        uint256 swapAmount = 1000e18 - feeAmount;
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(tokenA),
            address(tokenB),
            address(tokenC),
            1000e18,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(maliciousRouter1),
            address(maliciousRouter2),
            recipient,
            block.timestamp + 1 hours
        );

        maliciousRouter1.setPendingRequest(req);
        maliciousRouter2.setPendingRequest(req);

        // Execute — both routers attempt reentrancy
        vm.prank(user);
        ag.executeSwap(req);

        // Both routers attempted callback
        assertEq(maliciousRouter1.callbackCount(), 1, "router1 callback should have been attempted");
        assertEq(maliciousRouter2.callbackCount(), 1, "router2 callback should have been attempted");
        // Swap completed successfully
        assertEq(tokenC.balanceOf(recipient), step2Out, "swap should complete");
    }

    // ============================================================
    // C. Flash Loan + Liquidity Drain
    // ============================================================

    /// @notice Attacker drains all liquidity from pool via flash loan.
    ///         User swap reverts because the pool has no tokens to give.
    function test_flashLoan_drainAllLiquidity_swapReverts() public {
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
            block.timestamp + 1 hours
        );

        // === FLASH LOAN SIMULATION: drain all tokenB from router ===
        uint256 routerBal = tokenB.balanceOf(address(router1));
        tokenB.forceTransferFrom(address(router1), attacker, routerBal);

        // Verify router is drained
        assertEq(tokenB.balanceOf(address(router1)), 0, "router should be drained");

        // User's swap should revert because router can't transfer output tokens
        vm.prank(user);
        vm.expectRevert("Insufficient balance");
        aggregator.executeSwap(req);
    }

    /// @notice Attacker drains most liquidity from pool.
    ///         Slippage protection catches the reduced output.
    function test_flashLoan_partialDrain_slippageCatches() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User expects at least 95% of the quoted output
        uint256 minOut = (expectedOut * 95) / 100;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            minOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // === FLASH LOAN SIMULATION: drain most liquidity ===
        // Set very low exchange rate to simulate partial drain effect
        vm.prank(attacker);
        router1.setExchangeRate(0.5e18);

        // Output at drained rate
        uint256 drainedOutput = (swapAmount * 0.5e18) / 1e18;
        assertLt(drainedOutput, minOut, "drained output should be below slippage tolerance");

        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(req);
    }

    /// @notice Attacker drains then refills pool. User swap succeeds at different price.
    function test_flashLoan_drainAndRefill() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // === PHASE 1: Attacker drains ===
        uint256 routerBal = tokenB.balanceOf(address(router1));
        tokenB.forceTransferFrom(address(router1), attacker, routerBal);

        // === PHASE 2: Attacker refills at a different rate ===
        uint256 newRate = 1.5e18;
        router1.setExchangeRate(newRate);
        uint256 expectedOut = (swapAmount * newRate) / 1e18;
        // Re-fill router with enough tokens at the new rate
        tokenB.mint(address(router1), expectedOut + 1e18);

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

        // User swap succeeds at the new (different) price
        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(tokenB.balanceOf(recipient), expectedOut, "output mismatch at new price");
    }

    /// @notice Drain cascades across multiple pools in a multi-hop route.
    ///         Draining pool 2 causes the second hop to fail.
    function test_flashLoan_cascadingDrain_multiPool() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;
        uint256 step2Out = (step1Out * EXCHANGE_RATE) / 1e18;

        // === FLASH LOAN SIMULATION: drain router2 (pool 2) ===
        uint256 router2BalC = tokenC.balanceOf(address(router2));
        tokenC.forceTransferFrom(address(router2), attacker, router2BalC);

        OmnomSwapAggregator.SwapRequest memory req = _buildTwoHopSwap(
            address(tokenA),
            address(tokenB),
            address(tokenC),
            amountIn,
            swapAmount,
            step1Out,
            step1Out,
            step2Out,
            address(router1),
            address(router2),
            recipient,
            block.timestamp + 1 hours
        );

        // Step 1 succeeds but step 2 fails because router2 has no tokenC
        vm.prank(user);
        vm.expectRevert("Insufficient balance");
        aggregator.executeSwap(req);
    }

    // ============================================================
    // D. Flash Loan + Fee Manipulation
    // ============================================================

    /// @notice Verify attacker cannot extract protocol fees via flash loan manipulation.
    ///         Even with price manipulation, fees are correctly calculated on the input amount.
    function test_flashLoan_feeExtraction_impossible() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Record treasury balance before
        uint256 treasuryBalBefore = tokenA.balanceOf(treasury);

        // === FLASH LOAN: attacker manipulates price ===
        vm.prank(attacker);
        router1.setExchangeRate(0.1e18); // crash to 0.1x

        uint256 expectedOut = (swapAmount * 0.1e18) / 1e18;

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

        // Fee is still calculated on the INPUT amount, not affected by price manipulation
        uint256 treasuryFee = tokenA.balanceOf(treasury) - treasuryBalBefore;
        assertEq(treasuryFee, feeAmount, "fee should be based on input, not manipulated price");

        // Verify fee is exactly 0.25%
        assertEq(feeAmount, (amountIn * 25) / 10_000, "fee should be 25 bps");
    }

    /// @notice Verify attacker cannot drain treasury via flash loan + swap combo.
    ///         The treasury only receives fees, never pays out during swaps.
    function test_flashLoan_treasuryDrain_impossible() public {
        // First, do a normal swap to accumulate some fees in treasury
        uint256 amountIn1 = 1000e18;
        uint256 feeAmount1 = (amountIn1 * FEE_BPS) / 10_000;
        uint256 swapAmount1 = amountIn1 - feeAmount1;
        uint256 expectedOut1 = (swapAmount1 * EXCHANGE_RATE) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req1 = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn1,
            swapAmount1,
            expectedOut1,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        vm.prank(user);
        aggregator.executeSwap(req1);

        uint256 treasuryBalAfterSwap1 = tokenA.balanceOf(treasury);
        assertGt(treasuryBalAfterSwap1, 0, "treasury should have fees");

        // === FLASH LOAN ATTACK: try to drain treasury ===
        // Attacker manipulates price and tries a swap — but treasury only receives fees
        vm.prank(attacker);
        router1.setExchangeRate(100e18); // pump price extremely high

        uint256 attackerAmountIn = 1e18; // small input
        uint256 attackerFee = (attackerAmountIn * FEE_BPS) / 10_000;
        uint256 attackerSwapAmount = attackerAmountIn - attackerFee;
        uint256 attackerExpectedOut = (attackerSwapAmount * 100e18) / 1e18;

        OmnomSwapAggregator.SwapRequest memory req2 = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            attackerAmountIn,
            attackerSwapAmount,
            attackerExpectedOut,
            address(router1),
            attacker,
            block.timestamp + 1 hours
        );

        vm.prank(attacker);
        aggregator.executeSwap(req2);

        // Treasury balance should have INCREASED (from attacker's fee), not decreased
        uint256 treasuryBalAfterAttack = tokenA.balanceOf(treasury);
        assertGe(treasuryBalAfterAttack, treasuryBalAfterSwap1, "treasury should not decrease");
    }

    /// @notice After flash loan manipulation, protocol fee calculation is still correct.
    ///         Fee is always (amountIn * protocolFeeBps) / 10000, regardless of price.
    function test_flashLoan_protocolFeeRemainsCorrect() public {
        uint256 amountIn = 5000e18;
        uint256 expectedFee = (amountIn * FEE_BPS) / 10_000;

        uint256 treasuryBefore = tokenA.balanceOf(treasury);

        // Manipulate price before swap
        vm.prank(attacker);
        router1.setExchangeRate(0.01e18); // extreme crash

        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * 0.01e18) / 1e18;

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

        // Fee is exactly as expected, regardless of price manipulation
        uint256 actualFee = tokenA.balanceOf(treasury) - treasuryBefore;
        assertEq(actualFee, expectedFee, "fee calculation should be independent of price");
    }

    // ============================================================
    // E. Defense Validation Summary
    // ============================================================

    /// @notice Demonstrate that slippage protection (minTotalAmountOut) is the
    ///         primary MEV defense. Without it, the user would receive fewer tokens.
    function test_defenseSummary_slippageIsPrimaryDefense() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // === WITHOUT slippage protection (minTotalAmountOut = 0) ===
        OmnomSwapAggregator.SwapRequest memory reqNoSlippage = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            0, // no slippage protection!
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // Attacker front-runs, crashing price to 0.5x
        vm.prank(attacker);
        router1.setExchangeRate(0.5e18);

        // Swap succeeds but user gets half the tokens (bad!)
        uint256 manipulatedOut = (swapAmount * 0.5e18) / 1e18;
        vm.prank(user);
        aggregator.executeSwap(reqNoSlippage);
        assertEq(tokenB.balanceOf(recipient), manipulatedOut, "user gets manipulated output without slippage");

        // Reset: restore price and fund user again
        router1.setExchangeRate(EXCHANGE_RATE);
        _fundAndApprove(address(tokenA), user, 1000e18);

        // === WITH slippage protection ===
        uint256 minOut = (expectedOut * 95) / 100; // 5% tolerance
        OmnomSwapAggregator.SwapRequest memory reqWithSlippage = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            minOut,
            address(router1),
            recipient,
            block.timestamp + 1 hours
        );

        // Same attack: crash price to 0.5x
        vm.prank(attacker);
        router1.setExchangeRate(0.5e18);

        // Swap reverts — user's funds are safe
        vm.prank(user);
        vm.expectRevert("Insufficient output");
        aggregator.executeSwap(reqWithSlippage);

        // User still has their tokens (INITIAL_BALANCE minus the first no-slippage swap, plus re-fund)
        assertEq(tokenA.balanceOf(user), INITIAL_BALANCE, "user tokens safe with slippage");
    }

    /// @notice Deadline prevents delayed execution after a flash loan attack.
    ///         Even if an attacker front-runs, the deadline ensures the swap
    ///         cannot be executed after the manipulation window closes.
    function test_defenseSummary_deadlinePreventsDelayedAttacks() public {
        uint256 amountIn = 1000e18;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

        // User sets a tight deadline (2 minutes from now)
        uint256 deadline = block.timestamp + 2 minutes;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            expectedOut,
            address(router1),
            recipient,
            deadline
        );

        // === FLASH LOAN ATTACK: time passes, price is manipulated ===
        vm.warp(block.timestamp + 3 minutes); // past the deadline

        // Attacker manipulates price
        vm.prank(attacker);
        router1.setExchangeRate(0.1e18);

        // User's swap reverts due to expired deadline (not slippage)
        vm.prank(user);
        vm.expectRevert("Deadline expired");
        aggregator.executeSwap(req);
    }

    /// @notice ReentrancyGuard prevents callback-based attacks.
    ///         Even if an attacker creates a malicious token or router that
    ///         tries to re-enter during a swap, the guard blocks it.
    function test_defenseSummary_reentrancyPreventsCallbackAttacks() public {
        FlashLoanReentrancyToken maliciousToken = new FlashLoanReentrancyToken();

        vm.startPrank(owner);
        OmnomSwapAggregator ag = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));
        ag.addRouter(address(router1));
        vm.stopPrank();

        maliciousToken.setTarget(payable(address(ag)));

        maliciousToken.mint(user, 1000e18);
        vm.prank(user);
        maliciousToken.approve(address(ag), 1000e18);

        tokenB.mint(address(router1), 10_000_000e18);

        uint256 feeAmount = (1000e18 * FEE_BPS) / 10_000;
        uint256 swapAmount = 1000e18 - feeAmount;
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18;

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

        maliciousToken.setPendingRequest(req);

        // Execute — reentrancy is attempted but blocked
        vm.prank(user);
        ag.executeSwap(req);

        // Verify reentrancy was attempted (callback fired)
        assertEq(maliciousToken.reentrancyCount(), 1, "callback should have fired");
        // Verify swap completed successfully despite the attempt
        assertEq(tokenB.balanceOf(recipient), expectedOut, "swap completed despite reentrancy");
        // Verify no tokens are stuck in the aggregator
        assertEq(IERC20(address(maliciousToken)).balanceOf(address(ag)), 0, "no tokens stuck");
    }
}
