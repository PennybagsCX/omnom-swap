// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockUniswapV2Pair
 * @notice A mock UniswapV2 pair contract with configurable reserves for testing.
 *         NOT for production use.
 */
contract MockUniswapV2Pair {
    // ============================================================
    // State
    // ============================================================

    address public token0;
    address public token1;

    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _blockTimestampLast;

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param _token0 The address of the first token in the pair.
     * @param _token1 The address of the second token in the pair.
     */
    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    // ============================================================
    // External Functions
    // ============================================================

    /**
     * @notice Returns the current reserves of the pair.
     * @return reserve0 The reserve of token0.
     * @return reserve1 The reserve of token1.
     * @return blockTimestampLast The last update timestamp.
     */
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
    {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        blockTimestampLast = _blockTimestampLast;
    }

    /**
     * @notice Sets the reserves for testing purposes.
     * @param newReserve0 The new reserve for token0.
     * @param newReserve1 The new reserve for token1.
     */
    function setReserves(uint112 newReserve0, uint112 newReserve1) external {
        _reserve0 = newReserve0;
        _reserve1 = newReserve1;
        _blockTimestampLast = uint32(block.timestamp);
    }
}
