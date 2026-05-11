// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @title MockFailingRouter
 * @notice A mock UniswapV2-style router with configurable failure modes for testing.
 *         Simulates various swap failure scenarios: reverts, zero returns, wrong tokens,
 *         partial failures, and out-of-gas conditions.
 *
 *         Follows the same conventions as MockUniswapV2Router but adds failure injection.
 *         Uses standard `transferFrom` (requires allowance) to match real-world behavior
 *         where the aggregator approves the router via SafeERC20 before calling swap.
 */
contract MockFailingRouter {
    // ============================================================
    // Types
    // ============================================================

    enum FailMode {
        None,           // Normal operation
        RevertAlways,   // Always reverts
        RevertOnSwap,   // Reverts only on swap functions
        ReturnZero,     // Returns 0 amounts / transfers in but sends nothing out
        WrongToken,     // Sends wrong token back
        PartialFail,    // Fails after first call (tracks call count)
        OOG             // Runs out of gas
    }

    // ============================================================
    // State
    // ============================================================

    FailMode public failMode = FailMode.None;
    uint256 public exchangeRate = 0.9e18; // 0.9:1 default (slippage)
    uint256 public callCount;
    address public tokenA;
    address public tokenB;

    /// @notice ERC20-style allowance mapping for SafeERC20 compatibility.
    mapping(address => mapping(address => uint256)) public allowance;

    // ============================================================
    // Configuration Functions
    // ============================================================

    /**
     * @notice Sets the failure mode for subsequent swap calls.
     * @param mode The FailMode to activate.
     */
    function setFailMode(FailMode mode) external {
        failMode = mode;
    }

    /**
     * @notice Sets the exchange rate used for swap calculations.
     * @param rate The new exchange rate (scaled by 1e18).
     */
    function setExchangeRate(uint256 rate) external {
        exchangeRate = rate;
    }

    /**
     * @notice Sets the token pair this router will trade between.
     * @param a Address of token A.
     * @param b Address of token B.
     */
    function setTokens(address a, address b) external {
        tokenA = a;
        tokenB = b;
    }

    /**
     * @notice ERC20-style approve for SafeERC20 compatibility.
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    // ============================================================
    // Swap Functions
    // ============================================================

    /**
     * @notice Simulates swapExactTokensForTokens with configurable failure modes.
     * @dev Reverts on RevertAlways, RevertOnSwap, and OOG modes.
     *      Returns calculated amounts otherwise.
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint[] memory amounts) {
        callCount++;

        if (failMode == FailMode.RevertAlways || failMode == FailMode.RevertOnSwap) {
            revert("MockFailingRouter: swap failed");
        }

        if (failMode == FailMode.OOG) {
            // Consume all available gas
            uint256 x = 0;
            for (uint256 i = 0; i < type(uint256).max; i++) {
                x += i;
            }
            // Silence unused variable warning
            x;
        }

        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = (amountIn * exchangeRate) / 1e18;
        require(amounts[1] >= amountOutMin, "Insufficient output");

        // Transfer input tokens from caller to this contract
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Transfer output tokens from this contract to the recipient
        IERC20(path[path.length - 1]).transfer(to, amounts[amounts.length - 1]);
    }

    /**
     * @notice Simulates swapExactTokensForTokensSupportingFeeOnTransferTokens
     *         with configurable failure modes.
     * @dev Handles ReturnZero and WrongToken modes by transferring in but not out.
     *      PartialFail mode reverts on the second call.
     */
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external {
        callCount++;

        if (failMode == FailMode.RevertAlways || failMode == FailMode.RevertOnSwap) {
            revert("MockFailingRouter: swap failed");
        }

        if (failMode == FailMode.PartialFail && callCount > 1) {
            revert("MockFailingRouter: partial failure");
        }

        if (failMode == FailMode.ReturnZero) {
            // Transfer in but send nothing out
            IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
            return;
        }

        if (failMode == FailMode.WrongToken) {
            // Transfer in but don't send the expected output token
            IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
            // Intentionally do not send output — simulates receiving wrong token
            return;
        }

        uint256 outputAmount = (amountIn * exchangeRate) / 1e18;
        require(outputAmount >= amountOutMin, "Insufficient output");

        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        IERC20(path[path.length - 1]).transfer(to, outputAmount);
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice Returns simulated output amounts for a given input and path.
     */
    function getAmountsOut(uint256 amountIn, address[] calldata /* path */)
        external
        view
        returns (uint[] memory amounts)
    {
        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = (amountIn * exchangeRate) / 1e18;
    }

    /**
     * @notice Returns a dummy factory address.
     */
    function factory() external pure returns (address) {
        return address(0);
    }
}
