// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IERC20
 * @notice Standard ERC20 token interface as defined by EIP-20.
 */
interface IERC20 {
    /// @notice Returns the total supply of the token.
    function totalSupply() external view returns (uint256);

    /// @notice Returns the balance of `account`.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Returns the remaining number of tokens that `spender` can transfer from `owner`.
    function allowance(address owner, address spender) external view returns (uint256);

    /// @notice Approves `spender` to spend `amount` tokens on behalf of the caller.
    /// @return success True if the approval was successful.
    function approve(address spender, uint256 amount) external returns (bool success);

    /// @notice Transfers `amount` tokens from the caller to `recipient`.
    /// @return success True if the transfer was successful.
    function transfer(address recipient, uint256 amount) external returns (bool success);

    /// @notice Transfers `amount` tokens from `sender` to `recipient` using the allowance mechanism.
    /// @return success True if the transfer was successful.
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool success);

    /// @notice Emitted when `value` tokens are transferred from `from` to `to`.
    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @notice Emitted when `owner` approves `spender` to spend `value` tokens.
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
