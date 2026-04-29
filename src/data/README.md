# Dogechain Token List

**File:** `dogechain-tokens.json` (currently ~16,840 tokens)

This JSON file is the single source of truth for every token the swap UI knows about.
It is imported by `src/lib/constants.ts` and mapped into the `TOKENS` array.

---

## How to Update the Token List

### 1. Edit the JSON file

Open `src/data/dogechain-tokens.json`. Each entry must follow this format:

```json
{
  "address": "0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101",
  "symbol": "WWDOGE",
  "name": "Wrapped WDOGE",
  "decimals": 18
}
```

**Required fields:**

| Field      | Type   | Rules                                      |
|------------|--------|---------------------------------------------|
| `address`  | string | Must be `0x` + 40 hex chars (lowercase ok) |
| `symbol`   | string | Non-empty, trimmed                          |
| `name`     | string | Non-empty, trimmed                          |
| `decimals` | number | Integer between 0 and 18                    |

**Optional fields:**

| Field     | Type   | Notes                                        |
|-----------|--------|-----------------------------------------------|
| `logoURI` | string | Ignored by the app; icons are set in constants |

### 2. Validate

```bash
npm run validate-tokens
```

This checks for missing fields, bad addresses, duplicates, and ensures WWDOGE is present.
Validation also runs automatically before every `npm run build`.

### 3. Rebuild

```bash
npm run dev     # restart dev server to pick up JSON changes
npm run build   # production build (runs validation automatically)
```

---

## Important Rules

- **WWDOGE must be in the list.** The app uses it to identify native DOGE transactions.
  Address: `0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101`

- **No duplicate addresses.** The validation script catches this, but it will also
  cause confusing behavior in the UI (wrong token selected, wrong balance shown).

- **Token icons are managed separately.** Icons for popular tokens are mapped in
  `src/lib/constants.ts` under `TOKEN_ICONS`. The JSON `logoURI` field is not used.

- **The Multicall3 scanner checks ALL tokens.** When a user opens the token selector
  with a connected wallet, every token in this list gets a `balanceOf` check via
  Multicall3 (batched 100 at a time). Adding more tokens = more RPC calls but
  should still be fine up to ~50,000 tokens.

- **Search covers all tokens.** Users can find any token in this list by typing in
  the token selector search box. Only tokens with balance > 0 appear by default,
  but search always checks the full list.

---

## Adding Tokens in Bulk

To add many tokens at once (e.g. from an API or spreadsheet):

1. Prepare a JSON array with the correct format
2. Merge into `dogechain-tokens.json` (deduplicate by address first)
3. Run `npm run validate-tokens`
4. Restart dev server

## Removing Tokens

Just delete entries from the JSON array. No other code changes needed.
Token icons for removed tokens in `TOKEN_ICONS` will be harmless dead entries.
