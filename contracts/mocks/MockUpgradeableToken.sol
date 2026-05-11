// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockUpgradeableToken
 * @notice A simple proxy + implementation pattern for testing upgradeable tokens.
 *
 *         Contains three contracts:
 *         1. `SimpleProxy` — Minimal proxy that delegates all calls to an implementation
 *         2. `UpgradeableTokenV1` — Standard ERC20 implementation
 *         3. `UpgradeableTokenV2` — ERC20 with fee-on-transfer behavior (upgrade)
 *
 *         Storage layout is compatible between V1 and V2:
 *         - Slots 0-4: name, symbol, decimals, totalSupply (same in both)
 *         - Slot 5+: balanceOf, allowance (same in both)
 *         - V2 adds: feeBps, feeRecipient (appended after V1 layout)
 *
 *         The proxy uses EIP-1967-style storage slots for implementation and admin
 *         to avoid collision with implementation storage.
 */
contract SimpleProxy {
    // ============================================================
    // EIP-1967 Storage Slots (avoid collision with implementation)
    // ============================================================

    bytes32 internal constant _IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    bytes32 internal constant _ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @param _implementation The initial implementation contract address.
     */
    constructor(address _implementation) {
        _setImplementation(_implementation);
        _setAdmin(msg.sender);
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /**
     * @notice Upgrades the implementation contract.
     * @param newImplementation The new implementation address.
     */
    function upgradeTo(address newImplementation) external {
        require(msg.sender == _getAdmin(), "Not admin");
        _setImplementation(newImplementation);
    }

    /// @notice Returns the current implementation address.
    function getImplementation() external view returns (address) {
        return _getImplementation();
    }

    /// @notice Returns the current admin address.
    function getAdmin() external view returns (address) {
        return _getAdmin();
    }

    // ============================================================
    // Fallback — delegate all calls to implementation
    // ============================================================

    fallback() external payable {
        _delegate();
    }

    receive() external payable {
        _delegate();
    }

    // ============================================================
    // Internal
    // ============================================================

    function _delegate() internal {
        address impl = _getImplementation();
        require(impl != address(0), "No implementation");
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    function _setImplementation(address impl) internal {
        assembly {
            sstore(_IMPLEMENTATION_SLOT, impl)
        }
    }

    function _getImplementation() internal view returns (address impl) {
        assembly {
            impl := sload(_IMPLEMENTATION_SLOT)
        }
    }

    function _setAdmin(address adm) internal {
        assembly {
            sstore(_ADMIN_SLOT, adm)
        }
    }

    function _getAdmin() internal view returns (address adm) {
        assembly {
            adm := sload(_ADMIN_SLOT)
        }
    }
}

/**
 * @title UpgradeableTokenV1
 * @notice Standard ERC20 implementation for the upgradeable token proxy.
 *         Uses `initialize()` instead of a constructor (proxy pattern).
 */
contract UpgradeableTokenV1 {
    // ============================================================
    // State (must be layout-compatible with V2)
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
    // Initialize (replaces constructor for proxy)
    // ============================================================

    /**
     * @notice Initializes the token. Called once after proxy deployment.
     * @param _name     Token name.
     * @param _symbol   Token symbol.
     * @param _decimals Token decimals.
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) external {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    // ============================================================
    // Version
    // ============================================================

    /// @notice Returns the current version string.
    function version() external pure returns (string memory) {
        return "V1";
    }

    // ============================================================
    // ERC20 Functions
    // ============================================================

    /// @notice Mints `amount` tokens to `to`.
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

    /// @notice Transfers `amount` tokens from caller to recipient.
    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens using allowance.
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[sender][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] = currentAllowance - amount;
        require(balanceOf[sender] >= amount, "Insufficient balance");
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
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

/**
 * @title UpgradeableTokenV2
 * @notice ERC20 with fee-on-transfer behavior. Upgrade from V1.
 *         Storage layout is compatible with V1 — new fields appended at the end.
 */
contract UpgradeableTokenV2 {
    // ============================================================
    // State (V1 layout — must match exactly)
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ============================================================
    // V2 Additions (appended after V1 layout)
    // ============================================================

    /// @notice Fee in basis points applied on transfer (e.g., 100 = 1%).
    uint256 public feeBps;

    /// @notice Address that receives transfer fees.
    address public feeRecipient;

    // ============================================================
    // Events
    // ============================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============================================================
    // Initialize (same as V1 for compatibility)
    // ============================================================

    /**
     * @notice Initializes the token. Called once after proxy deployment.
     * @param _name     Token name.
     * @param _symbol   Token symbol.
     * @param _decimals Token decimals.
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) external {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    // ============================================================
    // Version
    // ============================================================

    /// @notice Returns the current version string.
    function version() external pure returns (string memory) {
        return "V2";
    }

    // ============================================================
    // V2 Configuration
    // ============================================================

    /**
     * @notice Sets the fee configuration for V2 fee-on-transfer behavior.
     * @param _feeBps      Fee in basis points.
     * @param _feeRecipient Address to receive fees.
     */
    function setFee(uint256 _feeBps, address _feeRecipient) external {
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
    }

    // ============================================================
    // ERC20 Functions
    // ============================================================

    /// @notice Mints `amount` tokens to `to`.
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

    /// @notice Transfers `amount` tokens from caller to recipient, with fee deduction.
    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transferWithFee(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Transfers `amount` tokens using allowance, with fee deduction.
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[sender][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        allowance[sender][msg.sender] = currentAllowance - amount;
        _transferWithFee(sender, recipient, amount);
        return true;
    }

    /// @notice Force-transfers tokens without allowance check (testing only). Applies fee.
    function forceTransferFrom(address from, address to, uint256 amount) external {
        _transferWithFee(from, to, amount);
    }

    // ============================================================
    // Internal
    // ============================================================

    /**
     * @dev Executes a transfer with optional fee deduction.
     *      If feeBps > 0 and feeRecipient is set, deducts fee from transfer.
     */
    function _transferWithFee(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;

        if (feeBps > 0 && feeRecipient != address(0)) {
            uint256 fee = (amount * feeBps) / 10000;
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
