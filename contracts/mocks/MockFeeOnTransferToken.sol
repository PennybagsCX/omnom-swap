// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockFeeOnTransferToken
 * @notice ERC20 token that deducts a fee on every transfer.
 *         Simulates tokens like MCRIB that have buy/sell tax.
 */
contract MockFeeOnTransferToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Fee in basis points (e.g., 300 = 3%)
    uint256 public feeBps;
    address public feeRecipient;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _feeBps,
        address _feeRecipient
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, recipient, amount);
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        require(allowance[sender][msg.sender] >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] -= amount;
        return _transfer(sender, recipient, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");

        uint256 fee = (amount * feeBps) / 10000;
        uint256 received = amount - fee;

        balanceOf[from] -= amount;
        balanceOf[to] += received;
        if (fee > 0) {
            balanceOf[feeRecipient] += fee;
        }

        emit Transfer(from, to, received);
        if (fee > 0) {
            emit Transfer(from, feeRecipient, fee);
        }
        return true;
    }

    /// @notice Force-transfers tokens without allowance check (testing only).
    function forceTransferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
