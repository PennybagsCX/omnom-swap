// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockEmptyReturnToken
 * @notice Standalone ERC20 token whose transfer/transferFrom/approve return empty bytes.
 *         Simulates non-standard tokens like Bag, eShrek on Dogechain that do not
 *         return a bool from these functions.
 *
 *         Key behavior:
 *         - transfer(), transferFrom(), approve() do NOT return bool
 *         - Functions succeed but return no data (empty returndata)
 *         - SafeERC20 handles this via: if (returndata.length == 0) → success
 *         - Standard balance tracking and allowance management
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockEmptyReturnToken {
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
     * @notice Approves `spender` to spend `amount` tokens.
     * @dev Returns empty bytes (no return value). SafeERC20 handles this.
     */
    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        // No return — empty returndata
    }

    /**
     * @notice Transfers `amount` tokens from the caller to `recipient`.
     * @dev Returns empty bytes (no return value). SafeERC20 handles this.
     */
    function transfer(address recipient, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        // No return — empty returndata
    }

    /**
     * @notice Transfers `amount` tokens from `sender` to `recipient` using allowance.
     * @dev Returns empty bytes (no return value). SafeERC20 handles this.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external {
        require(balanceOf[sender] >= amount, "Insufficient balance");
        require(allowance[sender][msg.sender] >= amount, "Insufficient allowance");

        allowance[sender][msg.sender] -= amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;

        emit Transfer(sender, recipient, amount);
        // No return — empty returndata
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
