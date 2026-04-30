// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../contracts/OmnomSwapAggregator.sol";

/// @title SetupAggregator
/// @notice Post-deployment configuration script for OmnomSwapAggregator.
///         Can be used to update DEX routers, treasury, and protocol fee
///         on an already-deployed aggregator contract.
///
/// @dev Usage:
///      source .env
///      forge script script/Setup.s.sol:SetupAggregator --rpc-url dogechain --broadcast
///
///      To add/remove individual routers, set the relevant environment variables:
///        AGGREGATOR_ADDRESS  - address of the deployed aggregator
///        PRIVATE_KEY         - deployer/owner private key
///        NEW_TREASURY        - (optional) new treasury address
///        NEW_FEE_BPS         - (optional) new protocol fee in basis points
contract SetupAggregator is Script {
    // ============================================================
    // Dogechain DEX Router Addresses
    // ============================================================

    address constant DOGESWAP_V2_ROUTER  = 0xa4EE06Ce40cb7e8c04E127c1F7D3dFB7F7039C81;
    address constant DOGESHRK_V2_ROUTER  = 0x45AFCf57F7e3F3B9cA70335E5E85e4F77DcC5087;
    address constant WOJAK_ROUTER        = 0x9695906B4502D5397E6D21ff222e2C1a9e5654a9;
    address constant KIBBLESWAP_ROUTER   = 0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f;
    address constant YODESWAP_ROUTER     = 0x72d85Ab47fBfc5E7E04a8bcfCa1601D8f8cE1a50;
    address constant FRAXSWAP_ROUTER     = 0x0f6A5c5F341791e897eB1FB8fE8B4e30EC4F9bDf;
    address constant TOOLSWAP_ROUTER     = 0x9BBF70e64fbe8Fc7afE8a5Ae90F2DB1165013F93;
    address constant DMUSK_ROUTER       = 0xaa4B2479C4c10B917Faa98Cc7c2B24D99BFA2174;
    address constant ICECREAMSWAP_ROUTER  = 0xBb5e1777A331ED93E07cF043363e48d320eb96c4;
    address constant PUPSWAP_ROUTER       = 0x05F2a20AF837268Be340a3bF82BB87069cF4a8C3;
    address constant BOURBONSWAP_ROUTER   = 0x6B172911a5Af8C9Eb2B7759688204624CcC9b0Ee;

    /// @notice All known Dogechain DEX routers for registration.
    address[] internal KNOWN_ROUTERS = [
        DOGESWAP_V2_ROUTER,
        DOGESHRK_V2_ROUTER,
        WOJAK_ROUTER,
        KIBBLESWAP_ROUTER,
        YODESWAP_ROUTER,
        FRAXSWAP_ROUTER,
        TOOLSWAP_ROUTER,
        DMUSK_ROUTER,
        ICECREAMSWAP_ROUTER,
        PUPSWAP_ROUTER,
        BOURBONSWAP_ROUTER
    ];

    function run() external {
        address payable aggregatorAddr = payable(vm.envAddress("AGGREGATOR_ADDRESS"));
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY");

        OmnomSwapAggregator aggregator = OmnomSwapAggregator(aggregatorAddr);

        vm.startBroadcast(ownerPrivateKey);

        // -- 1. Register all known DEX routers ----------------------
        console.log("Registering DEX routers...");
        for (uint256 i = 0; i < KNOWN_ROUTERS.length; i++) {
            if (!aggregator.supportedRouters(KNOWN_ROUTERS[i])) {
                aggregator.addRouter(KNOWN_ROUTERS[i]);
                console.log("  Added router:", KNOWN_ROUTERS[i]);
            } else {
                console.log("  Already registered:", KNOWN_ROUTERS[i]);
            }
        }

        // -- 2. Update treasury (if specified) ----------------------
        try vm.envAddress("NEW_TREASURY") returns (address newTreasury) {
            if (newTreasury != address(0) && newTreasury != aggregator.treasury()) {
                aggregator.setTreasury(newTreasury);
                console.log("Treasury updated to:", newTreasury);
            }
        } catch {
            console.log("NEW_TREASURY not set - skipping treasury update");
        }

        // -- 3. Update protocol fee (if specified) ------------------
        try vm.envUint("NEW_FEE_BPS") returns (uint256 newFeeBps) {
            if (newFeeBps != aggregator.protocolFeeBps()) {
                aggregator.setProtocolFee(newFeeBps);
                console.log("Protocol fee updated to (bps):", newFeeBps);
            }
        } catch {
            console.log("NEW_FEE_BPS not set - skipping fee update");
        }

        vm.stopBroadcast();

        // -- 4. Verify configuration --------------------------------
        console.log("");
        console.log("=== Configuration Verification ===");
        console.log("Aggregator:", aggregatorAddr);
        console.log("Owner:", aggregator.owner());
        console.log("Treasury:", aggregator.treasury());
        console.log("Protocol Fee (bps):", aggregator.protocolFeeBps());
        console.log("Paused:", aggregator.paused());
        console.log("Registered Routers:", aggregator.getRouterCount());
        console.log("==================================");
    }
}
