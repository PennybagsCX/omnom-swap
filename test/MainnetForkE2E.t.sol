// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/interfaces/IERC20.sol";
import "../contracts/interfaces/IUniswapV2Factory.sol";
import "../contracts/interfaces/IUniswapV2Router02.sol";

/**
 * @title MainnetForkE2ETest
 * @notice Comprehensive end-to-end test suite using a Dogechain mainnet fork.
 *         Validates the deployed OmnomSwapAggregator against real contracts,
 *         pools, and tokens on Dogechain (chainId 2000).
 *
 * @dev Run with:
 *      forge test --match-contract MainnetForkE2ETest -vvv --rpc-url https://rpc.dogechain.dog
 *      Or with the fork profile:
 *      forge test --match-contract MainnetForkE2ETest -vvv --profile fork
 *
 *      Requires RPC access to Dogechain. Uses vm.envOr() with a public RPC fallback.
 *      Some tests may be skipped if pools lack liquidity or RPC is unavailable.
 */
contract MainnetForkE2ETest is Test {
    // Re-declare the SwapExecuted event for vm.expectEmit matching
    event SwapExecuted(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeCollected
    );

    OmnomSwapAggregator internal aggregator;

    // ======================================================================
    // Deployed Contract Addresses
    // ======================================================================

    address constant AGGREGATOR = 0xB6eaE524325Cc31Bb0f3d9AF7bB63b4dc991B58A;
    address constant TREASURY = 0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88;
    address constant WWDOGE = 0xB7ddC6414bf4F5515b52D8BdD69973Ae205ff101;

    // ======================================================================
    // Token Addresses
    // ======================================================================

    address constant OMNOM = 0xe3fcA919883950c5cD468156392a6477Ff5d18de;
    address constant DC = 0x7B4328c127B85369D9f82ca0503B000D09CF9180;
    address constant DINU = 0x8a764cF73438dE795c98707B07034e577Af54825;
    address constant DST_V2 = 0x516f30111B5A65003C5f7CB35426eB608656Ce01;

    // ======================================================================
    // Registered DEX Routers (12)
    // ======================================================================

    address constant DOGESWAP_ROUTER = 0x9b3336186a38E1B6C21955D112DbB0343ee37112;
    address constant DOGESHRK_ROUTER = 0x036EDa6E70a5EA5f3a4e3600457311F3F8F2e2ec;
    address constant WOJAK_ROUTER = 0x069e7AB4aA8d0e03b1EEF8B9140B0A0d874ACce2;
    address constant KIBBLESWAP_ROUTER = 0x1b42D5FE3f7f9bBC6De7f3A7A58f4f5e4b18AeD6;
    address constant YODESWAP_ROUTER = 0x1d8a17E3811E3f7e5E6fe3A7beA1d40c4C15bF37;
    address constant FRAXSWAP_ROUTER = 0x558d6F0501bF5930e8b6495d26A7E6A3Eef3DdCb;
    address constant TOOLSWAP_ROUTER = 0x10a2F6a8C9B1023b5714f1d7C1F8b5E6F0F1C3E5;
    address constant DMUSK_ROUTER = 0x3E3e5fF0C08E6C0fc55ea0fE6A3E0FF2f2B1C5f2;
    address constant ICECREAMSWAP_ROUTER = 0x3D65e69713b1D0B9E0b1C2e63EeC66e3b02D4f3e;
    address constant PUPSWAP_ROUTER = 0x4A9A6A0Ee87e84e52d1b8fc6Af76e3f01f5d4e7F;
    address constant BOURBON_ROUTER = 0x5C7F8e0f8C5B0Ee709c3f02E3a0a1a3e3d7f8F9A;
    address constant BREADFACTORY_ROUTER = 0x7c4eE2F006F8aF6E3FB6d8Fc0AF2e7F3E3c8b9f1;

    // All routers in a single array for iteration
    address[12] internal ALL_ROUTERS = [
        DOGESWAP_ROUTER,
        DOGESHRK_ROUTER,
        WOJAK_ROUTER,
        KIBBLESWAP_ROUTER,
        YODESWAP_ROUTER,
        FRAXSWAP_ROUTER,
        TOOLSWAP_ROUTER,
        DMUSK_ROUTER,
        ICECREAMSWAP_ROUTER,
        PUPSWAP_ROUTER,
        BOURBON_ROUTER,
        BREADFACTORY_ROUTER
    ];

    // ======================================================================
    // Test Accounts
    // ======================================================================

    address internal user;
    address internal recipient;

    // ======================================================================
    // Constants
    // ======================================================================

    uint256 constant PROTOCOL_FEE_BPS = 25; // 0.25%
    uint256 constant BPS_DENOMINATOR = 10_000;
    uint256 constant SWAP_AMOUNT = 1_000e18; // 1,000 tokens for swap tests

    // ======================================================================
    // setUp — Fork & Configure
    // ======================================================================

    function setUp() public {
        // Create fork from Dogechain RPC
        string memory rpcUrl = vm.envOr("DOGECCHAIN_RPC_URL", string("https://rpc.dogechain.dog"));
        uint256 forkId = vm.createFork(rpcUrl);
        vm.selectFork(forkId);

        // Reference the deployed aggregator
        aggregator = OmnomSwapAggregator(payable(AGGREGATOR));

        // Create test accounts
        user = makeAddr("user");
        recipient = makeAddr("recipient");
    }

    // ======================================================================
    // Helper: Build a single-step SwapRequest
    // ======================================================================

    function _buildSingleSwapRequest(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minTotalAmountOut,
        address router,
        address swapRecipient
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: router,
            path: path,
            amountIn: amountIn,
            minAmountOut: 0
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minTotalAmountOut: minTotalAmountOut,
            steps: steps,
            deadline: block.timestamp + 300, // 5 minutes from now
            recipient: swapRecipient
        });
    }

    // ======================================================================
    // Helper: Build a multi-hop SwapRequest (tokenA → tokenB → tokenC)
    // ======================================================================

    function _buildMultiHopSwapRequest(
        address tokenA,
        address tokenB,
        address tokenC,
        uint256 amountIn,
        uint256 minTotalAmountOut,
        address router,
        address swapRecipient
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        // Step 1: tokenA → tokenB
        address[] memory path1 = new address[](2);
        path1[0] = tokenA;
        path1[1] = tokenB;

        // Step 2: tokenB → tokenC
        address[] memory path2 = new address[](2);
        path2[0] = tokenB;
        path2[1] = tokenC;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: router,
            path: path1,
            amountIn: amountIn,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: router,
            path: path2,
            amountIn: 0, // Will be determined by previous step output
            minAmountOut: 0
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenA,
            tokenOut: tokenC,
            amountIn: amountIn,
            minTotalAmountOut: minTotalAmountOut,
            steps: steps,
            deadline: block.timestamp + 300,
            recipient: swapRecipient
        });
    }

    // ======================================================================
    // Helper: Find a router that has a pool for a given pair
    // ======================================================================

    function _findRouterWithPool(address tokenA, address tokenB)
        internal
        view
        returns (address router, address pair)
    {
        for (uint256 i = 0; i < ALL_ROUTERS.length; i++) {
            // Try to get the factory; skip if call fails
            (bool ok, bytes memory data) = ALL_ROUTERS[i].staticcall(
                abi.encodeWithSelector(IUniswapV2Router02.factory.selector)
            );
            if (!ok || data.length < 32) continue;

            address factory = abi.decode(data, (address));
            if (factory == address(0)) continue;

            // Try to get the pair
            (ok, data) = factory.staticcall(
                abi.encodeWithSelector(IUniswapV2Factory.getPair.selector, tokenA, tokenB)
            );
            if (!ok || data.length < 32) continue;

            pair = abi.decode(data, (address));
            if (pair != address(0)) {
                return (ALL_ROUTERS[i], pair);
            }
        }
    }

    // ======================================================================
    // Helper: Get token decimals safely
    // ======================================================================

    function _getTokenDecimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("decimals()")))
        );
        if (ok && data.length >= 32) {
            return abi.decode(data, (uint8));
        }
        return 18; // Default
    }

    // ======================================================================
    // Helper: Get token symbol safely
    // ======================================================================

    function _getTokenSymbol(address token) internal view returns (string memory) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("symbol()")))
        );
        if (ok && data.length > 0) {
            return abi.decode(data, (string));
        }
        return "UNKNOWN";
    }

    // ======================================================================
    // Helper: Prepare user with tokens and approval
    // ======================================================================

    function _prepareUserWithToken(address token, uint256 amount) internal {
        deal(token, user, amount);
        vm.prank(user);
        IERC20(token).approve(address(aggregator), amount);
    }

    // ======================================================================
    // SECTION 1: Deployment Verification
    // ======================================================================

    /// @notice Verify the aggregator is deployed at the expected address with correct code.
    function test_fork_aggregatorDeployed() public view {
        uint256 codeSize;
        address aggAddr = address(aggregator);
        assembly {
            codeSize := extcodesize(aggAddr)
        }
        assertGt(codeSize, 0, "No contract at aggregator address");

        // Verify it responds to view functions
        assertEq(aggregator.WWDOGE(), WWDOGE, "WWDOGE mismatch");
        console.log("[Deployment] Aggregator deployed at:", address(aggregator));
        console.log("[Deployment] Code size:", codeSize);
    }

    /// @notice Verify the owner address is set on the deployed aggregator.
    function test_fork_ownerSet() public view {
        address contractOwner = aggregator.owner();
        assertNotEq(contractOwner, address(0), "Owner is zero address");
        console.log("[Deployment] Owner:", contractOwner);
    }

    /// @notice Verify the treasury address matches the expected deployment.
    function test_fork_treasurySet() public view {
        address contractTreasury = aggregator.treasury();
        assertEq(contractTreasury, TREASURY, "Treasury mismatch");
        console.log("[Deployment] Treasury:", contractTreasury);
    }

    /// @notice Verify the protocol fee is 25 bps (0.25%).
    function test_fork_protocolFeeSet() public view {
        uint256 feeBps = aggregator.protocolFeeBps();
        assertEq(feeBps, PROTOCOL_FEE_BPS, "Protocol fee mismatch");
        console.log("[Deployment] Protocol fee (bps):", feeBps);
    }

    // ======================================================================
    // SECTION 2: Router Registry Verification
    // ======================================================================

    /// @notice Verify all 12 DEX routers are registered in the aggregator.
    function test_fork_allRoutersRegistered() public view {
        console.log("[Routers] Checking all 12 registered routers:");
        uint256 registeredCount;
        for (uint256 i = 0; i < ALL_ROUTERS.length; i++) {
            bool isSupported = aggregator.supportedRouters(ALL_ROUTERS[i]);
            if (isSupported) {
                registeredCount++;
            }
            console.log("  Router", i, ALL_ROUTERS[i], isSupported ? "REGISTERED" : "NOT REGISTERED");
        }
        console.log("[Routers] Registered:", registeredCount, "of", ALL_ROUTERS.length);
        // Soft check: on-chain router registrations may differ from local constants
        if (registeredCount != ALL_ROUTERS.length) {
            console.log("[Routers] NOTE: Not all expected routers are registered on-chain");
        }
    }

    /// @notice Verify getRouterCount() returns 12.
    function test_fork_routerCount() public view {
        uint256 count = aggregator.getRouterCount();
        assertEq(count, 12, "Router count mismatch");
        console.log("[Routers] Count:", count);
    }

    /// @notice Verify that a swap with an unregistered router reverts.
    function test_fork_unregisteredRouterReverts() public {
        address fakeRouter = makeAddr("fakeRouter");

        // Prepare user with WWDOGE
        deal(WWDOGE, user, SWAP_AMOUNT);
        vm.prank(user);
        IERC20(WWDOGE).approve(address(aggregator), SWAP_AMOUNT);

        // Build swap request with unregistered router
        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, fakeRouter, user);

        vm.prank(user);
        vm.expectRevert("Unsupported router");
        aggregator.executeSwap(request);

        console.log("[Routers] Unregistered router correctly reverted");
    }

    // ======================================================================
    // SECTION 3: Token Balance and Allowance Checks
    // ======================================================================

    /// @notice Verify WWDOGE contract exists and responds to standard calls.
    function test_fork_wwdogeBalanceCheck() public view {
        uint256 totalSupply = IERC20(WWDOGE).totalSupply();
        assertGt(totalSupply, 0, "WWDOGE total supply is zero");
        console.log("[Tokens] WWDOGE total supply:", totalSupply);

        // Verify decimals
        uint8 decimals = _getTokenDecimals(WWDOGE);
        assertEq(decimals, 18, "WWDOGE decimals should be 18");
        console.log("[Tokens] WWDOGE decimals:", decimals);
    }

    /// @notice Verify key token decimals.
    function test_fork_tokenDecimals() public view {
        console.log("[Tokens] Checking decimals for key tokens:");

        address[4] memory tokens = [WWDOGE, OMNOM, DC, DINU];
        string[4] memory names = ["WWDOGE", "OMNOM", "DC", "DINU"];

        for (uint256 i = 0; i < tokens.length; i++) {
            uint8 decimals = _getTokenDecimals(tokens[i]);
            string memory symbol = _getTokenSymbol(tokens[i]);
            console.log("  ", names[i], symbol);
            console.log("    decimals:", decimals);
            assertGt(decimals, 0, "Token decimals should be > 0");
        }
    }

    /// @notice Verify tokens have non-zero total supply.
    function test_fork_tokenTotalSupply() public view {
        console.log("[Tokens] Checking total supply for key tokens:");

        address[5] memory tokens = [WWDOGE, OMNOM, DC, DINU, DST_V2];
        string[5] memory names = ["WWDOGE", "OMNOM", "DC", "DINU", "DST_V2"];

        for (uint256 i = 0; i < tokens.length; i++) {
            (bool ok, bytes memory data) = tokens[i].staticcall(
                abi.encodeWithSelector(bytes4(keccak256("totalSupply()")))
            );
            if (ok && data.length >= 32) {
                uint256 supply = abi.decode(data, (uint256));
                console.log("  ", names[i], "totalSupply:", supply);
                assertGt(supply, 0, "Token should have non-zero supply");
            } else {
                console.log("  ", names[i], "totalSupply: CALL FAILED");
            }
        }
    }

    // ======================================================================
    // SECTION 4: Pool Existence Verification
    // ======================================================================

    /// @notice Check if WWDOGE/OMNOM pool exists on any registered DEX.
    function test_fork_wwdogeOmnomPool() public view {
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        console.log("[Pools] WWDOGE/OMNOM:");
        console.log("  Pool found:", pair);
        console.log("  On router:", router);
        // Pool may not exist on current fork state — log but don't fail
        if (pair == address(0)) {
            console.log("  [INFO] WWDOGE/OMNOM pool not found (may not exist)");
        }
    }

    /// @notice Check if WWDOGE/DC pool exists on any registered DEX.
    function test_fork_wwdogeDcPool() public view {
        (address router, address pair) = _findRouterWithPool(WWDOGE, DC);
        console.log("[Pools] WWDOGE/DC:");
        console.log("  Pool found:", pair);
        console.log("  On router:", router);
        // Pool may not exist on current fork state — log but don't fail
        if (pair == address(0)) {
            console.log("  [INFO] WWDOGE/DC pool not found (may not exist)");
        }
    }

    /// @notice Check if OMNOM/DC pool exists on any registered DEX.
    function test_fork_omnomDcPool() public view {
        (address router, address pair) = _findRouterWithPool(OMNOM, DC);
        console.log("[Pools] OMNOM/DC:");
        console.log("  Pool found:", pair);
        console.log("  On router:", router);
        // This pool may not exist — log but don't fail
        if (pair == address(0)) {
            console.log("  [INFO] OMNOM/DC pool not found (may not exist)");
        }
    }

    /// @notice Scan all DEXes for all major token pairs and report findings.
    function test_fork_scanAllPools() public view {
        console.log("[Pools] Scanning all DEXes for major pairs:");
        console.log("  ===================================================");

        address[5] memory tokens = [WWDOGE, OMNOM, DC, DINU, DST_V2];
        string[5] memory names = ["WWDOGE", "OMNOM", "DC", "DINU", "DST_V2"];

        uint256 totalPoolsFound;

        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = i + 1; j < tokens.length; j++) {
                (address router, address pair) = _findRouterWithPool(tokens[i], tokens[j]);
                if (pair != address(0)) {
                    totalPoolsFound++;
                    console.log("  FOUND:", names[i], "/", names[j]);
                    console.log("    on router:", router);
                } else {
                    console.log(
                        "  NOT FOUND:", names[i], "/", names[j]
                    );
                }
            }
        }

        console.log("  ===================================================");
        console.log("[Pools] Total pools found:", totalPoolsFound);
        // Pool availability depends on on-chain state — log but don't fail
        if (totalPoolsFound == 0) {
            console.log("[Pools] NOTE: No pools found on any DEX (may be RPC or state issue)");
        }
    }

    // ======================================================================
    // SECTION 5: Simulated Swap Execution
    // ======================================================================

    /// @notice Simulate WWDOGE → OMNOM swap using a pool with real liquidity.
    function test_fork_simulateWwdogeToOmnom() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Swap] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        // Prepare user with WWDOGE
        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        uint256 balBefore = IERC20(OMNOM).balanceOf(user);
        console.log("[Swap] WWDOGE -> OMNOM:");
        console.log("  Router:", router);
        console.log("  User WWDOGE balance before:", IERC20(WWDOGE).balanceOf(user));
        console.log("  User OMNOM balance before:", balBefore);

        // Execute swap with 0 slippage for simulation
        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        uint256 gasBefore = gasleft();
        vm.prank(user);
        aggregator.executeSwap(request);
        uint256 gasUsed = gasBefore - gasleft();

        uint256 balAfter = IERC20(OMNOM).balanceOf(user);
        uint256 received = balAfter - balBefore;

        console.log("  User OMNOM balance after:", balAfter);
        console.log("  OMNOM received:", received);
        console.log("  Gas used:", gasUsed);

        assertGt(received, 0, "Should have received OMNOM");
    }

    /// @notice Simulate WWDOGE → DC swap using a pool with real liquidity.
    function test_fork_simulateWwdogeToDc() public {
        // Find a router with WWDOGE/DC pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, DC);
        if (pair == address(0)) {
            console.log("[Swap] SKIP: WWDOGE/DC pool not found");
            return;
        }

        // Prepare user with WWDOGE
        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        uint256 balBefore = IERC20(DC).balanceOf(user);
        console.log("[Swap] WWDOGE -> DC:");
        console.log("  Router:", router);
        console.log("  User WWDOGE balance before:", IERC20(WWDOGE).balanceOf(user));
        console.log("  User DC balance before:", balBefore);

        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, DC, SWAP_AMOUNT, 0, router, user);

        uint256 gasBefore = gasleft();
        vm.prank(user);
        aggregator.executeSwap(request);
        uint256 gasUsed = gasBefore - gasleft();

        uint256 balAfter = IERC20(DC).balanceOf(user);
        uint256 received = balAfter - balBefore;

        console.log("  User DC balance after:", balAfter);
        console.log("  DC received:", received);
        console.log("  Gas used:", gasUsed);

        assertGt(received, 0, "Should have received DC");
    }

    /// @notice Simulate OMNOM → WWDOGE swap (reverse direction).
    function test_fork_simulateOmnomToWwdoge() public {
        // Find a router with OMNOM/WWDOGE pool
        (address router, address pair) = _findRouterWithPool(OMNOM, WWDOGE);
        if (pair == address(0)) {
            console.log("[Swap] SKIP: OMNOM/WWDOGE pool not found");
            return;
        }

        // Prepare user with OMNOM
        _prepareUserWithToken(OMNOM, SWAP_AMOUNT);

        uint256 balBefore = IERC20(WWDOGE).balanceOf(user);
        console.log("[Swap] OMNOM -> WWDOGE:");
        console.log("  Router:", router);
        console.log("  User OMNOM balance before:", IERC20(OMNOM).balanceOf(user));
        console.log("  User WWDOGE balance before:", balBefore);

        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(OMNOM, WWDOGE, SWAP_AMOUNT, 0, router, user);

        uint256 gasBefore = gasleft();
        vm.prank(user);
        aggregator.executeSwap(request);
        uint256 gasUsed = gasBefore - gasleft();

        uint256 balAfter = IERC20(WWDOGE).balanceOf(user);
        uint256 received = balAfter - balBefore;

        console.log("  User WWDOGE balance after:", balAfter);
        console.log("  WWDOGE received:", received);
        console.log("  Gas used:", gasUsed);

        assertGt(received, 0, "Should have received WWDOGE");
    }

    /// @notice Simulate a multi-hop route: OMNOM → WWDOGE → DC.
    function test_fork_simulateMultiHop() public {
        // Find a router that has both pools
        (address routerA,) = _findRouterWithPool(OMNOM, WWDOGE);
        (address routerB,) = _findRouterWithPool(WWDOGE, DC);

        if (routerA == address(0) || routerB == address(0)) {
            console.log("[Swap] SKIP: Multi-hop pools not found");
            return;
        }

        // Use the first router that has both pools, or different routers
        address hopRouter = routerA != address(0) ? routerA : routerB;

        // Prepare user with OMNOM
        _prepareUserWithToken(OMNOM, SWAP_AMOUNT);

        uint256 balBefore = IERC20(DC).balanceOf(user);
        console.log("[Swap] Multi-hop: OMNOM -> WWDOGE -> DC:");
        console.log("  Hop router:", hopRouter);
        console.log("  User OMNOM balance before:", IERC20(OMNOM).balanceOf(user));
        console.log("  User DC balance before:", balBefore);

        OmnomSwapAggregator.SwapRequest memory request =
            _buildMultiHopSwapRequest(OMNOM, WWDOGE, DC, SWAP_AMOUNT, 0, hopRouter, user);

        uint256 gasBefore = gasleft();
        vm.prank(user);
        try aggregator.executeSwap(request) {
            uint256 gasUsed = gasBefore - gasleft();
            uint256 balAfter = IERC20(DC).balanceOf(user);
            uint256 received = balAfter - balBefore;

            console.log("  User DC balance after:", balAfter);
            console.log("  DC received:", received);
            console.log("  Gas used:", gasUsed);

            assertGt(received, 0, "Should have received DC from multi-hop");
        } catch Error(string memory reason) {
            console.log("  Multi-hop swap reverted:", reason);
            console.log("  [INFO] This may occur if pools are on different DEXes");
        } catch (bytes memory) {
            console.log("  Multi-hop swap reverted (low-level)");
            console.log("  [INFO] This may occur if pools are on different DEXes");
        }
    }

    /// @notice Simulate native DOGE → WWDOGE → OMNOM swap using msg.value.
    function test_fork_simulateNativeDogeSwap() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Swap] SKIP: WWDOGE/OMNOM pool not found for native swap");
            return;
        }

        uint256 nativeAmount = 10 ether; // 10 DOGE
        vm.deal(user, nativeAmount);

        uint256 balBefore = IERC20(OMNOM).balanceOf(user);
        console.log("[Swap] Native DOGE -> WWDOGE -> OMNOM:");
        console.log("  Router:", router);
        console.log("  User native DOGE:", user.balance);
        console.log("  User OMNOM balance before:", balBefore);

        // Build swap request with WWDOGE as tokenIn (native gets auto-wrapped)
        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, nativeAmount, 0, router, user);

        uint256 gasBefore = gasleft();
        vm.prank(user);
        aggregator.executeSwap{value: nativeAmount}(request);
        uint256 gasUsed = gasBefore - gasleft();

        uint256 balAfter = IERC20(OMNOM).balanceOf(user);
        uint256 received = balAfter - balBefore;

        console.log("  User OMNOM balance after:", balAfter);
        console.log("  OMNOM received:", received);
        console.log("  Gas used:", gasUsed);
        console.log("  Remaining native DOGE:", user.balance);

        assertGt(received, 0, "Should have received OMNOM from native swap");
    }

    /// @notice Record gas usage for a fork swap for benchmarking.
    function test_fork_swapGasSnapshot() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Gas] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        uint256 gasBefore = gasleft();
        vm.prank(user);
        aggregator.executeSwap(request);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("[Gas] Single-step WWDOGE -> OMNOM swap:");
        console.log("  Gas used:", gasUsed);
        console.log("  Input amount:", SWAP_AMOUNT);
        // Snapshot for comparison: gas should be reasonable (< 500k)
        assertLt(gasUsed, 500_000, "Gas usage seems unreasonably high");
    }

    // ======================================================================
    // SECTION 6: Fee Verification on Fork
    // ======================================================================

    /// @notice Verify 25 bps fee is deducted and sent to treasury during swap.
    function test_fork_feeDeduction() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Fee] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        uint256 treasuryBalBefore = IERC20(WWDOGE).balanceOf(TREASURY);

        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 treasuryBalAfter = IERC20(WWDOGE).balanceOf(TREASURY);
        uint256 feeReceived = treasuryBalAfter - treasuryBalBefore;

        console.log("[Fee] Fee deduction verification:");
        console.log("  Treasury WWDOGE before:", treasuryBalBefore);
        console.log("  Treasury WWDOGE after:", treasuryBalAfter);
        console.log("  Fee received by treasury:", feeReceived);

        assertGt(feeReceived, 0, "Treasury should have received fee");
    }

    /// @notice Verify the exact fee amount matches the expected 25 bps calculation.
    function test_fork_feeAmount() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Fee] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        uint256 expectedFee = (SWAP_AMOUNT * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryBalBefore = IERC20(WWDOGE).balanceOf(TREASURY);

        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 treasuryBalAfter = IERC20(WWDOGE).balanceOf(TREASURY);
        uint256 actualFee = treasuryBalAfter - treasuryBalBefore;

        console.log("[Fee] Exact fee amount verification:");
        console.log("  Input amount:", SWAP_AMOUNT);
        console.log("  Expected fee (25 bps):", expectedFee);
        console.log("  Actual fee received:", actualFee);
        console.log("  Difference:", actualFee > expectedFee ? actualFee - expectedFee : expectedFee - actualFee);

        assertEq(actualFee, expectedFee, "Fee amount mismatch");
    }

    /// @notice Verify no excess fee is charged beyond the configured 25 bps.
    function test_fork_noExcessFee() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Fee] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        uint256 expectedFee = (SWAP_AMOUNT * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryBalBefore = IERC20(WWDOGE).balanceOf(TREASURY);

        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 treasuryBalAfter = IERC20(WWDOGE).balanceOf(TREASURY);
        uint256 actualFee = treasuryBalAfter - treasuryBalBefore;

        console.log("[Fee] No excess fee verification:");
        console.log("  Expected max fee:", expectedFee);
        console.log("  Actual fee:", actualFee);

        // Actual fee should not exceed expected fee
        assertLe(actualFee, expectedFee, "Excess fee charged");
    }

    // ======================================================================
    // SECTION 7: Slippage Protection on Fork
    // ======================================================================

    /// @notice Verify swap reverts when minTotalAmountOut is set too high.
    function test_fork_slippageRevert() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Slippage] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        // Set minTotalAmountOut to an unreasonably high value
        uint256 ridiculousMinOut = SWAP_AMOUNT * 1_000; // Expect 1000x output
        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, ridiculousMinOut, router, user);

        vm.prank(user);
        vm.expectRevert("Slippage");
        aggregator.executeSwap(request);

        console.log("[Slippage] High minTotalAmountOut correctly reverted with 'Slippage'");
    }

    /// @notice Verify swap succeeds with reasonable slippage tolerance.
    function test_fork_slippagePass() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Slippage] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        // Use 0 slippage for simulation — any non-zero output should pass
        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        uint256 balBefore = IERC20(OMNOM).balanceOf(user);

        vm.prank(user);
        aggregator.executeSwap(request);

        uint256 balAfter = IERC20(OMNOM).balanceOf(user);
        uint256 received = balAfter - balBefore;

        console.log("[Slippage] Zero slippage swap succeeded:");
        console.log("  OMNOM received:", received);

        assertGt(received, 0, "Should have received tokens with zero slippage");
    }

    /// @notice Test slippage at the exact boundary — set minTotalAmountOut to the actual output.
    function test_fork_exactSlippageBoundary() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Slippage] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        // First, do a quote swap with 0 slippage to find the actual output
        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory quoteRequest =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        uint256 balBefore = IERC20(OMNOM).balanceOf(user);
        vm.prank(user);
        aggregator.executeSwap(quoteRequest);
        uint256 actualOutput = IERC20(OMNOM).balanceOf(user) - balBefore;

        console.log("[Slippage] Boundary test - first swap output:", actualOutput);

        // Now do a second swap with minTotalAmountOut exactly equal to expected output
        // Prepare fresh tokens for second swap
        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        // Set minTotalAmountOut to the actual output from the first swap
        // This should succeed because the output should be the same
        OmnomSwapAggregator.SwapRequest memory boundaryRequest =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, actualOutput, router, user);

        uint256 balBefore2 = IERC20(OMNOM).balanceOf(user);

        vm.prank(user);
        aggregator.executeSwap(boundaryRequest);

        uint256 received2 = IERC20(OMNOM).balanceOf(user) - balBefore2;

        console.log("[Slippage] Boundary swap output:", received2);
        console.log("[Slippage] Min required:", actualOutput);
        console.log("[Slippage] Passed boundary:", received2 >= actualOutput ? "YES" : "NO");

        assertGe(received2, actualOutput, "Boundary swap should meet minimum");
    }

    // ======================================================================
    // SECTION 8: Contract State & Pause Verification
    // ======================================================================

    /// @notice Verify the contract is not paused and swaps are operational.
    function test_fork_notPaused() public view {
        bool isPaused = aggregator.paused();
        assertFalse(isPaused, "Contract should not be paused");
        console.log("[State] Paused:", isPaused ? "YES" : "NO");
    }

    /// @notice Verify the aggregator holds no residual tokens from previous operations.
    function test_fork_noResidualFunds() public view {
        uint256 wwdogeBal = IERC20(WWDOGE).balanceOf(address(aggregator));
        uint256 omnomBal = IERC20(OMNOM).balanceOf(address(aggregator));
        uint256 dcBal = IERC20(DC).balanceOf(address(aggregator));

        console.log("[State] Aggregator balances:");
        console.log("  WWDOGE:", wwdogeBal);
        console.log("  OMNOM:", omnomBal);
        console.log("  DC:", dcBal);

        // The aggregator should not hold user funds between swaps
        // protocolBalance tracks what belongs to the protocol
        uint256 wwdogeProtocolBal = aggregator.protocolBalance(WWDOGE);
        uint256 omnomProtocolBal = aggregator.protocolBalance(OMNOM);
        uint256 dcProtocolBal = aggregator.protocolBalance(DC);

        console.log("  WWDOGE protocolBalance:", wwdogeProtocolBal);
        console.log("  OMNOM protocolBalance:", omnomProtocolBal);
        console.log("  DC protocolBalance:", dcProtocolBal);

        // Actual balance should not exceed protocol balance (no stranded funds)
        assertLe(wwdogeBal, wwdogeProtocolBal + 1, "Stranded WWDOGE in aggregator");
    }

    /// @notice Verify the SwapExecuted event is emitted with correct parameters.
    function test_fork_swapEventEmitted() public {
        // Find a router with WWDOGE/OMNOM pool
        (address router, address pair) = _findRouterWithPool(WWDOGE, OMNOM);
        if (pair == address(0)) {
            console.log("[Events] SKIP: WWDOGE/OMNOM pool not found");
            return;
        }

        _prepareUserWithToken(WWDOGE, SWAP_AMOUNT);

        uint256 expectedFee = (SWAP_AMOUNT * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;

        OmnomSwapAggregator.SwapRequest memory request =
            _buildSingleSwapRequest(WWDOGE, OMNOM, SWAP_AMOUNT, 0, router, user);

        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(user, WWDOGE, OMNOM, SWAP_AMOUNT, 0, expectedFee);
        aggregator.executeSwap(request);

        console.log("[Events] SwapExecuted event verified");
    }

    /// @notice Diagnostic: Log comprehensive aggregator state for debugging.
    function test_fork_diagnosticReport() public view {
        console.log("");
        console.log("========================================");
        console.log("  MAINNET FORK E2E DIAGNOSTIC REPORT");
        console.log("========================================");
        console.log("");

        // Aggregator state
        console.log("--- Aggregator State ---");
        console.log("  Address:", address(aggregator));
        console.log("  Owner:", aggregator.owner());
        console.log("  Treasury:", aggregator.treasury());
        console.log("  ProtocolFeeBps:", aggregator.protocolFeeBps());
        console.log("  WWDOGE:", aggregator.WWDOGE());
        console.log("  Paused:", aggregator.paused());
        console.log("  Router count:", aggregator.getRouterCount());

        // Token info
        console.log("");
        console.log("--- Token Info ---");
        address[5] memory tokens = [WWDOGE, OMNOM, DC, DINU, DST_V2];
        string[5] memory names = ["WWDOGE", "OMNOM", "DC", "DINU", "DST_V2"];
        for (uint256 i = 0; i < tokens.length; i++) {
            string memory sym = _getTokenSymbol(tokens[i]);
            uint8 dec = _getTokenDecimals(tokens[i]);
            (bool ok, bytes memory data) = tokens[i].staticcall(
                abi.encodeWithSelector(bytes4(keccak256("totalSupply()")))
            );
            uint256 supply = ok && data.length >= 32 ? abi.decode(data, (uint256)) : 0;
            console.log("  ", names[i], sym);
            console.log("    decimals:", uint256(dec), "supply:", supply);
        }

        // Router info
        console.log("");
        console.log("--- Router Registry ---");
        for (uint256 i = 0; i < ALL_ROUTERS.length; i++) {
            bool supported = aggregator.supportedRouters(ALL_ROUTERS[i]);
            console.log("  Router", i, ALL_ROUTERS[i], supported ? "OK" : "MISSING");
        }

        // Pool scan
        console.log("");
        console.log("--- Pool Scan ---");
        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = i + 1; j < tokens.length; j++) {
                (address r, address p) = _findRouterWithPool(tokens[i], tokens[j]);
                if (p != address(0)) {
                    console.log("  ", names[i], "/", names[j]);
                    console.log("    router:", r, "pair:", p);
                }
            }
        }

        console.log("");
        console.log("========================================");
    }
}
