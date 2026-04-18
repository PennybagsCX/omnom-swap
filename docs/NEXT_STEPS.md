# OmnomSwap — Next Steps & Future Improvements

## Immediate Actions
- [ ] Rotate deployer private key (generate new wallet, update .env)
- [ ] Add pre-commit hook with gitleaks/trufflehog to prevent secret leaks
- [ ] Consider using Foundry keystore signing instead of plaintext PRIVATE_KEY

## Dependency Upgrades (Planned)
These major version bumps require dedicated testing:

| Package | Current | Target | Risk |
|---------|---------|--------|------|
| vite | 6.4.2 | 8.0.8 | High — build config changes |
| typescript | 5.8.3 | 6.0.3 | High — potential type system changes |
| @types/node | 22.x | 25.x | Medium |
| @vitejs/plugin-react | 5.2.0 | 6.0.1 | Medium |
| lucide-react | 0.546.0 | 1.8.0 | Medium — API may change |

### Safe to Update Now (Patch/Minor)
- viem: 2.47.12 → 2.48.1
- wagmi: 3.6.1 → 3.6.3
- autoprefixer: 10.4.27 → 10.5.0

## Feature Enhancements
- [ ] Focus trapping in modals (react-focus-lock or similar)
- [ ] Focus-visible ring styles on all interactive elements
- [ ] Granular ErrorBoundaries around major sections
- [ ] Connection timeout in WalletModal (60s auto-cancel)
- [ ] AbortController for pool fetching RPC requests
- [ ] Pool data caching layer to reduce RPC load
- [ ] Structured data (JSON-LD WebApplication schema)
- [ ] Apple touch icon and multi-size favicons
- [ ] OG image (1200x630px branded image for social sharing)
- [ ] Custom domain setup (omnomswap.com)

## Testing Improvements
- [ ] End-to-end tests with Playwright
- [ ] Visual regression testing
- [ ] Contract fuzz testing (Echidna/Medusa)
- [ ] Gas optimization profiling
- [ ] Load testing for pathfinder service

## Monitoring & Analytics
- [ ] Error tracking (Sentry or similar)
- [ ] Analytics (Plausible/Umami for privacy-friendly)
- [ ] Uptime monitoring
- [ ] Transaction success rate monitoring

## Smart Contract
- Contract: `0x88F81031b258A0Fb789AC8d3A8071533BFADeC14`
- Treasury: `0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88`
- WWDOGE: `0xB7ddC6414bf4F5515b52D8BdD69973Ae205ff101`
- Fee: 25 bps
- Tests: 149/149 passing (6 suites)
