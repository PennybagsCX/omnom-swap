// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockInflationaryToken
 * @notice Standalone ERC20 token that mints extra tokens on every transfer.
 *         Simulates inflationary tokens where the recipient receives more than
 *         the sender sent (balance increases, total supply increases).
 *
 *         Features:
 *         - Configurable `mintBps` (basis points minted per transfer, e.g., 100 = 1%)
 *         - On transfer/transferFrom: recipient receives `amount + (amount * mintBps / 10000)`
 *         - Extra minted tokens go to the recipient (not the sender)
 *         - Total supply increases by the inflation bonus on every transfer
 *         - forceTransferFrom also mints extra (for router compatibility)
 *         - When mintBps = 0, behaves identically to a standard ERC20
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockInflationaryToken {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Inflation basis points (e.g., 100 = 1% extra minted on transfer).
    uint256 public mintBps;

    // ============================================================
    // Events
    // ============================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param _name    Token name.
     * @param _symbol  Token symbol.
     * @param _decimals Token decimals.
     * @param _mintBps Inflation basis points (e.g., 100 = 1% extra).
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _mintBps
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        mintBps = _mintBps;
    }

    // ============================================================
    // Configuration
    // ============================================================

    /// @notice Updates the inflation rate in basis points.
    function setMintBps(uint256 _mintBps) external {
        mintBps = _mintBps;
    }

    // ============================================================
    // ERC20 Functions
    // ============================================================

    /// @notice Mints `amount` tokens to `to`. Anyone can call in tests.
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Approves `spender` to spend `amount` tokens on behalf of caller.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens from caller to recipient with inflation bonus.
    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transferInflationary(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens using allowance with inflation bonus.
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[sender][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] = currentAllowance - amount;
        _transferInflationary(sender, recipient, amount);
        return true;
    }

    /// @notice Force-transfers tokens without allowance check (testing only). Also mints extra.
    function forceTransferFrom(address from, address to, uint256 amount) external {
        _transferInflationary(from, to, amount);
    }

    // ============================================================
    // Internal
    // ============================================================

    /**
     * @dev Executes a transfer with inflation bonus.
     *      The sender loses `amount`, the recipient gains `amount + bonus`.
     *      Total supply increases by `bonus`.
     */
    function _transferInflationary(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");

        balanceOf[from] -= amount;

        uint256 bonus = (amount * mintBps) / 10000;
        uint256 received = amount + bonus;

        balanceOf[to] += received;
        totalSupply += bonus;

        emit Transfer(from, to, amount);
        if (bonus > 0) {
            emit Transfer(address(0), to, bonus);
        }
    }
}
