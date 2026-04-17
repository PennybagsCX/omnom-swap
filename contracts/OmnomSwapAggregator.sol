// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";
import {ReentrancyGuard} from "./libraries/ReentrancyGuard.sol";

/**
 * @notice Minimal interface for WWDOGE (wrapped native DOGE) deposit/withdraw.
 */
interface IWWDOGE {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

/**
 * @title OmnomSwapAggregator
 * @notice A multi-hop DEX aggregator on Dogechain that executes pre-computed swap routes
 *         across multiple UniswapV2-compatible DEXes. The contract receives routing
 *         instructions from an off-chain pathfinder and atomically executes swaps with
 *         protocol fee deduction and slippage protection.
 *
 * @dev All DEXes on Dogechain (Chewyswap, Dogeshrek, KibbleSwap, etc.) use
 *      UniswapV2-style contracts, so a single interface covers all of them.
 *      The contract does NOT perform on-chain pathfinding - all routing logic
 *      lives off-chain to save gas and maximize flexibility.
 */
contract OmnomSwapAggregator is ReentrancyGuard {
    using SafeERC20 for address;

    // ============================================================
    // Constants
    // ============================================================

    /// @notice Maximum allowed protocol fee in basis points (5%).
    uint256 public constant MAX_FEE_BPS = 500;

    /// @notice Basis points denominator.
    uint256 private constant _BPS_DENOMINATOR = 10_000;

    // ============================================================
    // State Variables
    // ============================================================

    /// @notice Contract owner - can configure fees, treasury, and DEX registry.
    address public owner;

    /// @notice Recipient of protocol fees.
    address public treasury;

    /// @notice Protocol fee in basis points (e.g., 25 = 0.25%).
    uint256 public protocolFeeBps;

    /// @notice WWDOGE (wrapped native DOGE) contract address.
    address public immutable WWDOGE;

    /// @notice Emergency pause flag - when true, swaps are disabled.
    bool public paused;

    /// @notice Whitelist of approved DEX router addresses.
    mapping(address => bool) public supportedRouters;

    /// @notice List of all registered router addresses (for enumeration).
    address[] public routerList;

    // ============================================================
    // Structs
    // ============================================================

    /**
     * @notice Represents a single swap step across one DEX.
     * @param router       The DEX router address to use for this step.
     * @param path         The token path for this step (e.g., [WDOGE, USDC]).
     * @param amountIn     The input amount for this step.
     * @param minAmountOut The minimum output amount (slippage protection).
     */
    struct SwapStep {
        address router;
        address[] path;
        uint256 amountIn;
        uint256 minAmountOut;
    }

    /**
     * @notice Represents a full swap request from the user.
     * @param tokenIn          The token the user sells.
     * @param tokenOut         The token the user buys.
     * @param amountIn         The total input amount.
     * @param minTotalAmountOut The minimum total output the user expects.
     * @param steps            The ordered list of swap steps to execute.
     * @param deadline         Unix timestamp after which the swap expires.
     * @param recipient        The address to receive the final output tokens.
     */
    struct SwapRequest {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minTotalAmountOut;
        SwapStep[] steps;
        uint256 deadline;
        address recipient;
    }

    // ============================================================
    // Events
    // ============================================================

    /// @notice Emitted when a swap is successfully executed.
    event SwapExecuted(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeCollected
    );

    /// @notice Emitted when a new DEX router is added to the registry.
    event RouterAdded(address indexed router);

    /// @notice Emitted when a DEX router is removed from the registry.
    event RouterRemoved(address indexed router);

    /// @notice Emitted when the treasury address is updated.
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /// @notice Emitted when the protocol fee is updated.
    event ProtocolFeeUpdated(uint256 oldBps, uint256 newBps);

    /// @notice Emitted when ownership is transferred.
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when tokens are rescued from the contract.
    event TokensRescued(address indexed token, uint256 amount);

    /// @notice Emitted when the contract is paused.
    event Paused();

    /// @notice Emitted when the contract is unpaused.
    event Unpaused();

    // ============================================================
    // Modifiers
    // ============================================================

    /// @dev Restricts access to the contract owner.
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /// @dev Restricts access to when the contract is not paused.
    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    /**
     * @notice Initializes the aggregator with a treasury address, protocol fee, and WWDOGE address.
     * @param _treasury       The address that will receive protocol fees.
     * @param _protocolFeeBps The initial protocol fee in basis points (e.g., 25 = 0.25%).
     * @param _wwdoge         The WWDOGE (wrapped native DOGE) contract address.
     */
    constructor(address _treasury, uint256 _protocolFeeBps, address _wwdoge) {
        require(_treasury != address(0), "Zero address treasury");
        require(_protocolFeeBps <= MAX_FEE_BPS, "Fee exceeds max");
        require(_wwdoge != address(0), "Invalid WWDOGE");

        owner = msg.sender;
        treasury = _treasury;
        protocolFeeBps = _protocolFeeBps;
        WWDOGE = _wwdoge;
    }

    // ============================================================
    // External Functions
    // ============================================================

    /**
     * @notice Executes a multi-step swap across one or more DEXes.
     * @dev The caller must have approved this contract to spend `request.amountIn`
     *      of `request.tokenIn` (unless sending native DOGE with msg.value).
     *      When swapping native DOGE, msg.value is automatically wrapped to WWDOGE.
     *      The protocol fee is deducted from the input amount before any swaps.
     *      Each step is executed sequentially, and the final output must meet the
     *      slippage threshold.
     *
     * @param request The swap request containing all routing information.
     */
    function executeSwap(SwapRequest calldata request) external payable nonReentrant whenNotPaused {
        // -- Auto-wrap native DOGE if selling WWDOGE with msg.value ------
        if (msg.value > 0) {
            require(request.tokenIn == WWDOGE, "Native DOGE only for WWDOGE swaps");
            require(msg.value == request.amountIn, "Value must match amountIn");
            IWWDOGE(WWDOGE).deposit{value: msg.value}();
        }

        // -- Deadline check --------------------------------------
        require(block.timestamp <= request.deadline, "Expired");

        // -- Validation ------------------------------------------
        require(request.amountIn > 0, "Amount must be greater than zero");
        require(request.steps.length > 0, "No steps");
        require(request.recipient != address(0), "Zero recipient");

        // -- Transfer input tokens from user (skip if already wrapped) ----
        if (msg.value == 0) {
            request.tokenIn.safeTransferFrom(msg.sender, address(this), request.amountIn);
        }

        // -- Calculate and collect protocol fee ------------------
        uint256 feeAmount = (request.amountIn * protocolFeeBps) / _BPS_DENOMINATOR;
        uint256 swapAmount = request.amountIn - feeAmount;

        if (feeAmount > 0) {
            request.tokenIn.safeTransfer(treasury, feeAmount);
        }

        // -- Execute swap steps sequentially ---------------------
        uint256 runningBalance = swapAmount;
        address currentToken = request.tokenIn;

        for (uint256 i = 0; i < request.steps.length; i++) {
            SwapStep calldata step = request.steps[i];

            // Validate the router is supported
            require(supportedRouters[step.router], "Unsupported router");

            // Validate the path starts with the current token
            require(step.path[0] == currentToken, "Path mismatch");

            // Validate the amount in matches our running balance for the first step
            // For subsequent steps, the amountIn should come from the previous output
            uint256 stepAmountIn = step.amountIn;
            if (i == 0) {
                require(stepAmountIn == swapAmount, "Step amount mismatch");
            }

            // Approve the router to spend the tokens
            currentToken.safeApprove(step.router, stepAmountIn);

            // Execute the swap - tokens come back to this contract
            uint256[] memory amounts = IUniswapV2Router02(step.router).swapExactTokensForTokens(
                stepAmountIn,
                step.minAmountOut,
                step.path,
                address(this),
                request.deadline
            );

            // Reset approval to 0 for security (some tokens require this)
            currentToken.safeApprove(step.router, 0);

            // Update tracking: the last element is the output amount
            uint256 outputAmount = amounts[amounts.length - 1];
            currentToken = step.path[step.path.length - 1];
            runningBalance = outputAmount;
        }

        // -- Slippage check --------------------------------------
        require(runningBalance >= request.minTotalAmountOut, "Slippage");

        // -- Transfer final tokens to recipient ------------------
        request.tokenOut.safeTransfer(request.recipient, runningBalance);

        // -- Emit event ------------------------------------------
        emit SwapExecuted(
            msg.sender,
            request.tokenIn,
            request.tokenOut,
            request.amountIn,
            runningBalance,
            feeAmount
        );

        // -- Refund any stray native DOGE (defense in depth) ----
        if (address(this).balance > 0) {
            (bool success, ) = msg.sender.call{value: address(this).balance}("");
            require(success, "Refund failed");
        }
    }

    // ============================================================
    // Receive
    // ============================================================

    /// @dev Rejects direct native DOGE transfers. Use executeSwap instead.
    receive() external payable {
        revert("Use executeSwap");
    }

    // ============================================================
    // Owner: Router Management
    // ============================================================

    /**
     * @notice Adds a DEX router to the supported list.
     * @param router The router address to add.
     */
    function addRouter(address router) external onlyOwner {
        require(router != address(0), "Zero address");
        require(!supportedRouters[router], "Already added");

        supportedRouters[router] = true;
        routerList.push(router);

        emit RouterAdded(router);
    }

    /**
     * @notice Removes a DEX router from the supported list.
     * @param router The router address to remove.
     */
    function removeRouter(address router) external onlyOwner {
        require(supportedRouters[router], "Not found");

        supportedRouters[router] = false;

        // Remove from routerList by swapping with last element and popping
        for (uint256 i = 0; i < routerList.length; i++) {
            if (routerList[i] == router) {
                routerList[i] = routerList[routerList.length - 1];
                routerList.pop();
                break;
            }
        }

        emit RouterRemoved(router);
    }

    /**
     * @notice Returns the number of registered routers.
     * @return The count of supported routers.
     */
    function getRouterCount() external view returns (uint256) {
        return routerList.length;
    }

    // ============================================================
    // Owner: Configuration
    // ============================================================

    /**
     * @notice Updates the treasury address.
     * @param _treasury The new treasury address.
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");

        address oldTreasury = treasury;
        treasury = _treasury;

        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Updates the protocol fee in basis points.
     * @param _bps The new fee in basis points (max 500 = 5%).
     */
    function setProtocolFee(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_FEE_BPS, "Fee exceeds max");

        uint256 oldBps = protocolFeeBps;
        protocolFeeBps = _bps;

        emit ProtocolFeeUpdated(oldBps, _bps);
    }

    // ============================================================
    // Owner: Emergency Controls
    // ============================================================

    /**
     * @notice Pauses the contract, disabling all swaps.
     */
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    /**
     * @notice Unpauses the contract, re-enabling swaps.
     */
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused();
    }

    // ============================================================
    // Owner: Rescue
    // ============================================================

    /**
     * @notice Rescues ERC20 tokens that are stuck in the contract.
     * @dev Only callable by the owner and protected against reentrancy.
     *      Useful for recovering tokens sent to the contract by mistake.
     *      The contract is designed to never hold user funds between swaps
     *      (all operations are atomic), so this should only be needed for
     *      tokens sent by mistake.
     * @param token  The token address to rescue.
     * @param amount The amount to rescue.
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner nonReentrant {
        token.safeTransfer(owner, amount);
        emit TokensRescued(token, amount);
    }

    // ============================================================
    // Owner: Ownership Transfer
    // ============================================================

    /**
     * @notice Transfers ownership of the contract to a new account.
     * @dev Can only be called by the current owner. The new owner cannot
     *      be the zero address.
     * @param newOwner The address of the new owner.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}
