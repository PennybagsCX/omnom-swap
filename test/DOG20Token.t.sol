// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/OmnomSwapAggregator.sol";
import "../contracts/mocks/MockERC20.sol";
import "../contracts/mocks/MockDOG20Token.sol";
import "../contracts/mocks/MockUniswapV2Router.sol";
import "../contracts/mocks/MockWWDOGE.sol";

/// @title DOG20TokenTest
/// @notice Tests for DOG20 standard tokens interacting with the aggregator.
contract DOG20TokenTest is Test {
    OmnomSwapAggregator public aggregator;
    MockERC20 public tokenA;
    MockDOG20Token public dogToken;
    MockDOG20Token public dogTokenZeroFee;
    MockUniswapV2Router public router;
    MockWWDOGE public wwdoge;

    address public owner = address(0x100);
    address public treasury = address(0x200);
    address public user = address(0x300);
    address public feeRecipient = address(0x600);

    uint256 constant EXCHANGE_RATE = 2e18;
    uint256 constant INITIAL_BALANCE = 1_000_000e18;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 10;

    function setUp() public {
        vm.startPrank(owner);

        wwdoge = new MockWWDOGE();
        aggregator = new OmnomSwapAggregator(treasury, FEE_BPS, address(wwdoge));

        tokenA = new MockERC20("Token A", "TKA", 18);
        dogToken = new MockDOG20Token("DOG20", "DOG", 18, 0, 200, 0, feeRecipient); // 2% transfer fee
        dogTokenZeroFee = new MockDOG20Token("DOG20 Zero", "DOGZ", 18, 0, 0, 0, feeRecipient); // 0 fees

        router = new MockUniswapV2Router(address(0), EXCHANGE_RATE);
        aggregator.addRouter(address(router));

        vm.stopPrank();

        // Fund user
        tokenA.mint(user, INITIAL_BALANCE);
        dogToken.mint(user, INITIAL_BALANCE);
        dogTokenZeroFee.mint(user, INITIAL_BALANCE);

        // Fund router with output tokens
        tokenA.mint(address(router), INITIAL_BALANCE * 10);
        dogToken.mint(address(router), INITIAL_BALANCE * 10);
        dogTokenZeroFee.mint(address(router), INITIAL_BALANCE * 10);
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

    // --- Tests ---------------------------------------------------------

    /// @notice Standard swap with DOG20 token (no fees) succeeds.
    function test_dog20_standardSwap_succeeds() public {
        vm.startPrank(user);
        dogTokenZeroFee.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(dogTokenZeroFee),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        vm.stopPrank();

        assertGt(tokenA.balanceOf(user), 0, "User should have output tokens");
    }

    /// @notice DOG20 with transfer fee — balance-diff handles the fee deduction.
    function test_dog20_withTransferFee_succeeds() public {
        // dogToken has 2% transfer fee
        vm.startPrank(user);
        dogToken.approve(address(aggregator), SWAP_AMOUNT);

        // Set minAmountOut to 0 to allow for fee deduction
        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(dogToken),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        vm.stopPrank();

        // User should have received tokenA
        assertGt(tokenA.balanceOf(user), 0, "User should have output tokens");

        // Verify the fee was collected by feeRecipient
        // The aggregator receives SWAP_AMOUNT - 2% from user via transferFrom
        // Then sends to router via forceTransferFrom (also deducts 2%)
        assertGt(dogToken.balanceOf(feeRecipient), 0, "Fee recipient should have fees");
    }

    /// @notice Minting with mint fee succeeds and deducts fee.
    function test_dog20_withMintFee_mintingSucceeds() public {
        MockDOG20Token dogWithMintFee = new MockDOG20Token(
            "DOG Mint Fee", "DGMF", 18,
            100, // 1% mint fee
            0,   // no transfer fee
            0,   // no max supply
            feeRecipient
        );

        uint256 mintAmount = 1000e18;
        uint256 expectedFee = (mintAmount * 100) / 10000; // 1% = 10e18
        uint256 expectedNet = mintAmount - expectedFee; // 990e18

        dogWithMintFee.mint(user, mintAmount);

        assertEq(dogWithMintFee.balanceOf(user), expectedNet, "User should get net amount");
        assertEq(dogWithMintFee.balanceOf(feeRecipient), expectedFee, "Fee recipient should get fee");
        assertEq(dogWithMintFee.totalSupply(), mintAmount, "Total supply should be full amount");
    }

    /// @notice Minting past max supply reverts.
    function test_dog20_maxSupply_mintReverts() public {
        uint256 maxSupply = 10_000e18;
        MockDOG20Token dogCapped = new MockDOG20Token(
            "DOG Capped", "DGCP", 18,
            0,          // no mint fee
            0,          // no transfer fee
            maxSupply,
            feeRecipient
        );

        // Mint up to max
        dogCapped.mint(user, maxSupply);
        assertEq(dogCapped.totalSupply(), maxSupply);

        // Minting 1 more should revert
        vm.expectRevert("Max supply exceeded");
        dogCapped.mint(user, 1);
    }

    /// @notice DOG20 in multi-hop route succeeds.
    function test_dog20_multiHop_succeeds() public {
        // Set up a second router for multi-hop
        MockUniswapV2Router router2 = new MockUniswapV2Router(address(0), 1e18); // 1:1 rate
        vm.prank(owner);
        aggregator.addRouter(address(router2));

        MockERC20 tokenC = new MockERC20("Token C", "TKC", 18);
        tokenC.mint(address(router2), INITIAL_BALANCE * 10);

        // Fund router with dogToken for step 1 output
        dogToken.mint(address(router), INITIAL_BALANCE * 10);

        // Calculate step 2 amountIn accounting for DOG20 2% transfer fee:
        // swapAmount = SWAP_AMOUNT - protocolFee = 999e18
        // router1 output = 999e18 * 2 = 1998e18
        // aggregator receives = 1998e18 - 2% fee = 1998e18 - 39.96e18 = 1958.04e18
        uint256 protocolFee = (SWAP_AMOUNT * FEE_BPS) / 10000;
        uint256 swapAmt = SWAP_AMOUNT - protocolFee;
        uint256 router1Output = (swapAmt * EXCHANGE_RATE) / 1e18;
        uint256 step2AmountIn = router1Output - (router1Output * 200) / 10000; // minus 2% fee

        // Step 1: tokenA → dogToken via router (2:1 rate)
        // Step 2: dogToken → tokenC via router2 (1:1 rate)
        address[] memory path1 = new address[](2);
        path1[0] = address(tokenA);
        path1[1] = address(dogToken);

        address[] memory path2 = new address[](2);
        path2[0] = address(dogToken);
        path2[1] = address(tokenC);

        OmnomSwapAggregator.SwapStep[] memory steps = new OmnomSwapAggregator.SwapStep[](2);
        steps[0] = OmnomSwapAggregator.SwapStep({
            router: address(router),
            path: path1,
            amountIn: SWAP_AMOUNT,
            minAmountOut: 0
        });
        steps[1] = OmnomSwapAggregator.SwapStep({
            router: address(router2),
            path: path2,
            amountIn: step2AmountIn,
            minAmountOut: 0
        });

        vm.startPrank(user);
        tokenA.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = OmnomSwapAggregator.SwapRequest({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: SWAP_AMOUNT,
            minTotalAmountOut: 0,
            steps: steps,
            deadline: _defaultDeadline(),
            recipient: user
        });

        uint256 userBalBefore = tokenC.balanceOf(user);
        aggregator.executeSwap(req);
        vm.stopPrank();

        assertGt(tokenC.balanceOf(user), userBalBefore, "User should receive tokenC");
    }

    /// @notice isDOG20() returns true.
    function test_dog20_isDOG20_returnsTrue() public {
        assertTrue(dogToken.isDOG20(), "isDOG20 should return true");
        assertTrue(dogTokenZeroFee.isDOG20(), "isDOG20 should return true for zero-fee token");
    }

    /// @notice DOG20 with 0 fees behaves like a standard ERC20.
    function test_dog20_zeroFees_sameAsStandard() public {
        uint256 userBalBefore = tokenA.balanceOf(user);

        vm.startPrank(user);
        dogTokenZeroFee.approve(address(aggregator), SWAP_AMOUNT);

        OmnomSwapAggregator.SwapRequest memory req = _buildSingleSwap(
            address(dogTokenZeroFee),
            address(tokenA),
            SWAP_AMOUNT,
            SWAP_AMOUNT,
            0,
            address(router),
            user,
            _defaultDeadline()
        );

        aggregator.executeSwap(req);
        vm.stopPrank();

        // With 0 fees, should behave exactly like standard ERC20
        uint256 expectedFee = (SWAP_AMOUNT * FEE_BPS) / 10000;
        uint256 swapAmount = SWAP_AMOUNT - expectedFee;
        uint256 expectedOutput = (swapAmount * EXCHANGE_RATE) / 1e18;

        assertEq(tokenA.balanceOf(user) - userBalBefore, expectedOutput, "Output should match standard ERC20");
        assertEq(dogTokenZeroFee.balanceOf(feeRecipient), 0, "No fees should be collected");
    }
}
