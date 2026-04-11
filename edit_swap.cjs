const fs = require('fs');

let code = fs.readFileSync('src/components/SwapScreen.tsx', 'utf8');

// 1. imports
code = code.replace(
  "import { useAccount, useBalance } from 'wagmi';",
  "import { useAccount, useBalance, useReadContract, useWriteContract } from 'wagmi';\nimport { erc20Abi, parseAbi, parseUnits } from 'viem';"
);

// 2. logic hooks
const hooksContent = `
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: sellToken.address as \`0x\${string}\`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.ALGEBRA_V3_ROUTER as \`0x\${string}\`] : undefined,
    query: { enabled: isConnected && sellToken.symbol !== 'DOGE' && sellToken.address !== CONTRACTS.WWDOGE }
  });

  const { writeContractAsync: writeContract } = useWriteContract();
`;

code = code.replace(
  "const { address, isConnected } = useAccount();",
  "const { address, isConnected } = useAccount();\n" + hooksContent
);

// 3. state
code = code.replace(
  "const [isSwapping, setIsSwapping] = useState(false);",
  "const [isSwapping, setIsSwapping] = useState(false);\n  const [isApproving, setIsApproving] = useState(false);"
);

// 4. button logic
const buttonLogicOld = `
  let buttonText = "CHOMP THE SWAP";
  let isDisabled = false;

  if (!isConnected) {
    buttonText = "CONNECT WALLET";
    isDisabled = true;
  } else if (!sellAmount || parsedSell <= 0) {
    buttonText = "ENTER AMOUNT";
    isDisabled = true;
  } else if (parsedSell > displaySellBalance) {
    buttonText = "INSUFFICIENT BALANCE";
    isDisabled = true;
  }
`;

const buttonLogicNew = `
  let buttonText = "CHOMP THE SWAP";
  let isDisabled = false;
  let needsApproval = false;
  
  const parsedSellWei = parsedSell > 0 ? parseUnits(parsedSell.toString(), 18) : 0n;

  if (!isConnected) {
    buttonText = "CONNECT WALLET";
    isDisabled = true;
  } else if (!sellAmount || parsedSell <= 0) {
    buttonText = "ENTER AMOUNT";
    isDisabled = true;
  } else if (parsedSell > displaySellBalance) {
    buttonText = "INSUFFICIENT BALANCE";
    isDisabled = true;
  } else if (sellToken.symbol !== 'DOGE' && sellToken.address !== CONTRACTS.WWDOGE && allowance !== undefined && allowance < parsedSellWei) {
    needsApproval = true;
    buttonText = isApproving ? "APPROVING..." : "APPROVE ROUTER";
    isDisabled = isApproving;
  }
`;

code = code.replace(buttonLogicOld.trim(), buttonLogicNew.trim());

// 5. handle execute
const handleExecute = `
  const handleExecuteAction = async () => {
    if (needsApproval) {
      setIsApproving(true);
      try {
        await writeContract({
          address: sellToken.address as \`0x\${string}\`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [CONTRACTS.ALGEBRA_V3_ROUTER as \`0x\${string}\`, parsedSellWei],
        });
        setTimeout(() => refetchAllowance(), 2000);
      } catch (error) {
        console.error("Approval failed", error);
      } finally {
        setIsApproving(false);
      }
    } else {
      setShowConfirmModal(true);
    }
  };
`;

code = code.replace(
  "const handleSwapTokens = () => {",
  handleExecute.trim() + "\n\n  const handleSwapTokens = () => {"
);

// 6. swap execution logic in modal
const confirmOld = `onClick={() => {
                      setIsSwapping(true);
                      setTimeout(() => {
                        setIsSwapping(false);
                        setShowConfirmModal(false);
                        setSwapHistory([{
                          id: Date.now(),
                          sellAmount: parsedSell,
                          sellSymbol: sellToken.symbol,
                          buyAmount: parseFloat(buyAmount),
                          buySymbol: buyToken.symbol,
                          time: 'Just now'
                        }, ...swapHistory]);
                        setSellAmount('');
                      }, 2000);
                    }}`;

const confirmNew = `onClick={async () => {
                      setIsSwapping(true);
                      try {
                        const routerAbi = parseAbi(['function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) external payable returns (uint256 amountOut)']);
                        
                        const isSellingNative = sellToken.symbol === 'DOGE' || sellToken.address === CONTRACTS.WWDOGE;
                        const wDoge = CONTRACTS.WWDOGE as \`0x\${string}\`;
                        
                        await writeContract({
                          address: CONTRACTS.ALGEBRA_V3_ROUTER as \`0x\${string}\`,
                          abi: routerAbi,
                          functionName: 'exactInputSingle',
                          args: [{
                            tokenIn: isSellingNative ? wDoge : sellToken.address as \`0x\${string}\`,
                            tokenOut: buyToken.symbol === 'DOGE' ? wDoge : buyToken.address as \`0x\${string}\`,
                            recipient: address!,
                            deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
                            amountIn: parsedSellWei,
                            amountOutMinimum: parseUnits(minReceived.toString(), 18),
                            limitSqrtPrice: 0n,
                          }],
                          value: isSellingNative ? parsedSellWei : 0n,
                        });
                        
                        setShowConfirmModal(false);
                        setSwapHistory([{
                          id: Date.now(),
                          sellAmount: parsedSell,
                          sellSymbol: sellToken.symbol,
                          buyAmount: parseFloat(buyAmount),
                          buySymbol: buyToken.symbol,
                          time: 'Just now'
                        }, ...swapHistory]);
                        setSellAmount('');
                      } catch (error) {
                        console.error('Swap failed:', error);
                      } finally {
                        setIsSwapping(false);
                      }
                    }}`;

code = code.replace(confirmOld, confirmNew);

// Finally map button click to handleExecuteAction
code = code.replace("onClick={() => setShowConfirmModal(true)}", "onClick={handleExecuteAction}");

fs.writeFileSync('src/components/SwapScreen.tsx', code);
