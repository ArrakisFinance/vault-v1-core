/* eslint-disable @typescript-eslint/naming-convention */
interface Addresses {
  Gelato: string;
  WETH: string;
  DAI: string;
  USDC: string;
  UniswapV3Factory: string;
  Swapper: string;
  GelatoDevMultiSig: string;
  GUniFactory: string;
  GUniImplementation: string;
}

export const getAddresses = (network: string): Addresses => {
  switch (network) {
    case "mainnet":
      return {
        Gelato: "0x3CACa7b48D0573D793d3b0279b5F0029180E83b6",
        Swapper: "",
        GelatoDevMultiSig: "",
        WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        GUniFactory: "0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9",
        GUniImplementation: "",
      };
    case "optimism":
      return {
        Gelato: "0x01051113D81D7d6DA508462F2ad6d7fD96cF42Ef",
        Swapper: "",
        GelatoDevMultiSig: "",
        WETH: "",
        DAI: "",
        USDC: "",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        GUniFactory: "0x2845c6929d621e32B7596520C8a1E5a37e616F09",
        GUniImplementation: "0x8582Bf142BE76fEF830D23f590a2587f2aD7C216",
      };
    case "polygon":
      return {
        Gelato: "0x7598e84B2E114AB62CAB288CE5f7d5f6bad35BbA",
        Swapper: "0x2E185412E2aF7DC9Ed28359Ea3193EBAd7E929C6",
        GelatoDevMultiSig: "0x02864B9A53fd250900Ba74De507a56503C3DC90b",
        WETH: "",
        DAI: "",
        USDC: "",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        GUniFactory: "0x37265A834e95D11c36527451c7844eF346dC342a",
        GUniImplementation: "0xd2Bb190dD88e7Af5DF176064Ec42f6dfA8672F40",
      };
    case "goerli":
      return {
        Gelato: "0x683913B3A32ada4F8100458A3E1675425BdAa7DF",
        Swapper: "",
        GelatoDevMultiSig: "0x4B5BaD436CcA8df3bD39A095b84991fAc9A226F1",
        WETH: "",
        DAI: "",
        USDC: "",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        GUniFactory: "",
        GUniImplementation: "",
      };
    default:
      throw new Error(`No addresses for Network: ${network}`);
  }
};
