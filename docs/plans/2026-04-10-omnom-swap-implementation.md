# OMNOM Swap Frontend MVP Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Build out the $OMNOM Swap DEX frontend into a fully verified, production-ready Vite + React SPA that flawlessly integrates the "Beast Mode" conceptual UI with functional Web3 hook scaffolding.

**Architecture:** We will construct an isolated `frontend` application within the workspace, keeping it disjointed from the `.agent` superpowers tooling. It will be componentized into Layout, Screens, and Reusable UI modules, verified using Vitest. Wagmi will provide mocked Web3 context.

**Tech Stack:** React, Vite, TypeScript, Tailwind CSS, Wagmi, Viem, Vitest.

---

### Task 1: Scaffold Vite Architecture & Configuration

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/App.tsx`
- Create: `frontend/tests/setup.ts`

**Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';

describe('Vite Setup', () => {
    it('should have a functioning environment', () => {
        expect(true).toBe(true);
    });
});
```

**Step 2: Run test to verify it fails**
Run: `cd frontend && npx vitest run`
Expected: FAIL, missing files and vitest dependency.

**Step 3: Write minimal implementation**
Run: `npm create vite@latest frontend -- --template react-ts`
Then, install Tailwind, Vitest, Wagmi, Viem, react-router-dom, and lucide-react. Also setup the global layout `App.tsx` containing the Web3 Provider scaffolding. Extract the Tailwind styles and fonts from the mockup to `index.css`.

**Step 4: Run test to verify it passes**
Run: `cd frontend && npx vitest run`
Expected: PASS

**Step 5: Commit**
```bash
git add frontend/
git commit -m "feat: scaffold vite architecture with tailwind, wagmi, and vitest"
```

---

### Task 2: Build the Core UI & Layout Components

**Files:**
- Create: `frontend/src/components/layout/Header.tsx`
- Create: `frontend/src/components/layout/Footer.tsx`
- Create: `frontend/src/components/ui/GlassPanel.tsx`
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/tests/components/layout.test.tsx`

**Step 1: Write the failing test**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Header from '../../src/components/layout/Header';

describe('Header', () => {
  it('renders the $OMNOM logo', () => {
    render(<Header />);
    expect(screen.getByText('$OMNOM')).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**
Run: `cd frontend && npx vitest run tests/components/layout.test.tsx`
Expected: FAIL "Module not found"

**Step 3: Write minimal implementation**
Extract the Header and Footer markup from the AI Studio Mockup into `Header.tsx` and `Footer.tsx`. Use Lucide icons for responsive navigation items. Construct reusable generic `Button` and `GlassPanel` wrappers mirroring the structural styling of the concept.

**Step 4: Run test to verify it passes**
Run: `cd frontend && npx vitest run tests/components/layout.test.tsx`
Expected: PASS

**Step 5: Commit**
```bash
git add frontend/src/components/ frontend/tests/components/
git commit -m "feat: implement header, footer, and core ui components"
```

---

### Task 3: Implement the Swap Screen Application Logic

**Files:**
- Create: `frontend/src/screens/SwapScreen.tsx`
- Create: `frontend/src/components/swap/SwapCard.tsx`
- Create: `frontend/src/components/modals/TokenSelectModal.tsx`
- Create: `frontend/tests/screens/SwapScreen.test.tsx`

**Step 1: Write the failing test**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SwapScreen from '../../src/screens/SwapScreen';

describe('SwapScreen', () => {
  it('toggles token select modal when asset is clicked', () => {
    render(<SwapScreen />);
    const selectTokenBtn = screen.getByText('DOGE'); 
    fireEvent.click(selectTokenBtn);
    expect(screen.getByText('Select Token')).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**
Run: `cd frontend && npx vitest run tests/screens/SwapScreen.test.tsx`
Expected: FAIL 

**Step 3: Write minimal implementation**
Port over `SwapScreen`, `SwapCard`, and `TokenSelectModal` from the AI Studio mock. This should isolate all swap-specific logic elements—amount entering, rate calculation mock hook, auto-slippage calculation—into independent functions and sub-components. Ensure the tokens are selected dynamically.

**Step 4: Run test to verify it passes**
Run: `cd frontend && npx vitest run tests/screens/SwapScreen.test.tsx`
Expected: PASS

**Step 5: Commit**
```bash
git add frontend/src/screens/ frontend/src/components/swap/ frontend/tests/screens/
git commit -m "feat: build swap screen and token selection modal"
```

---

### Task 4: Implement Pools and Stats Screens

**Files:**
- Create: `frontend/src/screens/PoolsScreen.tsx`
- Create: `frontend/src/screens/StatsScreen.tsx`
- Create: `frontend/src/components/pools/LiquidityModal.tsx`
- Create: `frontend/tests/screens/PoolsScreen.test.tsx`

**Step 1: Write the failing test**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PoolsScreen from '../../src/screens/PoolsScreen';

describe('PoolsScreen', () => {
  it('renders the liquidity grid section', () => {
    render(<PoolsScreen />);
    expect(screen.getByText(/THE FEEDING GROUNDS/i)).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**
Run: `cd frontend && npx vitest run tests/screens/PoolsScreen.test.tsx`
Expected: FAIL

**Step 3: Write minimal implementation**
Break down the complex Pools Bento grid and the Stats screen from `App.tsx` into fully modular sub-components. Introduce routing across the 3 main tabs (`Swap`, `Pools`, `Stats`) via React Router.

**Step 4: Run test to verify it passes**
Run: `cd frontend && npx vitest run tests/screens/PoolsScreen.test.tsx`
Expected: PASS

**Step 5: Commit**
```bash
git add frontend/
git commit -m "feat: complete pools and stats views with routing"
```
