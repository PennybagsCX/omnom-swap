import { PawPrint, Bitcoin, DollarSign } from 'lucide-react';

export const NETWORK_INFO = {
  chainId: 2000,
  rpcUrl: 'https://rpc.dogechain.dog',
  blockExplorer: 'https://explorer.dogechain.dog',
}

export const CONTRACTS = {
  WWDOGE: '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101',
  ALGEBRA_V3_ROUTER: '0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea',
  OMNOM: '0x0000000000000000000000000000000000000000' // Placeholder for OMNOM token address
}

export const TOKENS = [
  { symbol: 'WWDOGE', name: 'Wrapped Doge', balance: 0, address: CONTRACTS.WWDOGE, icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD33Ssm2WE6hLYmOKHoQGa8bgIWiahDkvTIHWLsSoH4nr303LaV7pMAJoqpEy9xlEZHDBwLAuCEyodi7A31ysbQwltZJe2zu4TawtiwvEF13jQ_U5bDEBghLERSdxgO3PuV2ZXoiPtwgkZti4BK0WsZUQ9R-4o6H1HIdz1Nmnymlq1kLWUovyO8go9zoontFfDgSnPPUdprcHOWXncXjSywG7XsDQxJwB6c1gXbyeoXcY7Ibk1h6xH3jzo72x80PNC4xP8HSZ7KhKFp', isImage: true },
  { symbol: 'OMNOM', name: 'Omnom Token', balance: 0, address: CONTRACTS.OMNOM, icon: PawPrint, isImage: false },
  { symbol: 'WETH', name: 'Wrapped Ether', balance: 0, address: '0x0000000000000000000000000000000000000000', icon: Bitcoin, isImage: false },
  { symbol: 'USDT', name: 'Tether USD', balance: 0, address: '0x0000000000000000000000000000000000000000', icon: DollarSign, isImage: false }
];
