// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "../interfaces/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";

/**
 * @title MockUniswapV2Router
 * @notice A mock UniswapV2 router for testing. Simulates swaps by transferring
 *         tokens at a configurable exchange rate. NOT for production use.
 */
contract MockUniswapV2Router {
    // ============================================================
    // State
    // ============================================================

    /// @notice The mock factory address associated with this router.
    address public factory;

    /// @notice Exchange rate numerator (how many output tokens per input token).
    ///         e.g., exchangeRate = 2e18 means 1 input token → 2 output tokens.
    uint256 public exchangeRate;

    /// @notice Allowance mapping for token approvals (needed by SafeERC20).
    mapping(address => mapping(address => uint256)) public allowance;

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param _factory     The mock factory address.
     * @param _exchangeRate The default exchange rate (scaled by 1e18).
     */
    constructor(address _factory, uint256 _exchangeRate) {
        factory = _factory;
        exchangeRate = _exchangeRate;
    }

    // ============================================================
    // External Functions
    // ============================================================

    /**
     * @notice Simulates swapping exact input tokens for output tokens.
     * @dev Transfers `amountIn` of path[0] from the caller, then transfers
     *      the calculated output of path[last] to `to`. This mock must hold
     *      sufficient output token balance.
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "Expired");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        // Calculate output amount using the exchange rate
        uint256 amountOut = (amountIn * exchangeRate) / 1e18;
        require(amountOut >= amountOutMin, "Insufficient output");

        // Build the amounts array (simple 2-hop: just input and output)
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = amountOut;
        }

        // Transfer input tokens from caller to this contract
        _transferIn(tokenIn, msg.sender, amountIn);

        // Transfer output tokens from this contract to the recipient
        require(
            IERC20(tokenOut).transfer(to, amountOut),
            "Transfer out failed"
        );
    }

    /**
     * @notice Simulates swapping tokens for an exact output amount.
     * @dev Calculates required input based on exchange rate.
     */
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "Expired");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        // Calculate required input amount
        uint256 amountIn = (amountOut * 1e18) / exchangeRate;
        require(amountIn <= amountInMax, "Excessive input");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = amountOut;
        }

        _transferIn(tokenIn, msg.sender, amountIn);
        require(
            IERC20(tokenOut).transfer(to, amountOut),
            "Transfer out failed"
        );
    }

    /**
     * @notice Returns simulated output amounts for a given input and path.
     */
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        uint256 amountOut = (amountIn * exchangeRate) / 1e18;

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = amountOut;
        }
    }

    /**
     * @notice Fee-on-transfer variant: same as swapExactTokensForTokens but no return value.
     */
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external {
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "Expired");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        uint256 amountOut = (amountIn * exchangeRate) / 1e18;
        require(amountOut >= amountOutMin, "Insufficient output");

        _transferIn(tokenIn, msg.sender, amountIn);
        require(
            IERC20(tokenOut).transfer(to, amountOut),
            "Transfer out failed"
        );
    }

    /**
     * @notice Updates the exchange rate for testing different scenarios.
     * @param _exchangeRate The new exchange rate (scaled by 1e18).
     */
    function setExchangeRate(uint256 _exchangeRate) external {
        exchangeRate = _exchangeRate;
    }

    /**
     * @notice ERC20-style approve for SafeERC20 compatibility.
     *         Called by the aggregator via safeApprove(router, amount).
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /**
     * @dev Internal helper to transfer tokens in without relying on allowance.
     *      Directly manipulates MockERC20 balances. This works because in tests
     *      we control the token contracts.
     */
    function _transferIn(address token, address from, uint256 amount) internal {
        // Use forceTransferFrom to bypass allowance checks in mock environment
        MockERC20(token).forceTransferFrom(from, address(this), amount);
    }
}
