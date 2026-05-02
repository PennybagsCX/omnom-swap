// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../contracts/OmnomSwapAggregator.sol";

/// @title DeployAggregator
/// @notice Foundry script to deploy the OmnomSwapAggregator contract to Dogechain.
///         Reads treasury address, protocol fee, and deployer private key from
///         environment variables, then deploys and registers known DEX routers.
///
/// @dev Usage:
///      source .env
///      forge script script/Deploy.s.sol:DeployAggregator --rpc-url dogechain --broadcast
contract DeployAggregator is Script {
    // ============================================================
    // Dogechain Addresses
    // ============================================================

    /// @notice WWDOGE (wrapped native DOGE) on Dogechain.
    address constant WWDOGE = 0xB7ddC6414bf4F5515b52D8BdD69973Ae205ff101;

    // ============================================================
    // Dogechain DEX Router Addresses (from src/lib/constants.ts)
    // ============================================================

    /// @notice DogeSwap V2 Router
    address constant DOGESWAP_V2_ROUTER = 0xa4EE06Ce40cb7e8c04E127c1F7D3dFB7F7039C81;

    /// @notice DogeShrk (Chewyswap) V2 Router
    address constant DOGESHRK_V2_ROUTER = 0x45AFCf57F7e3F3B9cA70335E5E85e4F77DcC5087;

    /// @notice WOJAK Finance Router
    address constant WOJAK_ROUTER = 0x9695906B4502D5397E6D21ff222e2C1a9e5654a9;

    /// @notice KibbleSwap Router
    address constant KIBBLESWAP_ROUTER = 0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f;

    /// @notice YodeSwap Router
    address constant YODESWAP_ROUTER = 0x72d85Ab47fBfc5E7E04a8bcfCa1601D8f8cE1a50;

    /// @notice FraxSwap Router
    address constant FRAXSWAP_ROUTER = 0x0f6A5c5F341791e897eB1FB8fE8B4e30EC4F9bDf;

    /// @notice ToolSwap Router
    address constant TOOLSWAP_ROUTER = 0x9BBF70e64fbe8Fc7afE8a5Ae90F2DB1165013F93;

    /// @notice DMUSK Router
    address constant DMUSK_ROUTER = 0xaa4B2479C4c10B917Faa98Cc7c2B24D99BFA2174;

    /// @notice IceCreamSwap V2 Router
    address constant ICECREAMSWAP_ROUTER = 0xBb5e1777A331ED93E07cF043363e48d320eb96c4;

    /// @notice PupSwap Router
    address constant PUPSWAP_ROUTER = 0x05F2a20AF837268Be340a3bF82BB87069cF4a8C3;

    /// @notice Bourbon Defi Router
    address constant BOURBONSWAP_ROUTER = 0x6B172911a5Af8C9Eb2B7759688204624CcC9b0Ee;

    /// @notice BreadFactory Router
    address constant BREADFACTORY_ROUTER = 0x270AB932F923813378cCac2853a2c391279ff0Ed;

    function run() external {
        // Read configuration from environment variables
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 feeBps = vm.envUint("PROTOCOL_FEE_BPS");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Validate inputs
        require(treasury != address(0), "Invalid treasury address");
        require(feeBps <= 500, "Fee exceeds maximum (500 bps = 5%)");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy the aggregator contract
        OmnomSwapAggregator aggregator = new OmnomSwapAggregator(treasury, feeBps, WWDOGE);

        // Register all known Dogechain DEX routers
        aggregator.addRouter(DOGESWAP_V2_ROUTER);
        aggregator.addRouter(DOGESHRK_V2_ROUTER);
        aggregator.addRouter(WOJAK_ROUTER);
        aggregator.addRouter(KIBBLESWAP_ROUTER);
        aggregator.addRouter(YODESWAP_ROUTER);
        aggregator.addRouter(FRAXSWAP_ROUTER);
        aggregator.addRouter(TOOLSWAP_ROUTER);
        aggregator.addRouter(DMUSK_ROUTER);
        aggregator.addRouter(ICECREAMSWAP_ROUTER);
        aggregator.addRouter(PUPSWAP_ROUTER);
        aggregator.addRouter(BOURBONSWAP_ROUTER);

        vm.stopBroadcast();

        // Log deployment details
        console.log("=== OmnomSwapAggregator Deployment ===");
        console.log("Aggregator:", address(aggregator));
        console.log("Owner:", aggregator.owner());
        console.log("Treasury:", aggregator.treasury());
        console.log("Protocol Fee (bps):", aggregator.protocolFeeBps());
        console.log("Registered Routers:", aggregator.getRouterCount());
        console.log("=======================================");
    }
}
