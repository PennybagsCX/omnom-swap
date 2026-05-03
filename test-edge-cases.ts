/**
 * Edge Case Tests for Pool Scanner
 *
 * Run this in the browser console at http://localhost:3000
 * Tests the pool scanner's resilience to various edge cases.
 */

async function runEdgeCaseTests() {
  console.log('=== OMNOM POOL SCANNER EDGE CASE TESTS ===');
  console.log('Testing system resilience under various conditions...\n');

  // Import the modules (they should be available in the dev build)
  const { fetchAllReserves } = await import('./src/services/poolScanner/multicallReserves.ts');
  const { scanFactoriesForOmnomPools, clearPoolScannerCache } = await import('./src/services/poolScanner/index.ts');

  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string; detail?: string }[]
  };

  // Test 1: Empty address array
  console.log('TEST 1: Empty address array');
  try {
    const result = await fetchAllReserves([]);
    if (Array.isArray(result) && result.length === 0) {
      console.log('  ✓ PASS: Returns empty array');
      results.passed++;
      results.tests.push({ name: 'Empty array', passed: true });
    } else {
      console.log('  ✗ FAIL: Expected empty array, got', result);
      results.failed++;
      results.tests.push({ name: 'Empty array', passed: false, detail: `Expected [], got ${result}` });
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.log('  ✗ FAIL: Threw error:', error.message);
    results.failed++;
    results.tests.push({ name: 'Empty array', passed: false, error: error.message });
  }

  // Test 2: Single pool (WWDOGE/OMNOM primary)
  console.log('\nTEST 2: Single pool fetch');
  try {
    const result = await fetchAllReserves(['0x5bf60ea5cf2383f407f09cf38378176298238a6c']);
    if (result.length === 1) {
      const pool = result[0];
      console.log('  ✓ PASS: Returns 1 pool');
      console.log('    - hasLiquidity:', pool.hasLiquidity);
      console.log('    - category:', pool.category);
      console.log('    - reserve0:', pool.reserve0.toString());
      console.log('    - reserve1:', pool.reserve1.toString());
      results.passed++;
      results.tests.push({ name: 'Single pool', passed: true, detail: `Liquidity: ${pool.hasLiquidity}` });
    } else {
      console.log('  ✗ FAIL: Expected 1 pool, got', result.length);
      results.failed++;
      results.tests.push({ name: 'Single pool', passed: false, detail: `Expected 1, got ${result.length}` });
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.log('  ✗ FAIL: Threw error:', error.message);
    results.failed++;
    results.tests.push({ name: 'Single pool', passed: false, error: error.message });
  }

  // Test 3: Invalid/nonexistent contract address
  console.log('\nTEST 3: Invalid contract address');
  try {
    const result = await fetchAllReserves(['0x0000000000000000000000000000000000000001']);
    if (result.length === 1) {
      const pool = result[0];
      console.log('  ✓ PASS: Handles invalid address gracefully');
      console.log('    - category:', pool.category);
      console.log('    - hasLiquidity:', pool.hasLiquidity);
      results.passed++;
      results.tests.push({ name: 'Invalid address', passed: true, detail: `Category: ${pool.category}` });
    } else {
      console.log('  ✗ FAIL: Expected 1 result, got', result.length);
      results.failed++;
      results.tests.push({ name: 'Invalid address', passed: false, detail: `Expected 1, got ${result.length}` });
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.log('  ✗ FAIL: Threw error:', error.message);
    results.failed++;
    results.tests.push({ name: 'Invalid address', passed: false, error: error.message });
  }

  // Test 4: Full scan with all 173 pools
  console.log('\nTEST 4: Full pool scan');
  try {
    const pools = await scanFactoriesForOmnomPools();
    const activeCount = pools.filter(p => p.category === 'active').length;
    const inactiveCount = pools.filter(p => p.category === 'inactive').length;

    console.log('  ✓ PASS: Full scan completed');
    console.log('    - Total pools:', pools.length);
    console.log('    - Active:', activeCount);
    console.log('    - Abandoned:', inactiveCount);
    console.log('    - New pools (delta scan):', pools.filter(p => p.isNew).length);

    results.passed++;
    results.tests.push({
      name: 'Full scan',
      passed: true,
      detail: `${pools.length} total (${activeCount} active, ${inactiveCount} inactive)`
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.log('  ✗ FAIL: Threw error:', error.message);
    results.failed++;
    results.tests.push({ name: 'Full scan', passed: false, error: error.message });
  }

  // Test 5: Cache consistency
  console.log('\nTEST 5: Cache consistency');
  try {
    const scan1 = await scanFactoriesForOmnomPools();
    const scan2 = await scanFactoriesForOmnomPools();

    if (scan1.length === scan2.length) {
      console.log('  ✓ PASS: Cache returns consistent results');
      console.log('    - First scan:', scan1.length, 'pools');
      console.log('    - Second scan:', scan2.length, 'pools');
      results.passed++;
      results.tests.push({ name: 'Cache consistency', passed: true });
    } else {
      console.log('  ✗ FAIL: Inconsistent cache results');
      console.log('    - First:', scan1.length);
      console.log('    - Second:', scan2.length);
      results.failed++;
      results.tests.push({ name: 'Cache consistency', passed: false, detail: `${scan1.length} vs ${scan2.length}` });
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.log('  ✗ FAIL: Threw error:', error.message);
    results.failed++;
    results.tests.push({ name: 'Cache consistency', passed: false, error: error.message });
  }

  // Test 6: Cache invalidation
  console.log('\nTEST 6: Cache invalidation');
  try {
    clearPoolScannerCache();
    const pools = await scanFactoriesForOmnomPools();

    console.log('  ✓ PASS: Cache cleared and re-scanned');
    console.log('    - Pools after clear:', pools.length);
    results.passed++;
    results.tests.push({ name: 'Cache invalidation', passed: true });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.log('  ✗ FAIL: Threw error:', error.message);
    results.failed++;
    results.tests.push({ name: 'Cache invalidation', passed: false, error: error.message });
  }

  // Summary
  console.log('\n=== TEST SUMMARY ===');
  console.log(`Total: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);

  if (results.failed > 0) {
    console.log('\n=== FAILED TESTS ===');
    results.tests.filter(t => !t.passed).forEach(t => {
      console.log(`- ${t.name}: ${t.error || t.detail || 'Unknown error'}`);
    });
  }

  return results;
}

// Auto-run
runEdgeCaseTests().then(results => {
  console.log('\n=== ALL TESTS COMPLETE ===');
  console.log(results.failed === 0 ? '✓ ALL TESTS PASSED' : `✗ ${results.failed} TEST(S) FAILED`);
});
