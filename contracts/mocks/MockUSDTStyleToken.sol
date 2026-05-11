// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockUSDTStyleToken
 * @notice Standalone ERC20 token that mimics USDT's approval behavior.
 *         Requires approve(spender, 0) before setting a non-zero allowance.
 *
 *         Behavior:
 *         - approve(spender, amount) reverts if current allowance != 0 && amount != 0
 *         - Must call approve(spender, 0) first, then approve(spender, newAmount)
 *         - transfer() and transferFrom() behave normally
 *         - forceTransferFrom() bypasses allowance check (for router use)
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockUSDTStyleToken {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
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
     * @param _name     Token name.
     * @param _symbol   Token symbol.
     * @param _decimals Token decimals.
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    // ============================================================
    // External Functions
    // ============================================================

    /**
     * @notice Mints `amount` tokens to `to`. Anyone can call this in tests.
     * @param to     The recipient address.
     * @param amount The number of tokens to mint.
     */
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /**
     * @notice Approves `spender` to spend `amount` tokens on behalf of the caller.
     * @dev Reverts if current allowance is non-zero and new amount is non-zero.
     *      Must reset to 0 first: approve(spender, 0) then approve(spender, newAmount).
     *      This mimics USDT's approval behavior.
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        require(
            allowance[msg.sender][spender] == 0 || amount == 0,
            "USDT-style: reset to 0 first"
        );
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfers `amount` tokens from the caller to `recipient`.
     */
    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    /**
     * @notice Transfers `amount` tokens from `sender` to `recipient` using allowance.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        require(balanceOf[sender] >= amount, "Insufficient balance");
        require(allowance[sender][msg.sender] >= amount, "Insufficient allowance");

        allowance[sender][msg.sender] -= amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;

        emit Transfer(sender, recipient, amount);
        return true;
    }

    /**
     * @notice Force-transfers tokens without allowance check (testing only).
     *         Used by the mock router to pull tokens in.
     */
    function forceTransferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
