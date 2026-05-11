// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockDynamicFeeToken
 * @notice Standalone ERC20 token with configurable dynamic fees for testing.
 *         Simulates tax tokens where the fee rate can change mid-transaction.
 *
 *         Features:
 *         - Configurable fee in basis points, changeable at any time
 *         - Fee applied on both `transfer()` and `transferFrom()`
 *         - Address-based fee exemptions (e.g., DEX pools, aggregators)
 *         - Configurable rounding mode (Floor / Ceil / Round)
 *         - Auto-fee-change mechanism for mid-swap fee transitions
 *         - Standard ERC20 interface compatible with SafeERC20
 *
 *         Like MockFeeOnTransferToken, this is standalone (no inheritance)
 *         to avoid override conflicts with OpenZeppelin or MockERC20.
 */
contract MockDynamicFeeToken {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Current fee in basis points (e.g., 300 = 3%).
    uint256 public feeBps;

    /// @notice Address that receives collected fees.
    address public feeRecipient;

    /// @notice Whether the fee mechanism is active.
    bool public feeEnabled;

    /// @notice Addresses exempt from paying fees on transfer.
    mapping(address => bool) public feeExempt;

    /// @notice Rounding mode for fee calculation.
    enum RoundingMode { Floor, Ceil, Round }
    RoundingMode public roundingMode;

    /// @notice Counter incremented on every transfer (for auto-fee-change).
    uint256 public transferCount;

    /// @notice Auto-change fee after this many transfers (0 = disabled).
    uint256 public autoFeeChangeAfter;

    /// @notice New fee to set when auto-change triggers.
    uint256 public autoFeeChangeTo;

    /// @notice Auto-change fee exemption after this many transfers (0 = disabled).
    uint256 public autoExemptChangeAfter;

    /// @notice Address whose exemption changes on auto-trigger.
    address public autoExemptChangeAddress;

    /// @notice New exemption status on auto-trigger.
    bool public autoExemptChangeValue;

    // ============================================================
    // Events
    // ============================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param name_        Token name.
     * @param symbol_      Token symbol.
     * @param decimals_    Token decimals.
     * @param feeBps_      Initial fee in basis points.
     * @param feeRecipient_ Address to receive fees.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 feeBps_,
        address feeRecipient_
    ) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        feeEnabled = true;
        roundingMode = RoundingMode.Floor;
    }

    // ============================================================
    // Configuration
    // ============================================================

    /// @notice Updates the fee rate in basis points.
    function setFeeBps(uint256 newFeeBps) external {
        feeBps = newFeeBps;
    }

    /// @notice Enables or disables the fee mechanism.
    function setFeeEnabled(bool enabled) external {
        feeEnabled = enabled;
    }

    /// @notice Sets fee exemption status for an address.
    function setFeeExempt(address account, bool exempt) external {
        feeExempt[account] = exempt;
    }

    /// @notice Sets the rounding mode for fee calculation.
    function setRoundingMode(RoundingMode mode) external {
        roundingMode = mode;
    }

    /// @notice Updates the fee recipient address.
    function setFeeRecipient(address recipient) external {
        feeRecipient = recipient;
    }

    /// @notice Configures automatic fee change after N transfers.
    ///         Set afterN = 0 to disable.
    function setAutoFeeChange(uint256 afterN, uint256 newFee) external {
        autoFeeChangeAfter = afterN;
        autoFeeChangeTo = newFee;
    }

    /// @notice Configures automatic exemption change after N transfers.
    ///         Set afterN = 0 to disable.
    function setAutoExemptChange(
        uint256 afterN,
        address account,
        bool exempt
    ) external {
        autoExemptChangeAfter = afterN;
        autoExemptChangeAddress = account;
        autoExemptChangeValue = exempt;
    }

    // ============================================================
    // ERC20 Functions
    // ============================================================

    /// @notice Mints tokens to the specified address.
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Approves spender to transfer tokens on behalf of caller.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfers tokens from caller to recipient, deducting fee if applicable.
    function transfer(address to, uint256 amount) external returns (bool) {
        _transferWithFee(msg.sender, to, amount);
        return true;
    }

    /// @notice Transfers tokens using allowance, deducting fee if applicable.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] = currentAllowance - amount;
        _transferWithFee(from, to, amount);
        return true;
    }

    /// @notice Force-transfers tokens without allowance check (testing only).
    ///         Still applies fee, unlike MockFeeOnTransferToken which skips it.
    function forceTransferFrom(address from, address to, uint256 amount) external {
        _transferWithFee(from, to, amount);
    }

    // ============================================================
    // Internal
    // ============================================================

    /**
     * @dev Executes a transfer with optional fee deduction.
     *      Fee is charged on the `from` address (sender pays the fee).
     *      The fee is sent to `feeRecipient` and the net amount goes to `to`.
     */
    function _transferWithFee(address from, address to, uint256 amount) internal {
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "ERC20: insufficient balance");

        balanceOf[from] = fromBalance - amount;

        if (feeEnabled && !feeExempt[from] && feeBps > 0) {
            uint256 fee = _calculateFee(amount);
            uint256 amountAfterFee = amount - fee;

            balanceOf[to] += amountAfterFee;
            balanceOf[feeRecipient] += fee;

            emit Transfer(from, to, amountAfterFee);
            emit Transfer(from, feeRecipient, fee);
        } else {
            balanceOf[to] += amount;
            emit Transfer(from, to, amount);
        }

        // Increment counter and check auto-change triggers
        transferCount++;
        _checkAutoChanges();
    }

    /**
     * @dev Calculates fee based on current rounding mode.
     *      - Floor: standard integer division (rounds down)
     *      - Ceil:  rounds up if there is any remainder
     *      - Round: rounds to nearest (up if remainder >= 5000)
     */
    function _calculateFee(uint256 amount) internal view returns (uint256) {
        uint256 rawFee = (amount * feeBps) / 10000;
        if (roundingMode == RoundingMode.Ceil) {
            uint256 remainder = (amount * feeBps) % 10000;
            if (remainder > 0) rawFee += 1;
        } else if (roundingMode == RoundingMode.Round) {
            uint256 remainder = (amount * feeBps) % 10000;
            if (remainder >= 5000) rawFee += 1;
        }
        return rawFee;
    }

    /**
     * @dev Checks and applies automatic fee/exemption changes after each transfer.
     *      One-time triggers — disabled after firing.
     */
    function _checkAutoChanges() internal {
        if (autoFeeChangeAfter > 0 && transferCount >= autoFeeChangeAfter) {
            feeBps = autoFeeChangeTo;
            autoFeeChangeAfter = 0;
        }
        if (autoExemptChangeAfter > 0 && transferCount >= autoExemptChangeAfter) {
            feeExempt[autoExemptChangeAddress] = autoExemptChangeValue;
            autoExemptChangeAfter = 0;
        }
    }
}
