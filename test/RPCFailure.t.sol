// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockFailingRouter.sol";
import "../contracts/mocks/MockWWDOGE.sol";

// ============================================================
// Inline Mocks
// ============================================================

/// @notice Token that can have transfers disabled for testing revert scenarios.
contract MockRevertingTransferToken {
    string public name = "RevertingTransfer";
    string public symbol = "RTT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public transfersEnabled = true;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function setTransfersEnabled(bool enabled) external {
        transfersEnabled = enabled;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(transfersEnabled, "Transfers disabled");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(transfersEnabled, "Transfers disabled");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @notice Token that blocks approve for a specific spender address.
contract MockBlockedApproveToken {
    string public name = "BlockedApprove";
    string public symbol = "BAT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public blockedSpender;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function setBlockedSpender(address spender) external {
        blockedSpender = spender;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        require(spender != blockedSpender, "Approve blocked for spender");
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ============================================================
// Test Contract
// ============================================================

/// @title RPCFailureTest
/// @notice Tests for router failure simulation, unexpected token behavior,
///         state corruption prevention, and multiple failure modes.
contract RPCFailureTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockUniswapV2Router public goodRouter;
    MockFailingRouter public failingRouter;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public nonOwner = address(0x400);
    address public recipient = address(0x500);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 25; // 0.25%

    // --- Helpers ------------------------------------------------------

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

    function _fundAndApprove(address tokenAddr, address _user, uint256 amount) internal {
        MockERC20(tokenAddr).mint(_user, amount);
        vm.prank(_user);
        MockERC20(tokenAddr).approve(address(aggregator), amount);
    }

    function _fundRouter(address tokenAddr, uint256 amount) internal {
        MockERC20(tokenAddr).mint(address(goodRouter), amount);
        MockERC20(tokenAddr).mint(address(failingRouter), amount);
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

        goodRouter = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        failingRouter = new MockFailingRouter();
        failingRouter.setExchangeRate(EXCHANGE_RATE);

        aggregator.addRouter(address(goodRouter));
        aggregator.addRouter(address(failingRouter));

        vm.stopPrank();

        // Fund user
        _fundAndApprove(address(tokenA), user, INITIAL_BALANCE);
        _fundAndApprove(address(tokenB), user, INITIAL_BALANCE);

        // Fund routers with output tokens
        _fundRouter(address(tokenB), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenA), INITIAL_BALANCE * 10);
        _fundRouter(address(tokenC), INITIAL_BALANCE * 10);
    }

    // ===================================================================
    // A. Router Revert Scenarios
    // ===================================================================

    function test_routerRevertAlways_swapFails() public {
        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertAlways);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(failingRouter),
            recipient,
            block.timestamp + 30 minutes
        );

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);
    }

    function test_routerRevertOnSwap_catchesFailure() public {
        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertOnSwap);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(failingRouter),
            recipient,
            block.timestamp + 30 minutes
        );

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);
    }

    function test_routerPartialFail_secondHopFails() public {
        failingRouter.setFailMode(MockFailingRouter.FailMode.PartialFail);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;
        uint256 step1Out = (swapAmount * EXCHANGE_RATE) / 1e18;

        // Build 2-hop swap: tokenA → tokenB → tokenC, both through failingRouter
        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(failingRouter),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(failingRouter),
            path: path2,
            amountIn: step1Out,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: partial failure");
        aggregator.executeSwap(req);
    }

    function test_routerReturnZero_slippageCatches() public {
        failingRouter.setFailMode(MockFailingRouter.FailMode.ReturnZero);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        // Set minAmountOut > 0 so the aggregator's balance-diff check catches it
        uint256 minOut = 1;

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            amountIn,
            swapAmount,
            minOut,
            address(failingRouter),
            recipient,
            block.timestamp + 30 minutes
        );

        vm.prank(user);
        vm.expectRevert("Insufficient output after tax");
        aggregator.executeSwap(req);
    }

    // ===================================================================
    // B. Unexpected Token Behavior
    // ===================================================================

    function test_tokenTransferFails_swapReverts() public {
        MockRevertingTransferToken revertToken = new MockRevertingTransferToken();

        // Register the good router for this token
        // Fund user and approve
        revertToken.mint(user, SWAP_AMOUNT);
        vm.prank(user);
        revertToken.approve(address(aggregator), SWAP_AMOUNT);

        // Fund router with output tokens
        tokenB.mint(address(goodRouter), INITIAL_BALANCE);

        // Build swap request
        address[] memory path = new address[](2);
        path[0] = address(revertToken);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(goodRouter),
            path: path,
            amountIn: SWAP_AMOUNT,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(revertToken),
            tokenOut: address(tokenB),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        // Disable transfers
        revertToken.setTransfersEnabled(false);

        vm.prank(user);
        vm.expectRevert("Transfers disabled");
        aggregator.executeSwap(req);
    }

    function test_tokenApproveFails_handledBySafeERC20() public {
        MockBlockedApproveToken blockedToken = new MockBlockedApproveToken();

        // Block approve for the goodRouter address
        blockedToken.setBlockedSpender(address(goodRouter));

        // Fund user and approve aggregator (not blocked)
        blockedToken.mint(user, SWAP_AMOUNT);
        vm.prank(user);
        blockedToken.approve(address(aggregator), SWAP_AMOUNT);

        // Fund router with output tokens
        tokenB.mint(address(goodRouter), INITIAL_BALANCE);

        // Build swap request
        address[] memory path = new address[](2);
        path[0] = address(blockedToken);
        path[1] = address(tokenB);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(goodRouter),
            path: path,
            amountIn: SWAP_AMOUNT,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(blockedToken),
            tokenOut: address(tokenB),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        // Swap should revert when aggregator tries to approve router via SafeERC20
        vm.prank(user);
        vm.expectRevert("Approve blocked for spender");
        aggregator.executeSwap(req);
    }

    function test_zeroDecimalsToken_swapSucceeds() public {
        MockERC20 zeroDecToken = new MockERC20("Zero Dec", "ZD", 0);
        MockERC20 outToken = new MockERC20("Out Token", "OUT", 0);

        // goodRouter is already registered in setUp

        // Fund user
        zeroDecToken.mint(user, 10000);
        vm.prank(user);
        zeroDecToken.approve(address(aggregator), 10000);

        // Fund router with output tokens
        outToken.mint(address(goodRouter), 100000);

        // Calculate expected output
        uint256 amountIn = 1000;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000; // 2
        uint256 swapAmount = amountIn - feeAmount; // 998
        uint256 expectedOut = (swapAmount * EXCHANGE_RATE) / 1e18; // 1996

        address[] memory path = new address[](2);
        path[0] = address(zeroDecToken);
        path[1] = address(outToken);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(goodRouter),
            path: path,
            amountIn: swapAmount,
            minAmountOut: expectedOut
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(zeroDecToken),
            tokenOut: address(outToken),
            amountIn: amountIn,
            minTotalAmountOut: expectedOut,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        uint256 recipientBalBefore = outToken.balanceOf(recipient);

        vm.prank(user);
        aggregator.executeSwap(req);

        assertEq(outToken.balanceOf(recipient) - recipientBalBefore, expectedOut, "zero-dec swap output mismatch");
    }

    // ===================================================================
    // C. State Corruption Prevention
    // ===================================================================

    function test_failedSwap_noResidualBalance() public {
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "aggregator should start with 0 tokens");

        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertOnSwap);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(failingRouter),
            recipient,
            block.timestamp + 30 minutes
        );

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);

        // After revert, aggregator should have no residual tokens
        assertEq(tokenA.balanceOf(address(aggregator)), 0, "no residual balance after failed swap");
    }

    function test_failedSwap_noResidualAllowance() public {
        // Check initial allowance is 0
        assertEq(tokenA.allowance(address(aggregator), address(failingRouter)), 0, "initial allowance should be 0");

        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertOnSwap);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(failingRouter),
            recipient,
            block.timestamp + 30 minutes
        );

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);

        // After revert, no lingering approvals to routers
        assertEq(
            tokenA.allowance(address(aggregator), address(failingRouter)),
            0,
            "no residual allowance after failed swap"
        );
    }

    function test_failedSwap_userKeepsTokens() public {
        uint256 userBalBefore = tokenA.balanceOf(user);

        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertOnSwap);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(failingRouter),
            recipient,
            block.timestamp + 30 minutes
        );

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);

        // User balance unchanged after failed swap
        assertEq(tokenA.balanceOf(user), userBalBefore, "user should keep tokens after failed swap");
    }

    // ===================================================================
    // D. Multiple Failure Modes
    // ===================================================================

    function test_firstRouterFails_secondRouterSucceeds() public {
        // Multi-step: first step uses failing router, second uses good router.
        // Since the first step fails, the entire atomic swap reverts.
        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertAlways);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(failingRouter),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(goodRouter),
            path: path2,
            amountIn: 0, // will be set by aggregator from step 0 output
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);
    }

    function test_allRoutersFail_cascadeRevert() public {
        // Deploy a second failing router
        MockFailingRouter failingRouter2 = new MockFailingRouter();
        failingRouter2.setExchangeRate(EXCHANGE_RATE);
        failingRouter2.setFailMode(MockFailingRouter.FailMode.RevertAlways);

        vm.prank(owner);
        aggregator.addRouter(address(failingRouter2));

        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertAlways);

        uint256 amountIn = SWAP_AMOUNT;
        uint256 feeAmount = (amountIn * FEE_BPS) / 10_000;
        uint256 swapAmount = amountIn - feeAmount;

        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(tokenB);

        address[] memory path2 = new address[](2);
        path2[0] = address(tokenB);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(failingRouter),
            path: path1,
            amountIn: swapAmount,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(failingRouter2),
            path: path2,
            amountIn: 0,
            minAmountOut: 0
        });

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: block.timestamp + 30 minutes,
            recipient: recipient
        });

        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);
    }

    /// @notice Test that a router revert is handled correctly when router fails.
    /// @dev The MockFailingRouter's OOG mode is only implemented in swapExactTokensForTokens,
    ///      not in swapExactTokensForTokensSupportingFeeOnTransferTokens (which the aggregator uses).
    ///      We use RevertOnSwap mode instead, which IS supported in the SupportingFeeOnTransfer variant.
    function test_routerOOG_swapReverts() public {
        failingRouter.setFailMode(MockFailingRouter.FailMode.RevertOnSwap);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwapRequest(
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(failingRouter),
            recipient,
            block.timestamp + 30 minutes
        );

        // The swap should fail because the router reverts
        vm.prank(user);
        vm.expectRevert("MockFailingRouter: swap failed");
        aggregator.executeSwap(req);
    }
}
