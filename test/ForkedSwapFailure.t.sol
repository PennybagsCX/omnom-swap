// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/interfaces/IERC20.sol";
import "../contracts/interfaces/IUniswapV2Factory.sol";

/**
 * @title ForkedSwapFailureTest
 * @notice Forked mainnet test to diagnose the exact revert reason for a failing swap
 *         on the Dogechain network.
 *
 * Run with:
 *   forge test --match-contract ForkedSwapFailureTest -vvvv
 *
 * The test forks Dogechain mainnet, impersonates the sender, and attempts the exact
 * failing executeSwap call. It then tries variations to isolate the root cause:
 *   1. Exact failing parameters
 *   2. Fresh deadline (now + 300)
 *   3. minTotalAmountOut = 0 (no slippage)
 *   4. Smaller amountIn (1 token)
 *   5. Max approval before swap
 */
contract ForkedSwapFailureTest is Test {
    // -- Fork availability flag --
    bool internal _forkAvailable;

    // -- Transaction Parameters --
    address constant SENDER = 0x22F4194F6706E70aBaA14AB352D0baA6C7ceD24a;
    address constant AGGREGATOR = 0xB6eaE524325Cc31Bb0f3d9AF7bB63b4dc991B58A;
    address constant TOKEN_IN = 0xB9fcaA7590916578087842E017078D7799FA18D0;
    address constant TOKEN_OUT = 0xB7ddC6414bf4F5515b52D8BdD69973Ae205ff101; // WWDOGE
    uint256 constant AMOUNT_IN = 27_000e18; // 27,000 tokens
    uint256 constant MIN_TOTAL_AMOUNT_OUT = 58_162_281_171_110_712_550; // ~58.16 WWDOGE
    address constant TOOLSWAP_ROUTER = 0x9BBF70e64fbe8Fc7afE8a5Ae90F2DB1165013F93;
    address constant TOOLSWAP_FACTORY = 0xC3550497E591Ac6ed7a7E03ffC711CfB7412E57F;
    address constant TOOLSWAP_FACTORY_ALIAS = 0xaF85e6eD0Da6f7F5F86F2f5A7d595B1b0F35706C;
    uint256 constant DEADLINE = 1_778_326_705;
    address constant TREASURY = 0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88;

    // ======================================================================
    // setUp — Fork Dogechain Mainnet
    // ======================================================================

    function setUp() public {
        string memory rpcUrl = vm.envOr("DOGECCHAIN_RPC_URL", string("https://rpc.dogechain.dog"));
        uint256 forkId = vm.createFork(rpcUrl);
        vm.selectFork(forkId);
        _forkAvailable = true;
    }

    // -- Helper: Build SwapRequest --
    function _buildSwapRequest(
        uint256 amountIn,
        uint256 minTotalAmountOut_,
        uint256 deadline_
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path = new address[](2);
        path[0] = TOKEN_IN;
        path[1] = TOKEN_OUT;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: TOOLSWAP_ROUTER,
            path: path,
            amountIn: amountIn,
            minAmountOut: 0
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: amountIn,
            minTotalAmountOut: minTotalAmountOut_,
            steps: steps,
            deadline: deadline_,
            recipient: SENDER
        });
    }

    // ======================================================================
    // Pre-flight Checks
    // ======================================================================

    function test_preflight_tokenMetadata() public view {
        if (!_forkAvailable) return;
        console.log("=== Token Metadata ===");

        // Use low-level staticcall for optional ERC20 metadata
        (bool ok, bytes memory data) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("name()")))
        );
        if (ok && data.length > 0) {
            console.log("  name:", abi.decode(data, (string)));
        } else {
            console.log("  name: REVERTED or not supported");
        }

        (ok, data) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("symbol()")))
        );
        if (ok && data.length > 0) {
            console.log("  symbol:", abi.decode(data, (string)));
        } else {
            console.log("  symbol: REVERTED or not supported");
        }

        (ok, data) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("decimals()")))
        );
        if (ok && data.length > 0) {
            console.log("  decimals:", abi.decode(data, (uint8)));
        } else {
            console.log("  decimals: REVERTED or not supported");
        }

        (ok, data) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("totalSupply()")))
        );
        if (ok && data.length > 0) {
            console.log("  totalSupply:", abi.decode(data, (uint256)));
        } else {
            console.log("  totalSupply: REVERTED or not supported");
        }
    }

    function test_preflight_balanceAndAllowance() public view {
        if (!_forkAvailable) return;
        console.log("=== Sender Balance & Allowance ===");

        // Use low-level staticcall to handle tokens that may revert
        (bool okB, bytes memory dataB) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(IERC20.balanceOf.selector, SENDER)
        );
        if (okB && dataB.length >= 32) {
            uint256 balance = abi.decode(dataB, (uint256));
            console.log("  Sender balance:", balance);
            console.log("  Required:      ", AMOUNT_IN);
            console.log("  Sufficient:", balance >= AMOUNT_IN ? "YES" : "NO");
        } else {
            console.log("  Sender balance: CALL FAILED");
        }

        (bool okA, bytes memory dataA) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(IERC20.allowance.selector, SENDER, AGGREGATOR)
        );
        if (okA && dataA.length >= 32) {
            uint256 allowance = abi.decode(dataA, (uint256));
            console.log("  Allowance:", allowance);
            console.log("  Sufficient:", allowance >= AMOUNT_IN ? "YES" : "NO");
        } else {
            console.log("  Allowance: CALL FAILED");
        }
    }

    function test_preflight_poolExists() public view {
        if (!_forkAvailable) return;
        console.log("=== Pool Existence Check ===");

        address pair = IUniswapV2Factory(TOOLSWAP_FACTORY).getPair(TOKEN_IN, TOKEN_OUT);
        console.log("  ToolSwap Factory pair:", pair);
        console.log("  Pool exists:", pair != address(0) ? "YES" : "NO");

        address altPair = IUniswapV2Factory(TOOLSWAP_FACTORY_ALIAS).getPair(TOKEN_IN, TOKEN_OUT);
        console.log("  ToolSwap Factory Alias pair:", altPair);
        console.log("  Pool exists (alias):", altPair != address(0) ? "YES" : "NO");
    }

    function test_preflight_aggregatorState() public view {
        if (!_forkAvailable) return;
        console.log("=== Aggregator State ===");

        OmnomSwapAggregator agg = OmnomSwapAggregator(payable(AGGREGATOR));

        bool isSupported = agg.supportedRouters(TOOLSWAP_ROUTER);
        console.log("  ToolSwap router supported:", isSupported ? "YES" : "NO");

        bool isPaused = agg.paused();
        console.log("  Paused:", isPaused ? "YES" : "NO");

        console.log("  Owner:", agg.owner());
        console.log("  Treasury:", agg.treasury());
        console.log("  ProtocolFeeBps:", agg.protocolFeeBps());
        console.log("  WWDOGE:", agg.WWDOGE());
    }

    function test_preflight_deadlineCheck() public view {
        if (!_forkAvailable) return;
        console.log("=== Deadline Analysis ===");
        console.log("  Transaction deadline:", DEADLINE);
        console.log("  Current block time:  ", block.timestamp);
        console.log("  Deadline expired:", block.timestamp > DEADLINE ? "YES" : "NO");
        console.log("  Deadline >= now + 60:", DEADLINE >= block.timestamp + 60 ? "YES" : "NO");
        console.log("  Deadline <= now + 7200:", DEADLINE <= block.timestamp + 7200 ? "YES" : "NO");
    }

    // ======================================================================
    // Swap Simulation Tests
    // ======================================================================

    function test_swap_exactFailingParams() public {
        if (!_forkAvailable) return;
        console.log("=== Simulation 1: Exact Failing Parameters ===");

        OmnomSwapAggregator.SwapRequest memory request = _buildSwapRequest(
            AMOUNT_IN,
            MIN_TOTAL_AMOUNT_OUT,
            DEADLINE
        );

        vm.prank(SENDER);
        try OmnomSwapAggregator(payable(AGGREGATOR)).executeSwap(request) {
            console.log("  RESULT: SUCCESS (unexpected)");
        } catch Error(string memory reason) {
            console.log("  RESULT: REVERT");
            console.log("  Reason:", reason);
        } catch (bytes memory lowLevelData) {
            console.log("  RESULT: REVERT (low-level)");
            console.log("  Data length:", lowLevelData.length);
        }
    }

    function test_swap_freshDeadline() public {
        if (!_forkAvailable) return;
        console.log("=== Simulation 2: Fresh Deadline (now + 300) ===");

        OmnomSwapAggregator.SwapRequest memory request = _buildSwapRequest(
            AMOUNT_IN,
            MIN_TOTAL_AMOUNT_OUT,
            block.timestamp + 300
        );

        vm.prank(SENDER);
        try OmnomSwapAggregator(payable(AGGREGATOR)).executeSwap(request) {
            console.log("  RESULT: SUCCESS -- deadline was the issue!");
        } catch Error(string memory reason) {
            console.log("  RESULT: REVERT");
            console.log("  Reason:", reason);
        } catch (bytes memory) {
            console.log("  RESULT: REVERT (low-level)");
        }
    }

    function test_swap_zeroSlippage() public {
        if (!_forkAvailable) return;
        console.log("=== Simulation 3: minTotalAmountOut = 0 (no slippage) ===");

        OmnomSwapAggregator.SwapRequest memory request = _buildSwapRequest(
            AMOUNT_IN,
            0, // no slippage protection
            block.timestamp + 300
        );

        vm.prank(SENDER);
        try OmnomSwapAggregator(payable(AGGREGATOR)).executeSwap(request) {
            console.log("  RESULT: SUCCESS -- slippage was the issue!");
        } catch Error(string memory reason) {
            console.log("  RESULT: REVERT");
            console.log("  Reason:", reason);
        } catch (bytes memory) {
            console.log("  RESULT: REVERT (low-level)");
        }
    }

    function test_swap_smallAmount() public {
        if (!_forkAvailable) return;
        console.log("=== Simulation 4: Small Amount (1 token) ===");

        OmnomSwapAggregator.SwapRequest memory request = _buildSwapRequest(
            1e18, // 1 token
            0,
            block.timestamp + 300
        );

        vm.prank(SENDER);
        try OmnomSwapAggregator(payable(AGGREGATOR)).executeSwap(request) {
            console.log("  RESULT: SUCCESS -- amountIn was the issue (likely insufficient liquidity for large swap)!");
        } catch Error(string memory reason) {
            console.log("  RESULT: REVERT");
            console.log("  Reason:", reason);
        } catch (bytes memory) {
            console.log("  RESULT: REVERT (low-level)");
        }
    }

    function test_swap_maxApprovalFirst() public {
        if (!_forkAvailable) return;
        console.log("=== Simulation 5: Max Approval Before Swap ===");

        // First give max approval (use low-level call to handle revert)
        vm.prank(SENDER);
        (bool approveOk, ) = TOKEN_IN.call(
            abi.encodeWithSelector(IERC20.approve.selector, AGGREGATOR, type(uint256).max)
        );
        console.log("  Approve result:", approveOk ? "OK" : "FAILED");

        OmnomSwapAggregator.SwapRequest memory request = _buildSwapRequest(
            AMOUNT_IN,
            0,
            block.timestamp + 300
        );

        vm.prank(SENDER);
        try OmnomSwapAggregator(payable(AGGREGATOR)).executeSwap(request) {
            console.log("  RESULT: SUCCESS -- approval was the issue!");
        } catch Error(string memory reason) {
            console.log("  RESULT: REVERT");
            console.log("  Reason:", reason);
        } catch (bytes memory) {
            console.log("  RESULT: REVERT (low-level)");
        }
    }

    // ======================================================================
    // Transfer Restriction Test
    // ======================================================================

    function test_transferRestriction() public {
        if (!_forkAvailable) return;
        console.log("=== Transfer Restriction Test ===");

        // Test transferFrom with 0 amount
        vm.prank(SENDER);
        (bool ok0, ) = TOKEN_IN.call(
            abi.encodeCall(IERC20.transferFrom, (SENDER, AGGREGATOR, 0))
        );
        console.log("  transferFrom(sender, aggregator, 0):", ok0 ? "OK" : "REVERT");

        // Test transferFrom with 1 unit
        vm.prank(SENDER);
        (bool ok1, ) = TOKEN_IN.call(
            abi.encodeCall(IERC20.transferFrom, (SENDER, AGGREGATOR, 1))
        );
        console.log("  transferFrom(sender, aggregator, 1):", ok1 ? "OK" : "REVERT");

        // Test transferFrom with full amount
        vm.prank(SENDER);
        (bool okFull, ) = TOKEN_IN.call(
            abi.encodeCall(IERC20.transferFrom, (SENDER, AGGREGATOR, AMOUNT_IN))
        );
        console.log("  transferFrom(sender, aggregator, amountIn):", okFull ? "OK" : "REVERT");
    }

    // ======================================================================
    // Comprehensive Report
    // ======================================================================

    function test_comprehensiveReport() public view {
        if (!_forkAvailable) return;
        console.log("");
        console.log("========================================");
        console.log("  COMPREHENSIVE DIAGNOSTIC REPORT");
        console.log("========================================");

        // Token info via low-level calls
        console.log("");
        console.log("--- Token Info ---");
        (bool ok, bytes memory data) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("symbol()")))
        );
        if (ok && data.length > 0) {
            console.log("  Symbol:", abi.decode(data, (string)));
        }

        // Balance (use low-level staticcall to handle revert)
        (bool okBal, bytes memory dataBal) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(IERC20.balanceOf.selector, SENDER)
        );
        if (okBal && dataBal.length >= 32) {
            uint256 balance = abi.decode(dataBal, (uint256));
            console.log("  Balance:", balance);
            console.log("  AmountIn:", AMOUNT_IN);
            console.log("  Balance >= AmountIn:", balance >= AMOUNT_IN ? "YES" : "NO");
        } else {
            console.log("  Balance: CALL FAILED");
        }

        (bool okAllow, bytes memory dataAllow) = TOKEN_IN.staticcall(
            abi.encodeWithSelector(IERC20.allowance.selector, SENDER, AGGREGATOR)
        );
        if (okAllow && dataAllow.length >= 32) {
            uint256 allowance = abi.decode(dataAllow, (uint256));
            console.log("  Allowance:", allowance);
            console.log("  Allowance >= AmountIn:", allowance >= AMOUNT_IN ? "YES" : "NO");
        } else {
            console.log("  Allowance: CALL FAILED");
        }

        // Pool (use low-level staticcall to handle revert)
        console.log("");
        console.log("--- Pool Info ---");
        (bool okPair, bytes memory dataPair) = TOOLSWAP_FACTORY.staticcall(
            abi.encodeWithSelector(IUniswapV2Factory.getPair.selector, TOKEN_IN, TOKEN_OUT)
        );
        address pair = (okPair && dataPair.length >= 32) ? abi.decode(dataPair, (address)) : address(0);
        console.log("  ToolSwap Pair:", pair);
        if (pair != address(0)) {
            console.log("  Pool exists: YES");
        } else {
            console.log("  Pool exists: NO -- THIS IS LIKELY THE ROOT CAUSE");
        }

        // Router
        console.log("");
        console.log("--- Router Info ---");
        OmnomSwapAggregator agg = OmnomSwapAggregator(payable(AGGREGATOR));
        console.log("  Router supported:", agg.supportedRouters(TOOLSWAP_ROUTER) ? "YES" : "NO");
        console.log("  Paused:", agg.paused() ? "YES" : "NO");

        // Deadline
        console.log("");
        console.log("--- Deadline ---");
        console.log("  Deadline:", DEADLINE);
        console.log("  Now:", block.timestamp);
        console.log("  Expired:", DEADLINE < block.timestamp ? "YES -- ROOT CAUSE" : "NO");
        console.log("  Fails MIN_DEADLINE_BUFFER:", DEADLINE < block.timestamp + 60 ? "YES" : "NO");

        console.log("");
        console.log("========================================");
    }
}
