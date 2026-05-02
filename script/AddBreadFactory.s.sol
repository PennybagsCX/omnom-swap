// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../contracts/OmnomSwapAggregator.sol";

/// @title AddBreadFactoryRouter
/// @notice Registers the BreadFactory router on the deployed OmnomSwapAggregator.
///         BreadFactory (0x270AB932F923813378cCac2853a2c391279ff0Ed) was missing
///         from the initial deployment.
///
/// @dev Usage:
///      source .env
///      forge script script/AddBreadFactory.s.sol:AddBreadFactoryRouter --rpc-url dogechain --broadcast
contract AddBreadFactoryRouter is Script {
    address payable constant AGGREGATOR = payable(0xB6eaE524325Cc31Bb0f3d9AF7bB63b4dc991B58A);
    address constant BREADFACTORY_ROUTER = 0x270AB932F923813378cCac2853a2c391279ff0Ed;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        OmnomSwapAggregator aggregator = OmnomSwapAggregator(AGGREGATOR);

        // Verify not already registered
        if (aggregator.supportedRouters(BREADFACTORY_ROUTER)) {
            console.log("BreadFactory router already registered - skipping");
        } else {
            aggregator.addRouter(BREADFACTORY_ROUTER);
            console.log("BreadFactory router registered successfully");
        }

        console.log("Total registered routers:", aggregator.getRouterCount());

        vm.stopBroadcast();
    }
}
