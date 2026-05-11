// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockDOG20Token
 * @notice Standalone ERC20 token implementing the Dogechain DOG20 standard for testing.
 *         DOG20 is ERC20-compatible on Dogechain with additional extensions.
 *
 *         Features:
 *         - Standard ERC20 interface (DOG20 is ERC20-compatible)
 *         - `owner()` — contract owner
 *         - `mintFee()` — fee charged on mint (in bps)
 *         - `transferFee()` — fee charged on transfer (in bps, separate from fee-on-transfer)
 *         - `maxSupply()` — maximum supply cap
 *         - `isDOG20()` — returns true (identifier)
 *         - When `maxSupply` is reached, `mint()` reverts
 *         - Both `mintFee` and `transferFee` can be 0
 *         - Standard `forceTransferFrom()` for router use
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockDOG20Token {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Contract owner.
    address public owner;

    /// @notice Fee charged on mint in basis points (e.g., 100 = 1%).
    uint256 public mintFee;

    /// @notice Fee charged on transfer in basis points (e.g., 200 = 2%).
    uint256 public transferFee;

    /// @notice Maximum supply cap (0 = unlimited).
    uint256 public maxSupply;

    /// @notice Address that receives fees.
    address public feeRecipient;

    // ============================================================
    // Events
    // ============================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param _name        Token name.
     * @param _symbol      Token symbol.
     * @param _decimals    Token decimals.
     * @param _mintFee     Mint fee in bps.
     * @param _transferFee Transfer fee in bps.
     * @param _maxSupply   Maximum supply cap (0 = unlimited).
     * @param _feeRecipient Address to receive fees.
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _mintFee,
        uint256 _transferFee,
        uint256 _maxSupply,
        address _feeRecipient
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        owner = msg.sender;
        mintFee = _mintFee;
        transferFee = _transferFee;
        maxSupply = _maxSupply;
        feeRecipient = _feeRecipient;
    }

    // ============================================================
    // DOG20 Identifiers
    // ============================================================

    /// @notice Returns true to identify this as a DOG20 token.
    function isDOG20() external pure returns (bool) {
        return true;
    }

    // ============================================================
    // ERC20 Functions
    // ============================================================

    /**
     * @notice Mints `amount` tokens to `to`. Deducts mint fee if applicable.
     * @dev Reverts if maxSupply would be exceeded.
     */
    function mint(address to, uint256 amount) external {
        if (maxSupply > 0) {
            require(totalSupply + amount <= maxSupply, "Max supply exceeded");
        }

        totalSupply += amount;

        if (mintFee > 0 && feeRecipient != address(0)) {
            uint256 fee = (amount * mintFee) / 10000;
            uint256 netAmount = amount - fee;
            balanceOf[to] += netAmount;
            balanceOf[feeRecipient] += fee;
            emit Transfer(address(0), to, netAmount);
            emit Transfer(address(0), feeRecipient, fee);
        } else {
            balanceOf[to] += amount;
            emit Transfer(address(0), to, amount);
        }
    }

    /// @notice Approves `spender` to spend `amount` tokens on behalf of caller.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens from caller to recipient, deducting transfer fee.
    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transferWithFee(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens using allowance, deducting transfer fee.
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[sender][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] = currentAllowance - amount;
        _transferWithFee(sender, recipient, amount);
        return true;
    }

    /// @notice Force-transfers tokens without allowance check (testing only). Deducts transfer fee.
    function forceTransferFrom(address from, address to, uint256 amount) external {
        _transferWithFee(from, to, amount);
    }

    // ============================================================
    // Internal
    // ============================================================

    /**
     * @dev Executes a transfer with optional fee deduction.
     *      The sender pays `amount`, the recipient receives `amount - fee`.
     *      The fee is sent to `feeRecipient`.
     */
    function _transferWithFee(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;

        if (transferFee > 0 && feeRecipient != address(0)) {
            uint256 fee = (amount * transferFee) / 10000;
            uint256 netAmount = amount - fee;
            balanceOf[to] += netAmount;
            balanceOf[feeRecipient] += fee;
            emit Transfer(from, to, netAmount);
            emit Transfer(from, feeRecipient, fee);
        } else {
            balanceOf[to] += amount;
            emit Transfer(from, to, amount);
        }
    }
}
