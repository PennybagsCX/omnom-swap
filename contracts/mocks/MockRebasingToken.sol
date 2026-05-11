// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {MockERC20} from "./MockERC20.sol";

/**
 * @title MockRebasingToken
 * @notice A mock rebasing ERC20 token for testing. Simulates tokens whose balances
 *         change without explicit transfers (e.g., AMPL, stETH). Uses a scaling
 *         index to convert between "scaled" (internal) and "present" (displayed) balances.
 *
 *         This contract does NOT inherit from MockERC20 because the parent's
 *         `balanceOf` and `totalSupply` are public state variables (not virtual),
 *         which cannot be overridden by functions in a child contract. Instead, it
 *         implements the same ERC20 interface independently with rebasing semantics.
 *
 *         Compatible with the aggregator's balance-diff measurement pattern:
 *         `balanceOf` returns the rebased (present) balance, so measuring before/after
 *         diffs will correctly reflect any rebase that occurred between the two calls.
 */
contract MockRebasingToken {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;

    /// @notice Rebase rate in basis points per epoch.
    ///         Positive = expansion, negative = contraction.
    int256 public rebaseRate;

    /// @notice Timestamp of the last rebase.
    uint256 public lastRebaseTimestamp;

    /// @notice Minimum interval between rebases.
    uint256 public rebaseInterval = 1 days;

    /// @notice Scaled (internal) balances — stored in "principal" units.
    mapping(address => uint256) public scaledBalances;

    /// @notice Total scaled supply across all holders.
    uint256 public totalScaledSupply;

    /// @notice Current scaling index. Starts at 1e18.
    ///         Present balance = (scaledBalance * currentIndex) / 1e18.
    uint256 public currentIndex = 1e18;

    /// @notice Standard ERC20 allowance mapping.
    mapping(address => mapping(address => uint256)) public allowance;

    // ============================================================
    // Events
    // ============================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param name_      The token name.
     * @param symbol_    The token symbol.
     * @param decimals_  The token decimals (usually 18).
     * @param rebaseRate_ The rebase rate in basis points (e.g., 100 = 1% expansion).
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        int256 rebaseRate_
    ) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        rebaseRate = rebaseRate_;
        lastRebaseTimestamp = block.timestamp;
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice Returns the present (rebased) balance of `account`.
     * @dev Converts from scaled balance using the current index.
     */
    function balanceOf(address account) public view returns (uint256) {
        return (scaledBalances[account] * currentIndex) / 1e18;
    }

    /**
     * @notice Returns the present (rebased) total supply.
     */
    function totalSupply() public view returns (uint256) {
        return (totalScaledSupply * currentIndex) / 1e18;
    }

    // ============================================================
    // External Functions
    // ============================================================

    /**
     * @notice Triggers a rebase event by applying the rebase rate to the index.
     * @dev Callable by anyone in tests. Applies positive or negative rate.
     */
    function rebase() external {
        if (rebaseRate > 0) {
            currentIndex = currentIndex + (currentIndex * uint256(rebaseRate)) / 10000;
        } else if (rebaseRate < 0) {
            uint256 decrease = (currentIndex * uint256(-rebaseRate)) / 10000;
            currentIndex = currentIndex - decrease;
        }
        lastRebaseTimestamp = block.timestamp;
    }

    /**
     * @notice Mints `amount` present tokens to `to`.
     * @dev Converts to scaled units before storing.
     */
    function mint(address to, uint256 amount) public {
        uint256 scaledAmount = (amount * 1e18) / currentIndex;
        scaledBalances[to] = scaledBalances[to] + scaledAmount;
        totalScaledSupply = totalScaledSupply + scaledAmount;
        emit Transfer(address(0), to, amount);
    }

    /**
     * @notice Approves `spender` to spend `amount` present tokens on behalf of the caller.
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfers `amount` present tokens from the caller to `recipient`.
     */
    function transfer(address recipient, uint256 amount) external returns (bool) {
        uint256 scaledAmount = (amount * 1e18) / currentIndex;
        uint256 fromScaled = scaledBalances[msg.sender];
        require(fromScaled >= scaledAmount, "ERC20: insufficient balance");

        scaledBalances[msg.sender] = fromScaled - scaledAmount;
        scaledBalances[recipient] = scaledBalances[recipient] + scaledAmount;

        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    /**
     * @notice Transfers `amount` present tokens from `sender` to `recipient` using allowance.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 scaledAmount = (amount * 1e18) / currentIndex;
        uint256 fromScaled = scaledBalances[sender];
        require(fromScaled >= scaledAmount, "ERC20: insufficient balance");
        require(allowance[sender][msg.sender] >= amount, "ERC20: insufficient allowance");

        allowance[sender][msg.sender] -= amount;
        scaledBalances[sender] = fromScaled - scaledAmount;
        scaledBalances[recipient] = scaledBalances[recipient] + scaledAmount;

        emit Transfer(sender, recipient, amount);
        return true;
    }

    /**
     * @notice Force-transfers present tokens without allowance check (testing only).
     */
    function forceTransferFrom(address from, address to, uint256 amount) external {
        uint256 scaledAmount = (amount * 1e18) / currentIndex;
        require(scaledBalances[from] >= scaledAmount, "ERC20: insufficient balance");
        scaledBalances[from] -= scaledAmount;
        scaledBalances[to] += scaledAmount;
        emit Transfer(from, to, amount);
    }

    // ============================================================
    // Test Helpers
    // ============================================================

    /**
     * @notice Sets a new rebase rate for testing different scenarios.
     * @param newRate The new rebase rate in basis points.
     */
    function setRebaseRate(int256 newRate) external {
        rebaseRate = newRate;
    }

    /**
     * @notice Force-sets the scaling index for precise testing.
     * @param newIndex The new index value (1e18 = no change).
     */
    function setIndex(uint256 newIndex) external {
        currentIndex = newIndex;
    }
}
