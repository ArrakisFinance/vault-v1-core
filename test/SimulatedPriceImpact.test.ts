import { ethers, network } from "hardhat";
import {
  IERC20,
  IUniswapV3Pool,
  SwapTest,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

const SWAPPER = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
const POOL = "0x45dDa9cb7c25131DF268515131f647d726f50608";
describe("Simulated Price Impact", function () {
  this.timeout(0);

  let uniswapPool: IUniswapV3Pool;
  let token0: IERC20;
  let token1: IERC20;
  let signer: SignerWithAddress;
  let swapper: any;
  let swapTest: SwapTest;

  before(async function () {
    [signer] = await ethers.getSigners();

    const swapTestFactory = await ethers.getContractFactory("SwapTest");
    swapTest = (await swapTestFactory.deploy()) as unknown as SwapTest;
    uniswapPool = (await ethers.getContractAt("IUniswapV3Pool", POOL)) as unknown as IUniswapV3Pool;
    token0 = (await ethers.getContractAt("IERC20", await uniswapPool.token0())) as unknown as IERC20;
    token1 = (await ethers.getContractAt("IERC20", await uniswapPool.token1())) as unknown as IERC20;

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [SWAPPER],
    });
    swapper = await ethers.provider.getSigner(SWAPPER);
    console.log("BLOCK NUMBER:", swapper.provider.blockNumber)
  });

  describe("", function () {
    it("simulate swap", async function () {
      const swapAmount = ethers.utils.parseUnits("100000", "6")
      const slot0Before = await uniswapPool.slot0();
      const priceBefore = (1.0001**Number(slot0Before.tick))/(10**12);
      const balance0Before = await token0.balanceOf(SWAPPER);
      const balance1Before = await token1.balanceOf(SWAPPER);
      //console.log("balance before:", ethers.utils.formatUnits(balance0Before, "6"))
      console.log("price before:", 1/priceBefore);
      await token0.connect(swapper).approve(swapTest.address, swapAmount)
      await swapTest.connect(swapper).swap(uniswapPool.address, true, swapAmount)
      const slot0After = await uniswapPool.slot0();
      const priceAfter = (1.0001**Number(slot0After.tick))/(10**12);
      console.log("price after:", 1/priceAfter);
      const balance0After = await token0.balanceOf(SWAPPER);
      const balance1After = await token1.balanceOf(SWAPPER);
      const percentChange = (priceBefore-priceAfter)/priceBefore;
      const balance0Change = balance0Before.sub(balance0After);
      const balance1Change = balance1After.sub(balance1Before);
      console.log("sent:", ethers.utils.formatUnits(balance0Change, "6"), "USDC");
      console.log("received:", ethers.utils.formatEther(balance1Change), "ETH");
      console.log("price impact:", percentChange);
    });
  });
});
