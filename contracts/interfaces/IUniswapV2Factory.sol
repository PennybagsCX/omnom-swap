// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IUniswapV2Factory
 * @notice Minimal interface for UniswapV2-compatible factory contracts.
 */
interface IUniswapV2Factory {
    /// @notice Returns the pair contract address for two tokens, or address(0) if none exists.
    /// @param tokenA The address of the first token.
    /// @param tokenB The address of the second token.
    /// @return pair The pair contract address.
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}
