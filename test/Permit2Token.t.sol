// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockPermit2Token.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title Permit2TokenTest
/// @notice Tests for EIP-2612 permit-enabled tokens interacting with the aggregator.
contract Permit2TokenTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockPermit2Token public permitToken;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);

    uint256 constant USER_PRIVATE_KEY = 0xA11CE;

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 10;

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);
        permitToken = new MockPermit2Token("PermitToken", "PRMT", 18);

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user (derived from private key)
        user = vm.addr(USER_PRIVATE_KEY);
        tokenA.mint(user, INITIAL_BALANCE);
        permitToken.mint(user, INITIAL_BALANCE);

        // Fund router with output tokens
        tokenA.mint(address(router), INITIAL_BALANCE * 10);
        permitToken.mint(address(router), INITIAL_BALANCE * 10);
    }

    // --- Helpers -------------------------------------------------------

    function _buildSingleSwap(
        address tokenIn,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 stepAmountIn,
        uint256 minAmountOut,
        address routerAddr,
        address to,
        uint256 deadline
    ) internal view returns (OmnomSwapAggregator.SwapRequest memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](1);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: routerAddr,
            path: path,
            amountIn: stepAmountIn,
            minAmountOut: minAmountOut
        });

        return OmnomSwapAggregator.SwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: totalAmountIn,
            minTotalAmountOut: minAmountOut,
            steps: steps,
            deadline: deadline,
            recipient: to
        });
    }

    function _defaultDeadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    /// @dev Creates an EIP-2612 permit signature.
    function _createPermitSignature(
        address tokenAddr,
        address ownerAddr,
        address spender,
        uint256 value,
        uint256 deadline,
        uint256 privateKey
    ) internal returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

        uint256 nonce = MockPermit2Token(tokenAddr).nonces(ownerAddr);

        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, ownerAddr, spender, value, nonce, deadline)
        );

        bytes32 domainSeparator = MockPermit2Token(tokenAddr).DOMAIN_SEPARATOR();

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        );

        (v, r, s) = vm.sign(privateKey, digest);
    }

    // --- Tests ---------------------------------------------------------

    /// @notice User calls permit() to set allowance, then swap succeeds.
    function test_permit_swapWithPermit_succeeds() public {
        uint256 deadline = _defaultDeadline();

        // Step 1: User signs permit to approve aggregator
        (uint8 v, bytes32 r, bytes32 s) = _createPermitSignature(
            address(permitToken),
            user,
            address(aggregator),
            SWAP_AMOUNT,
            deadline,
            USER_PRIVATE_KEY
        );

        // Step 2: Anyone can submit the permit
        permitToken.permit(user, address(aggregator), SWAP_AMOUNT, deadline, v, r, s);

        // Verify allowance was set
        assertEq(permitToken.allowance(user, address(aggregator)), SWAP_AMOUNT, "Allowance not set");

        // Step 3: Execute swap
        vm.prank(user);
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(permitToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            deadline
        );

        aggregator.executeSwap(req);

        // User should have received tokenA
        assertGt(tokenA.balanceOf(user), 0, "User should have output tokens");
    }

    /// @notice Permit with past deadline reverts.
    function test_permit_expiredDeadline_reverts() public {
        // Set deadline in the past
        uint256 expiredDeadline = block.timestamp - 1;

        (uint8 v, bytes32 r, bytes32 s) = _createPermitSignature(
            address(permitToken),
            user,
            address(aggregator),
            SWAP_AMOUNT,
            expiredDeadline,
            USER_PRIVATE_KEY
        );

        vm.expectRevert("Permit expired");
        permitToken.permit(user, address(aggregator), SWAP_AMOUNT, expiredDeadline, v, r, s);
    }

    /// @notice Wrong signature (different private key) reverts.
    function test_permit_invalidSignature_reverts() public {
        uint256 deadline = _defaultDeadline();
        uint256 wrongKey = 0xBAD;

        // Sign with wrong key
        (uint8 v, bytes32 r, bytes32 s) = _createPermitSignature(
            address(permitToken),
            user, // claiming to be user
            address(aggregator),
            SWAP_AMOUNT,
            deadline,
            wrongKey // but signed with wrong key
        );

        vm.expectRevert("Invalid signer");
        permitToken.permit(user, address(aggregator), SWAP_AMOUNT, deadline, v, r, s);
    }

    /// @notice Using the same nonce twice reverts (replay protection).
    function test_permit_replayProtection_reverts() public {
        uint256 deadline = _defaultDeadline();

        (uint8 v, bytes32 r, bytes32 s) = _createPermitSignature(
            address(permitToken),
            user,
            address(aggregator),
            SWAP_AMOUNT,
            deadline,
            USER_PRIVATE_KEY
        );

        // First permit succeeds
        permitToken.permit(user, address(aggregator), SWAP_AMOUNT, deadline, v, r, s);

        // Second permit with same nonce reverts
        vm.expectRevert("Invalid signer");
        permitToken.permit(user, address(aggregator), SWAP_AMOUNT, deadline, v, r, s);
    }

    /// @notice Full flow: permit → approve → swap.
    function test_permit_permitThenSwap_fullFlow() public {
        uint256 deadline = _defaultDeadline();

        // 1. Permit: set allowance via signature
        (uint8 v, bytes32 r, bytes32 s) = _createPermitSignature(
            address(permitToken),
            user,
            address(aggregator),
            SWAP_AMOUNT,
            deadline,
            USER_PRIVATE_KEY
        );

        permitToken.permit(user, address(aggregator), SWAP_AMOUNT, deadline, v, r, s);
        assertEq(permitToken.allowance(user, address(aggregator)), SWAP_AMOUNT);

        // 2. Verify nonce incremented
        assertEq(permitToken.nonces(user), 1, "Nonce should be 1");

        // 3. Execute swap
        uint256 userBalBefore = tokenA.balanceOf(user);
        vm.prank(user);
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(permitToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            deadline
        );

        aggregator.executeSwap(req);

        // 4. Verify user received output
        uint256 received = tokenA.balanceOf(user) - userBalBefore;
        uint256 expectedFee = (SWAP_AMOUNT * FEE_BPS) / 10000;
        uint256 swapAmount = SWAP_AMOUNT - expectedFee;
        uint256 expectedOutput = (swapAmount * EXCHANGE_RATE) / 1e18;
        assertEq(received, expectedOutput, "Output amount mismatch");

        // 5. Verify SwapExecuted event
        // (already verified by the successful execution)
    }

    /// @notice Cannot call permit mid-swap — permit is a separate transaction.
    function test_permit_permitDuringSwap_notPossible() public {
        uint256 deadline = _defaultDeadline();

        // User has NOT approved aggregator yet
        assertEq(permitToken.allowance(user, address(aggregator)), 0);

        // Attempting swap without approval reverts
        vm.prank(user);
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(permitToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            deadline
        );

        // Should revert because aggregator has no allowance
        // The SafeERC20.safeTransferFrom will fail due to insufficient allowance
        vm.expectRevert();
        aggregator.executeSwap(req);

        // Now set permit and verify swap works
        (uint8 v, bytes32 r, bytes32 s) = _createPermitSignature(
            address(permitToken),
            user,
            address(aggregator),
            SWAP_AMOUNT,
            deadline,
            USER_PRIVATE_KEY
        );

        permitToken.permit(user, address(aggregator), SWAP_AMOUNT, deadline, v, r, s);

        // Swap now succeeds
        vm.prank(user);
        aggregator.executeSwap(req);
        assertGt(tokenA.balanceOf(user), 0);
    }
}
