import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  IERC20,
  IUniswapV3Pool,
  SwapTest,
  ArrakisVaultV1,
  EIP173Proxy,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

describe("ArrakisVaultV1", function () {
  this.timeout(0);

  let uniswapPool: IUniswapV3Pool;

  let token0: IERC20;
  let token1: IERC20;
  let admin: SignerWithAddress;
  let signer: SignerWithAddress;
  let swapTest: SwapTest;
  let vault: ArrakisVaultV1;
  let uniswapPoolAddress: string;

  before(async function () {
    [signer] = await ethers.getSigners();

    const swapTestFactory = await ethers.getContractFactory("SwapTest");
    swapTest = (await swapTestFactory.deploy()) as SwapTest;

  });

  describe("Before liquidity deposited", function () {
    it("tries to rebalance", async function () {

    });
  });
});
