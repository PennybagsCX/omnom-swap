// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockBurnOnTransferToken
 * @notice Standalone deflationary ERC20 token that burns a portion of each transfer.
 *         Simulates tokens where transfers reduce total supply (true deflationary).
 *
 *         On each transfer:
 *         - `burnBps` basis points of the amount are sent to address(0) (burned)
 *         - The remaining `amount - burnPortion` arrives at the destination
 *         - `totalSupply` decreases by the burned amount
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockBurnOnTransferToken {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Burn rate in basis points (e.g., 500 = 5% burned per transfer).
    uint256 public burnBps;

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
     * @param _burnBps Burn basis points per transfer (e.g., 500 = 5%).
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _burnBps
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        burnBps = _burnBps;
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
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfers `amount` tokens from the caller to `recipient`.
     *         A portion is burned (sent to address(0)) based on burnBps.
     */
    function transfer(address recipient, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, recipient, amount);
    }

    /**
     * @notice Transfers `amount` tokens from `sender` to `recipient` using allowance.
     *         A portion is burned based on burnBps.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        require(allowance[sender][msg.sender] >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] -= amount;
        return _transfer(sender, recipient, amount);
    }

    /**
     * @notice Force-transfers tokens without allowance check (testing only).
     *         Also burns a portion of the transfer.
     */
    function forceTransferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");

        uint256 burnAmount = (amount * burnBps) / 10000;
        uint256 received = amount - burnAmount;

        balanceOf[from] -= amount;
        balanceOf[to] += received;

        // True deflationary: totalSupply decreases
        totalSupply -= burnAmount;

        emit Transfer(from, to, received);
        if (burnAmount > 0) {
            emit Transfer(from, address(0), burnAmount);
        }
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    /**
     * @dev Core transfer logic with burn mechanism.
     *      Burns go to address(0) and reduce totalSupply.
     */
    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");

        uint256 burnAmount = (amount * burnBps) / 10000;
        uint256 received = amount - burnAmount;

        balanceOf[from] -= amount;
        balanceOf[to] += received;

        // True deflationary: totalSupply decreases
        totalSupply -= burnAmount;

        emit Transfer(from, to, received);
        if (burnAmount > 0) {
            emit Transfer(from, address(0), burnAmount);
        }

        return true;
    }
}
