// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockPausableToken
 * @notice Standalone ERC20 token with pause/unpause functionality for testing.
 *         Simulates tokens that can halt transfers in emergency situations.
 *
 *         Features:
 *         - Standard ERC20 interface
 *         - `pause()` / `unpause()` admin functions
 *         - When paused: `transfer()` and `transferFrom()` revert with "Token paused"
 *         - `approve()` works even when paused (allowance setting doesn't move tokens)
 *         - `mint()` works even when paused (admin function)
 *         - `forceTransferFrom()` works even when paused (for router recovery)
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockPausableToken {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Whether the token is currently paused.
    bool public paused;

    /// @notice Admin address that can pause/unpause.
    address public admin;

    // ============================================================
    // Events
    // ============================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Paused();
    event Unpaused();

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
        admin = msg.sender;
    }

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /// @notice Pauses all token transfers.
    function pause() external onlyAdmin {
        paused = true;
        emit Paused();
    }

    /// @notice Unpauses token transfers.
    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused();
    }

    // ============================================================
    // ERC20 Functions
    // ============================================================

    /// @notice Mints `amount` tokens to `to`. Works even when paused.
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Approves `spender` to spend `amount` tokens. Works even when paused.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens from caller to recipient. Reverts when paused.
    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(!paused, "Token paused");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens using allowance. Reverts when paused.
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        require(!paused, "Token paused");
        uint256 currentAllowance = allowance[sender][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] = currentAllowance - amount;
        require(balanceOf[sender] >= amount, "Insufficient balance");
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
        return true;
    }

    /// @notice Force-transfers tokens without allowance check. Works even when paused.
    function forceTransferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
