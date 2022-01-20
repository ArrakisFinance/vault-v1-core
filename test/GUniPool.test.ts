import { expect } from "chai";
import { BigNumber } from "bignumber.js";
import { ethers, network } from "hardhat";
import {
  IERC20,
  IUniswapV3Factory,
  IUniswapV3Pool,
  SwapTest,
  GUniPool,
  GUniFactory,
  EIP173Proxy,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

// eslint-disable-next-line
BigNumber.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

// returns the sqrt price as a 64x96
function encodePriceSqrt(reserve1: string, reserve0: string) {
  return new BigNumber(reserve1)
    .div(reserve0)
    .sqrt()
    .multipliedBy(new BigNumber(2).pow(96))
    .integerValue(3)
    .toString();
}

function position(address: string, lowerTick: number, upperTick: number) {
  return ethers.utils.solidityKeccak256(
    ["address", "int24", "int24"],
    [address, lowerTick, upperTick]
  );
}

describe("GUniPool", function () {
  this.timeout(0);

  let uniswapFactory: IUniswapV3Factory;
  let uniswapPool: IUniswapV3Pool;

  let token0: IERC20;
  let token1: IERC20;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let swapTest: SwapTest;
  let gUniPool: GUniPool;
  let gUniFactory: GUniFactory;
  let gelato: SignerWithAddress;
  let uniswapPoolAddress: string;
  let implementationAddress: string;

  before(async function () {
    [user0, user1, user2, gelato] = await ethers.getSigners();

    const swapTestFactory = await ethers.getContractFactory("SwapTest");
    swapTest = (await swapTestFactory.deploy()) as SwapTest;
  });

  beforeEach(async function () {
    const uniswapV3Factory = await ethers.getContractFactory(
      "UniswapV3Factory"
    );
    const uniswapDeploy = await uniswapV3Factory.deploy();
    uniswapFactory = (await ethers.getContractAt(
      "IUniswapV3Factory",
      uniswapDeploy.address
    )) as IUniswapV3Factory;

    const mockERC20Factory = await ethers.getContractFactory("MockERC20");
    token0 = (await mockERC20Factory.deploy()) as IERC20;
    token1 = (await mockERC20Factory.deploy()) as IERC20;

    await token0.approve(
      swapTest.address,
      ethers.utils.parseEther("10000000000000")
    );
    await token1.approve(
      swapTest.address,
      ethers.utils.parseEther("10000000000000")
    );

    // Sort token0 & token1 so it follows the same order as Uniswap & the GUniPoolFactory
    if (
      ethers.BigNumber.from(token0.address).gt(
        ethers.BigNumber.from(token1.address)
      )
    ) {
      const tmp = token0;
      token0 = token1;
      token1 = tmp;
    }

    await uniswapFactory.createPool(token0.address, token1.address, "3000");
    uniswapPoolAddress = await uniswapFactory.getPool(
      token0.address,
      token1.address,
      "3000"
    );
    uniswapPool = (await ethers.getContractAt(
      "IUniswapV3Pool",
      uniswapPoolAddress
    )) as IUniswapV3Pool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await uniswapPool.increaseObservationCardinalityNext("5");

    const gUniPoolFactory = await ethers.getContractFactory("GUniPool");
    const gUniImplementation = await gUniPoolFactory.deploy(
      await gelato.getAddress()
    );

    implementationAddress = gUniImplementation.address;

    const gUniFactoryFactory = await ethers.getContractFactory("GUniFactory");

    gUniFactory = (await gUniFactoryFactory.deploy(
      uniswapFactory.address
    )) as GUniFactory;

    await gUniFactory.initialize(
      implementationAddress,
      await user0.getAddress(),
      await user0.getAddress()
    );

    await gUniFactory.createManagedPool(
      token0.address,
      token1.address,
      3000,
      0,
      -887220,
      887220
    );

    const deployers = await gUniFactory.getDeployers();
    const deployer = deployers[0];
    const gelatoDeployer = await gUniFactory.gelatoDeployer();
    expect(deployer).to.equal(gelatoDeployer);
    const pools = await gUniFactory.getPools(deployer);
    const gelatoPools = await gUniFactory.getGelatoPools();
    expect(pools[0]).to.equal(gelatoPools[0]);
    expect(pools.length).to.equal(gelatoPools.length);

    gUniPool = (await ethers.getContractAt("GUniPool", pools[0])) as GUniPool;
    const gelatoFee = await gUniPool.gelatoFeeBPS();
    expect(gelatoFee.toString()).to.equal("250");
  });

  describe("Before liquidity deposited", function () {
    beforeEach(async function () {
      await token0.approve(
        gUniPool.address,
        ethers.utils.parseEther("1000000")
      );
      await token1.approve(
        gUniPool.address,
        ethers.utils.parseEther("1000000")
      );
    });

    describe("deposit", function () {
      it("should deposit funds into GUniPool", async function () {
        const result = await gUniPool.getMintAmounts(
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );
        await gUniPool.mint(result.mintAmount, await user0.getAddress());

        expect(await token0.balanceOf(uniswapPool.address)).to.be.gt(0);
        expect(await token1.balanceOf(uniswapPool.address)).to.be.gt(0);
        const [liquidity] = await uniswapPool.positions(
          position(gUniPool.address, -887220, 887220)
        );
        expect(liquidity).to.be.gt(0);
        const supply = await gUniPool.totalSupply();
        expect(supply).to.be.gt(0);
        const result2 = await gUniPool.getMintAmounts(
          ethers.utils.parseEther("0.5"),
          ethers.utils.parseEther("1")
        );
        await gUniPool.mint(result2.mintAmount, await user0.getAddress());
        const [liquidity2] = await uniswapPool.positions(
          position(gUniPool.address, -887220, 887220)
        );
        expect(liquidity2).to.be.gt(liquidity);

        await gUniPool.transfer(
          await user1.getAddress(),
          ethers.utils.parseEther("1")
        );
        await gUniPool
          .connect(user1)
          .approve(await user0.getAddress(), ethers.utils.parseEther("1"));
        await gUniPool
          .connect(user0)
          .transferFrom(
            await user1.getAddress(),
            await user0.getAddress(),
            ethers.utils.parseEther("1")
          );

        const decimals = await gUniPool.decimals();
        const symbol = await gUniPool.symbol();
        const name = await gUniPool.name();
        expect(symbol).to.equal("G-UNI");
        expect(decimals).to.equal(18);
        expect(name).to.equal("Gelato Uniswap TOKEN/TOKEN LP");
      });
    });

    describe("onlyGelato", function () {
      it("should fail if not called by gelato", async function () {
        await expect(
          gUniPool
            .connect(user1)
            .rebalance(
              encodePriceSqrt("10", "1"),
              1000,
              true,
              10,
              token0.address
            )
        ).to.be.reverted;
        await expect(
          gUniPool.connect(user1).withdrawManagerBalance(1, token0.address)
        ).to.be.reverted;
        await expect(
          gUniPool.connect(user1).withdrawGelatoBalance(1, token0.address)
        ).to.be.reverted;
      });
      it("should fail if no fees earned", async function () {
        await expect(
          gUniPool
            .connect(gelato)
            .rebalance(
              encodePriceSqrt("10", "1"),
              1000,
              true,
              10,
              token0.address
            )
        ).to.be.reverted;
        await expect(
          gUniPool.connect(gelato).withdrawManagerBalance(1, token0.address)
        ).to.be.reverted;
        await expect(
          gUniPool.connect(gelato).withdrawGelatoBalance(1, token0.address)
        ).to.be.reverted;
      });
    });

    describe("onlyManager", function () {
      it("should be possible to executiveRebalance before deposits", async function () {
        await gUniPool.executiveRebalance(-887220, 0, 0, 0, false);
        await gUniPool.executiveRebalance(-887220, 887220, 0, 0, false);
      });
      it("should fail if not called by manager", async function () {
        await expect(
          gUniPool
            .connect(gelato)
            .updateGelatoParams(300, 5000, 5000, 5000, await user0.getAddress())
        ).to.be.reverted;

        await expect(
          gUniPool.connect(gelato).transferOwnership(await user1.getAddress())
        ).to.be.reverted;
        await expect(gUniPool.connect(gelato).renounceOwnership()).to.be
          .reverted;
        await expect(gUniPool.connect(gelato).initializeManagerFee(100)).to.be
          .reverted;
      });
    });

    describe("After liquidity deposited", function () {
      beforeEach(async function () {
        const result = await gUniPool.getMintAmounts(
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );
        await gUniPool.mint(result.mintAmount, await user0.getAddress());
      });

      describe("withdrawal", function () {
        it("should burn LP tokens and withdraw funds", async function () {
          await gUniPool.burn(
            (await gUniPool.totalSupply()).div("2"),
            await user0.getAddress()
          );
          const [liquidity2] = await uniswapPool.positions(
            position(gUniPool.address, -887220, 887220)
          );
          expect(liquidity2).to.be.gt(0);
          expect(await gUniPool.totalSupply()).to.be.gt(0);
          expect(await gUniPool.balanceOf(await user0.getAddress())).to.equal(
            ethers.utils.parseEther("0.5")
          );
        });
      });

      describe("after fees earned on trades", function () {
        beforeEach(async function () {
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            2
          );
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            3
          );
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            3
          );
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            3
          );
        });

        describe("reinvest fees", function () {
          it("should redeposit fees with a rebalance", async function () {
            const [liquidityOld] = await uniswapPool.positions(
              position(gUniPool.address, -887220, 887220)
            );
            const gelatoBalanceBefore = await token1.balanceOf(
              await gelato.getAddress()
            );

            await expect(
              gUniPool
                .connect(gelato)
                .rebalance(
                  encodePriceSqrt("1", "1"),
                  5000,
                  true,
                  10,
                  token0.address
                )
            ).to.be.reverted;

            const tx = await gUniPool.updateGelatoParams(
              "1000",
              "100",
              "500",
              "300",
              await user0.getAddress()
            );
            if (network.provider && user0.provider && tx.blockHash) {
              const block = await user0.provider.getBlock(tx.blockHash);
              const executionTime = block.timestamp + 300;
              await network.provider.send("evm_mine", [executionTime]);
            }

            const { sqrtPriceX96 } = await uniswapPool.slot0();
            const slippagePrice = sqrtPriceX96.sub(
              sqrtPriceX96.div(ethers.BigNumber.from("25"))
            );

            await gUniPool
              .connect(gelato)
              .rebalance(slippagePrice, 5000, true, 5, token1.address);

            const gelatoBalanceAfter = await token1.balanceOf(
              await gelato.getAddress()
            );
            expect(gelatoBalanceAfter).to.be.gt(gelatoBalanceBefore);
            expect(
              Number(gelatoBalanceAfter.sub(gelatoBalanceBefore))
            ).to.be.equal(5);

            const [liquidityNew] = await uniswapPool.positions(
              position(gUniPool.address, -887220, 887220)
            );
            expect(liquidityNew).to.be.gt(liquidityOld);
          });
        });

        describe("executive rebalance", function () {
          it("should change the ticks and redeposit", async function () {
            const [liquidityOld] = await uniswapPool.positions(
              position(gUniPool.address, -887220, 887220)
            );

            const tx = await gUniPool
              .connect(user0)
              .updateGelatoParams(
                "5000",
                "5000",
                "5000",
                "200",
                await user0.getAddress()
              );
            await tx.wait();
            await swapTest.washTrade(
              uniswapPool.address,
              "500000000000000000",
              100,
              2
            );
            await token1.transfer(
              gUniPool.address,
              ethers.utils.parseEther("1")
            );
            if (network.provider && user0.provider && tx.blockHash) {
              const block = await user0.provider.getBlock(tx.blockHash);
              const executionTime = block.timestamp + 300;
              await network.provider.send("evm_mine", [executionTime]);
            }
            const lowerTickBefore = await gUniPool.lowerTick();
            const upperTickBefore = await gUniPool.upperTick();
            expect(lowerTickBefore).to.equal(-887220);
            expect(upperTickBefore).to.equal(887220);
            const { sqrtPriceX96 } = await uniswapPool.slot0();
            const slippagePrice = sqrtPriceX96.add(
              sqrtPriceX96.div(ethers.BigNumber.from("25"))
            );

            await gUniPool
              .connect(user0)
              .executiveRebalance(-443580, 443580, slippagePrice, 5000, false);

            const lowerTickAfter = await gUniPool.lowerTick();
            const upperTickAfter = await gUniPool.upperTick();
            expect(lowerTickAfter).to.equal(-443580);
            expect(upperTickAfter).to.equal(443580);

            const [liquidityOldAfter] = await uniswapPool.positions(
              position(gUniPool.address, -887220, 887220)
            );
            expect(liquidityOldAfter).to.equal("0");
            expect(liquidityOldAfter).to.be.lt(liquidityOld);

            const [liquidityNew] = await uniswapPool.positions(
              position(gUniPool.address, -443580, 443580)
            );
            expect(liquidityNew).to.be.gt(liquidityOld);

            // console.log(gelatoBalance0.toString(), gelatoBalance1.toString());

            await gUniPool.burn(
              await gUniPool.totalSupply(),
              await user0.getAddress()
            );

            const contractBalance0 = await token0.balanceOf(gUniPool.address);
            const contractBalance1 = await token1.balanceOf(gUniPool.address);
            // console.log(
            //   contractBalance0.toString(),
            //   contractBalance1.toString()
            // );

            const gelatoBalance0 = await gUniPool.gelatoBalance0();
            const gelatoBalance1 = await gUniPool.gelatoBalance1();

            expect(contractBalance0).to.equal(gelatoBalance0);
            expect(contractBalance1).to.equal(gelatoBalance1);
          });

          it("should receive same amounts on burn as spent on mint (if no trading)", async function () {
            const user1Address = await user1.getAddress();
            const user2Address = await user2.getAddress();
            await token0.transfer(
              user2Address,
              ethers.utils.parseEther("1000")
            );
            await token1.transfer(
              user2Address,
              ethers.utils.parseEther("1000")
            );
            await token0.transfer(
              user1Address,
              ethers.utils.parseEther("1000")
            );
            await token1.transfer(
              user1Address,
              ethers.utils.parseEther("1000")
            );
            await token0
              .connect(user1)
              .approve(gUniPool.address, ethers.constants.MaxUint256);
            await token1
              .connect(user1)
              .approve(gUniPool.address, ethers.constants.MaxUint256);
            const result = await gUniPool.getMintAmounts(
              ethers.utils.parseEther("9"),
              ethers.utils.parseEther("9")
            );
            await gUniPool.connect(user1).mint(result.mintAmount, user1Address);
            await token0
              .connect(user2)
              .approve(gUniPool.address, ethers.constants.MaxUint256);
            await token1
              .connect(user2)
              .approve(gUniPool.address, ethers.constants.MaxUint256);
            const result2 = await gUniPool.getMintAmounts(
              ethers.utils.parseEther("10"),
              ethers.utils.parseEther("10")
            );
            await gUniPool
              .connect(user2)
              .mint(result2.mintAmount, user2Address);

            const balanceAfterMint0 = await token0.balanceOf(user2Address);
            const balanceAfterMint1 = await token0.balanceOf(user2Address);

            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterMint0.toString())
            ).to.be.gt(ethers.BigNumber.from("1"));
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterMint1.toString())
            ).to.be.gt(ethers.BigNumber.from("1"));

            await gUniPool
              .connect(user2)
              .burn(await gUniPool.balanceOf(user2Address), user2Address);
            const balanceAfterBurn0 = await token0.balanceOf(user2Address);
            const balanceAfterBurn1 = await token0.balanceOf(user2Address);
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn1.toString())
            ).to.be.lte(ethers.BigNumber.from("2"));
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn0.toString())
            ).to.be.lte(ethers.BigNumber.from("2"));
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn1.toString())
            ).to.be.gte(ethers.constants.Zero);
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn0.toString())
            ).to.be.gte(ethers.constants.Zero);
          });
        });
      });

      describe("simulate price moves and deposits, prove all value is returned on burn", function () {
        it("does not get tokens stuck in contract", async function () {
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000000000000",
            100,
            3
          );
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000000000000",
            100,
            3
          );
          const { sqrtPriceX96 } = await uniswapPool.slot0();
          const slippagePrice = sqrtPriceX96.sub(
            sqrtPriceX96.div(ethers.BigNumber.from("25"))
          );
          await expect(
            gUniPool
              .connect(gelato)
              .rebalance(slippagePrice, 1000, true, 10, token0.address)
          ).to.be.reverted;

          const tx = await gUniPool
            .connect(user0)
            .updateGelatoParams(
              "5000",
              "5000",
              "5000",
              "200",
              await user0.getAddress()
            );
          if (network.provider && user0.provider && tx.blockHash) {
            const block = await user0.provider.getBlock(tx.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          await gUniPool
            .connect(gelato)
            .rebalance(0, 0, true, 2, token0.address);

          let contractBalance0 = await token0.balanceOf(gUniPool.address);
          let contractBalance1 = await token1.balanceOf(gUniPool.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());
          await token0.transfer(await user1.getAddress(), "10000000000");
          await token1.transfer(await user1.getAddress(), "10000000000");
          await token0
            .connect(user1)
            .approve(gUniPool.address, "10000000000000");
          await token1
            .connect(user1)
            .approve(gUniPool.address, "10000000000000");
          const result = await gUniPool.getMintAmounts(1000000, 1000000);
          await gUniPool
            .connect(user1)
            .mint(result.mintAmount, await user1.getAddress());

          contractBalance0 = await token0.balanceOf(gUniPool.address);
          contractBalance1 = await token1.balanceOf(gUniPool.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          await swapTest.washTrade(uniswapPool.address, "50000", 100, 3);
          const tx2 = await swapTest.washTrade(
            uniswapPool.address,
            "50000",
            100,
            3
          );
          await tx2.wait();
          if (network.provider && tx2.blockHash && user0.provider) {
            const block = await user0.provider.getBlock(tx2.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          const { sqrtPriceX96: p2 } = await uniswapPool.slot0();
          const slippagePrice2 = p2.sub(p2.div(ethers.BigNumber.from("50")));
          await gUniPool
            .connect(gelato)
            .rebalance(slippagePrice2, 5000, true, 1, token0.address);
          contractBalance0 = await token0.balanceOf(gUniPool.address);
          contractBalance1 = await token1.balanceOf(gUniPool.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          // TEST MINT/BURN should return same amount
          await token0.transfer(await user2.getAddress(), "100000000000");
          await token1.transfer(await user2.getAddress(), "100000000000");
          await token0
            .connect(user2)
            .approve(gUniPool.address, "1000000000000000");
          await token1
            .connect(user2)
            .approve(gUniPool.address, "1000000000000000");
          const preBalance0 = await token0.balanceOf(await user2.getAddress());
          const preBalance1 = await token1.balanceOf(await user2.getAddress());
          const preBalanceG = await gUniPool.balanceOf(
            await user2.getAddress()
          );
          const mintAmounts = await gUniPool.getMintAmounts(
            "90000000002",
            "90000000002"
          );

          await gUniPool
            .connect(user2)
            .mint(mintAmounts.mintAmount, await user2.getAddress());
          const intermediateBalance0 = await token0.balanceOf(
            await user2.getAddress()
          );
          const intermediateBalance1 = await token1.balanceOf(
            await user2.getAddress()
          );
          const intermediateBalanceG = await gUniPool.balanceOf(
            await user2.getAddress()
          );

          expect(preBalance0.sub(intermediateBalance0)).to.equal(
            mintAmounts.amount0
          );
          expect(preBalance1.sub(intermediateBalance1)).to.equal(
            mintAmounts.amount1
          );
          expect(intermediateBalanceG.sub(preBalanceG)).to.equal(
            mintAmounts.mintAmount
          );
          await gUniPool
            .connect(user2)
            .burn(
              await gUniPool.balanceOf(await user2.getAddress()),
              await user2.getAddress()
            );
          const postBalance0 = await token0.balanceOf(await user2.getAddress());
          const postBalance1 = await token1.balanceOf(await user2.getAddress());

          expect(preBalance0.sub(postBalance0)).to.be.lte(
            ethers.BigNumber.from("2")
          );
          expect(preBalance0.sub(postBalance0)).to.be.gte(
            ethers.constants.Zero
          );
          expect(preBalance1.sub(postBalance1)).to.be.lte(
            ethers.BigNumber.from("2")
          );
          expect(preBalance1.sub(postBalance1)).to.be.gte(
            ethers.constants.Zero
          );

          await gUniPool
            .connect(user1)
            .burn(
              await gUniPool.balanceOf(await user1.getAddress()),
              await user1.getAddress()
            );

          contractBalance0 = await token0.balanceOf(gUniPool.address);
          contractBalance1 = await token1.balanceOf(gUniPool.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          await gUniPool
            .connect(user0)
            .burn(await gUniPool.totalSupply(), await user0.getAddress());

          await gUniPool
            .connect(gelato)
            .withdrawGelatoBalance(1, token0.address);

          contractBalance0 = await token0.balanceOf(gUniPool.address);
          contractBalance1 = await token1.balanceOf(gUniPool.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          expect(contractBalance0).to.equal(0);
          expect(contractBalance1).to.equal(0);
        });
      });
      describe("manager fees, withdrawals, and ownership", function () {
        it("should handle manager fees and ownership", async function () {
          for (let i = 0; i < 3; i++) {
            await swapTest.washTrade(uniswapPool.address, "50000", 100, 3);
            await swapTest.washTrade(uniswapPool.address, "50000", 100, 3);
          }
          const { sqrtPriceX96 } = await uniswapPool.slot0();
          const slippagePrice = sqrtPriceX96.sub(
            sqrtPriceX96.div(ethers.BigNumber.from("25"))
          );
          await expect(
            gUniPool
              .connect(gelato)
              .rebalance(slippagePrice, 1000, true, 2, token0.address)
          ).to.be.reverted;
          const tx = await gUniPool
            .connect(user0)
            .updateGelatoParams(
              "9000",
              "9000",
              "500",
              "300",
              await user1.getAddress()
            );
          await tx.wait();
          if (network.provider && tx.blockHash && user0.provider) {
            const block = await user0.provider.getBlock(tx.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          await gUniPool.connect(user0).initializeManagerFee(5000);
          await gUniPool
            .connect(gelato)
            .rebalance(slippagePrice, 5000, true, 2, token0.address);

          const treasuryBal0 = await token0.balanceOf(await user1.getAddress());
          const treasuryBal1 = await token1.balanceOf(await user1.getAddress());

          await gUniPool
            .connect(gelato)
            .withdrawManagerBalance(2, token0.address);

          const treasuryBalEnd0 = await token0.balanceOf(
            await user1.getAddress()
          );
          const treasuryBalEnd1 = await token1.balanceOf(
            await user1.getAddress()
          );

          expect(treasuryBalEnd0).to.be.gt(treasuryBal0);
          expect(treasuryBalEnd1).to.be.gt(treasuryBal1);

          const bal0End = await gUniPool.managerBalance0();
          const bal1End = await gUniPool.managerBalance1();

          expect(bal0End).to.equal(ethers.constants.Zero);
          expect(bal1End).to.equal(ethers.constants.Zero);

          const gelatoBal0 = await token0.balanceOf(await gelato.getAddress());
          const gelatoBal1 = await token1.balanceOf(await gelato.getAddress());

          await gUniPool
            .connect(gelato)
            .withdrawGelatoBalance(1, token0.address);

          const gelatoBalEnd0 = await token0.balanceOf(
            await gelato.getAddress()
          );
          const gelatoBalEnd1 = await token1.balanceOf(
            await gelato.getAddress()
          );

          expect(gelatoBalEnd0).to.be.gt(gelatoBal0);
          expect(gelatoBalEnd1).to.be.gt(gelatoBal1);

          const gelatoLeft0 = await gUniPool.gelatoBalance0();
          const gelatoLeft1 = await gUniPool.gelatoBalance1();

          expect(gelatoLeft0).to.equal(ethers.constants.Zero);
          expect(gelatoLeft1).to.equal(ethers.constants.Zero);

          await expect(gUniPool.connect(user0).initializeManagerFee(2000)).to.be
            .reverted;
          const treasuryStart = await gUniPool.managerTreasury();
          expect(treasuryStart).to.equal(await user1.getAddress());
          await expect(gUniPool.connect(gelato).renounceOwnership()).to.be
            .reverted;
          const manager = await gUniPool.manager();
          expect(manager).to.equal(await user0.getAddress());
          await gUniPool
            .connect(user0)
            .transferOwnership(await user1.getAddress());
          const manager2 = await gUniPool.manager();
          expect(manager2).to.equal(await user1.getAddress());
          await gUniPool.connect(user1).renounceOwnership();
          const treasuryEnd = await gUniPool.managerTreasury();
          expect(treasuryEnd).to.equal(ethers.constants.AddressZero);
          const lastManager = await gUniPool.manager();
          expect(lastManager).to.equal(ethers.constants.AddressZero);
        });
      });
      describe("factory management", function () {
        it("should create pools correctly", async function () {
          await gUniFactory.createPool(
            token0.address,
            token1.address,
            3000,
            -887220,
            887220
          );
          const deployers = await gUniFactory.getDeployers();
          const deployer = deployers[0];
          let deployerPools = await gUniFactory.getPools(deployer);
          let newPool = (await ethers.getContractAt(
            "GUniPool",
            deployerPools[deployerPools.length - 1]
          )) as GUniPool;
          let newPoolManager = await newPool.manager();
          expect(newPoolManager).to.equal(ethers.constants.AddressZero);
          await uniswapFactory.createPool(
            token0.address,
            token1.address,
            "500"
          );
          await gUniFactory.createPool(
            token0.address,
            token1.address,
            500,
            -10,
            10
          );
          deployerPools = await gUniFactory.getPools(deployer);
          newPool = (await ethers.getContractAt(
            "GUniPool",
            deployerPools[deployerPools.length - 1]
          )) as GUniPool;
          newPoolManager = await newPool.manager();
          expect(newPoolManager).to.equal(ethers.constants.AddressZero);
          let lowerTick = await newPool.lowerTick();
          let upperTick = await newPool.upperTick();
          expect(lowerTick).to.equal(-10);
          expect(upperTick).to.equal(10);

          await uniswapFactory.createPool(
            token0.address,
            token1.address,
            "10000"
          );
          await gUniFactory.createPool(
            token0.address,
            token1.address,
            10000,
            200,
            600
          );
          deployerPools = await gUniFactory.getPools(deployer);
          newPool = (await ethers.getContractAt(
            "GUniPool",
            deployerPools[deployerPools.length - 1]
          )) as GUniPool;
          newPoolManager = await newPool.manager();
          expect(newPoolManager).to.equal(ethers.constants.AddressZero);
          lowerTick = await newPool.lowerTick();
          upperTick = await newPool.upperTick();
          expect(lowerTick).to.equal(200);
          expect(upperTick).to.equal(600);

          await expect(
            gUniFactory.createPool(
              token0.address,
              token1.address,
              3000,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            gUniFactory.createManagedPool(
              token0.address,
              token1.address,
              3000,
              0,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            gUniFactory.createPool(
              token0.address,
              token1.address,
              10000,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            gUniFactory.createManagedPool(
              token0.address,
              token1.address,
              10000,
              0,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            gUniFactory.createPool(token0.address, token1.address, 500, -5, 5)
          ).to.be.reverted;
          await expect(
            gUniFactory.createManagedPool(
              token0.address,
              token1.address,
              500,
              0,
              -5,
              5
            )
          ).to.be.reverted;
          await expect(
            gUniFactory.createPool(token0.address, token1.address, 500, 100, 0)
          ).to.be.reverted;
          await expect(
            gUniFactory.createManagedPool(
              token0.address,
              token1.address,
              500,
              0,
              100,
              0
            )
          ).to.be.reverted;
        });
        it("should handle implementation upgrades and whitelisting", async function () {
          const manager = await gUniFactory.manager();
          expect(manager).to.equal(await user0.getAddress());

          // only manager should be able to call permissioned functions
          await expect(
            gUniFactory.connect(gelato).upgradePools([gUniPool.address])
          ).to.be.reverted;
          await expect(
            gUniFactory
              .connect(gelato)
              .upgradePoolsAndCall([gUniPool.address], ["0x"])
          ).to.be.reverted;
          await expect(
            gUniFactory.connect(gelato).makePoolsImmutable([gUniPool.address])
          ).to.be.reverted;
          await expect(
            gUniFactory
              .connect(gelato)
              .setPoolImplementation(ethers.constants.AddressZero)
          ).to.be.reverted;
          await expect(
            gUniFactory
              .connect(gelato)
              .setGelatoDeployer(ethers.constants.AddressZero)
          ).to.be.reverted;

          const implementationBefore = await gUniFactory.poolImplementation();
          expect(implementationBefore).to.equal(implementationAddress);
          await gUniFactory.setPoolImplementation(ethers.constants.AddressZero);
          const implementationAfter = await gUniFactory.poolImplementation();
          expect(implementationAfter).to.equal(ethers.constants.AddressZero);
          await gUniFactory.upgradePools([gUniPool.address]);
          await expect(gUniPool.totalSupply()).to.be.reverted;
          const proxyAdmin = await gUniFactory.getProxyAdmin(gUniPool.address);
          expect(proxyAdmin).to.equal(gUniFactory.address);
          const isNotImmutable = await gUniFactory.isPoolImmutable(
            gUniPool.address
          );
          expect(isNotImmutable).to.be.false;
          await gUniFactory.makePoolsImmutable([gUniPool.address]);
          await expect(gUniFactory.upgradePools([gUniPool.address])).to.be
            .reverted;
          const poolProxy = (await ethers.getContractAt(
            "EIP173Proxy",
            gUniPool.address
          )) as EIP173Proxy;
          await expect(
            poolProxy.connect(user0).upgradeTo(implementationAddress)
          ).to.be.reverted;
          const isImmutable = await gUniFactory.isPoolImmutable(
            gUniPool.address
          );
          expect(isImmutable).to.be.true;
          await gUniFactory.setGelatoDeployer(ethers.constants.AddressZero);
          const newDeployer = await gUniFactory.gelatoDeployer();
          expect(newDeployer).to.equal(ethers.constants.AddressZero);
          const gelatoPools = await gUniFactory.getGelatoPools();
          expect(gelatoPools.length).to.equal(0);
          await gUniFactory.transferOwnership(await user1.getAddress());
          const manager2 = await gUniFactory.manager();
          expect(manager2).to.equal(await user1.getAddress());
          await gUniFactory.connect(user1).renounceOwnership();
          const manager3 = await gUniFactory.manager();
          expect(manager3).to.equal(ethers.constants.AddressZero);
        });
      });
    });
  });
});
