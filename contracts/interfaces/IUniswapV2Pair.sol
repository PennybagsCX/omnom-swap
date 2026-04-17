// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IUniswapV2Pair
 * @notice Minimal interface for UniswapV2-compatible pair contracts.
 */
interface IUniswapV2Pair {
    /// @notice Returns the current reserves of the pair and the last block timestamp.
    /// @return reserve0 The reserve of token0.
    /// @return reserve1 The reserve of token1.
    /// @return blockTimestampLast The block timestamp when reserves were last updated.
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    /// @notice Returns the address of the first token in the pair.
    function token0() external view returns (address);

    /// @notice Returns the address of the second token in the pair.
    function token1() external view returns (address);
}
