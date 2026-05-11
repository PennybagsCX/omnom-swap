// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockBlocklistToken
 * @notice Standalone ERC20 token with address blocklist functionality.
 *         Simulates tokens that can block specific addresses from sending/receiving.
 *
 *         Key behavior:
 *         - blocklist(address) — admin function to block/unblock addresses
 *         - isBlocked(address) — view function to check blocklist status
 *         - transfer() and transferFrom() revert if from or to is blocked
 *         - forceTransferFrom() bypasses blocklist check (for router use)
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockBlocklistToken {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Mapping of blocked addresses.
    mapping(address => bool) public isBlocked;

    /// @notice Admin address that can modify the blocklist.
    address public admin;

    // ============================================================
    // Events
    // ============================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BlocklistUpdated(address indexed account, bool blocked);

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
     * @notice Adds or removes an address from the blocklist.
     * @param account The address to block/unblock.
     * @param blocked True to block, false to unblock.
     */
    function blocklist(address account, bool blocked) external onlyAdmin {
        isBlocked[account] = blocked;
        emit BlocklistUpdated(account, blocked);
    }

    /**
     * @notice Approves `spender` to spend `amount` tokens on behalf of the caller.
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfers `amount` tokens from the caller to `recipient`.
     * @dev Reverts if caller or recipient is blocked.
     */
    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(!isBlocked[msg.sender], "Sender blocked");
        require(!isBlocked[recipient], "Recipient blocked");
        return _transfer(msg.sender, recipient, amount);
    }

    /**
     * @notice Transfers `amount` tokens from `sender` to `recipient` using allowance.
     * @dev Reverts if sender, recipient, or caller is blocked.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        require(!isBlocked[sender], "Sender blocked");
        require(!isBlocked[recipient], "Recipient blocked");
        require(!isBlocked[msg.sender], "Caller blocked");
        require(allowance[sender][msg.sender] >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] -= amount;
        return _transfer(sender, recipient, amount);
    }

    /**
     * @notice Force-transfers tokens without allowance or blocklist check (testing only).
     *         Used by the mock router to pull tokens in.
     */
    function forceTransferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
