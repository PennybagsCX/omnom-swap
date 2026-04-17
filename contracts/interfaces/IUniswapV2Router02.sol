// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IUniswapV2Router02
 * @notice Minimal interface for UniswapV2-compatible DEX routers on Dogechain.
 *         All DEXes on Dogechain (Chewyswap, Dogeshrek, etc.) use this interface.
 */
interface IUniswapV2Router02 {
    /// @notice Swaps an exact amount of input tokens for as many output tokens as possible.
    /// @param amountIn The amount of input tokens to send.
    /// @param amountOutMin The minimum amount of output tokens that must be received.
    /// @param path An array of token addresses representing the swap path.
    /// @param to The recipient of the output tokens.
    /// @param deadline Unix timestamp after which the transaction will revert.
    /// @return amounts An array of token amounts for each step in the path.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Swaps as few input tokens as possible for an exact amount of output tokens.
    /// @param amountOut The amount of output tokens to receive.
    /// @param amountInMax The maximum amount of input tokens that can be spent.
    /// @param path An array of token addresses representing the swap path.
    /// @param to The recipient of the output tokens.
    /// @param deadline Unix timestamp after which the transaction will revert.
    /// @return amounts An array of token amounts for each step in the path.
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Given an input amount and a path, returns the expected output amounts.
    /// @param amountIn The amount of input tokens.
    /// @param path An array of token addresses representing the swap path.
    /// @return amounts An array of expected token amounts for each step in the path.
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);

    /// @notice Returns the factory address associated with this router.
    function factory() external view returns (address);
}
