// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockPermit2Token
 * @notice Standalone ERC20 token with EIP-2612 permit functionality for testing.
 *         Allows setting allowances via signed messages (gasless approvals).
 *
 *         Features:
 *         - Standard ERC20 interface (approve, transfer, transferFrom, etc.)
 *         - EIP-2612 `permit()` function for gasless approvals
 *         - DOMAIN_SEPARATOR computed from name, version, chainId, contract address
 *         - PERMIT_TYPEHASH for structured signature validation
 *         - `nonces[owner]` mapping for replay protection
 *         - Reverts on: expired deadline, invalid signature, invalid nonce
 *
 *         Standalone (no inheritance) to avoid override conflicts.
 */
contract MockPermit2Token {
    // ============================================================
    // State
    // ============================================================

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice EIP-2612 nonces for replay protection.
    mapping(address => uint256) public nonces;

    // ============================================================
    // Constants
    // ============================================================

    /// @dev EIP-712 typehash for the Permit struct.
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    /// @dev EIP-712 domain separator version.
    string private constant _VERSION = "1";

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
    // EIP-712 Domain Separator
    // ============================================================

    /**
     * @notice Returns the EIP-712 domain separator for this token.
     * @dev Computed from name, version, chainId, and contract address.
     */
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(_VERSION)),
                block.chainid,
                address(this)
            )
        );
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

    // ============================================================
    // EIP-2612 Permit
    // ============================================================

    /**
     * @notice Sets `amount` as the allowance of `spender` over `owner`'s tokens,
     *         given `owner`'s signed approval (EIP-2612).
     * @param owner     Token owner who signed the permit.
     * @param spender   Address to receive the allowance.
     * @param value     Allowance amount to set.
     * @param deadline  Timestamp after which the signature expires.
     * @param v         ECDSA recovery byte.
     * @param r         ECDSA signature r component.
     * @param s         ECDSA signature s component.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "Permit expired");
        require(owner != address(0), "Invalid owner");

        // Compute the EIP-712 structured hash
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                owner,
                spender,
                value,
                nonces[owner]++,
                deadline
            )
        );

        // Compute the EIP-712 digest
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash)
        );

        // Recover signer and verify
        address recoveredAddress = ecrecover(digest, v, r, s);
        require(recoveredAddress != address(0), "Invalid signature");
        require(recoveredAddress == owner, "Invalid signer");

        // Set allowance
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }
}
