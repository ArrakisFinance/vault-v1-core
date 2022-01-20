import { expect } from "chai";
import { BigNumber } from "bignumber.js";
import { ethers, network } from "hardhat";
import {
  IERC20,
  IUniswapV3Factory,
  IUniswapV3Pool,
  SwapTest,
  HarvesterV1,
  HarvesterV1Factory,
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

describe("HarvesterV1", function () {
  this.timeout(0);

  let uniswapFactory: IUniswapV3Factory;
  let uniswapPool: IUniswapV3Pool;

  let token0: IERC20;
  let token1: IERC20;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let swapTest: SwapTest;
  let harvester: HarvesterV1;
  let harvesterFactory: HarvesterV1Factory;
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

    // Sort token0 & token1 so it follows the same order as Uniswap & the HarvesterV1Factory
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

    await uniswapPool.increaseObservationCardinalityNext("15");

    const harvesterV1Factory = await ethers.getContractFactory("HarvesterV1");
    const harvesterImplementation = await harvesterV1Factory.deploy(
      await gelato.getAddress(),
      await user0.getAddress()
    );

    implementationAddress = harvesterImplementation.address;

    const harvesterFactoryFactory = await ethers.getContractFactory(
      "HarvesterV1Factory"
    );

    harvesterFactory = (await harvesterFactoryFactory.deploy(
      uniswapFactory.address
    )) as HarvesterV1Factory;

    await harvesterFactory.initialize(
      implementationAddress,
      await user0.getAddress()
    );

    await harvesterFactory.createManagedPool(
      token0.address,
      token1.address,
      3000,
      0,
      -887220,
      887220
    );

    const deployers = await harvesterFactory.getDeployers();
    const deployer = deployers[0];
    const pools = await harvesterFactory.getPools(deployer);

    harvester = (await ethers.getContractAt(
      "HarvesterV1",
      pools[0]
    )) as HarvesterV1;
    const arrakisFee = await harvester.arrakisFeeBPS();
    expect(arrakisFee.toString()).to.equal("500");
  });

  describe("Before liquidity deposited", function () {
    beforeEach(async function () {
      await token0.approve(
        harvester.address,
        ethers.utils.parseEther("1000000")
      );
      await token1.approve(
        harvester.address,
        ethers.utils.parseEther("1000000")
      );
    });

    describe("deposit", function () {
      it("should deposit funds into HarvesterV1", async function () {
        const result = await harvester.getMintAmounts(
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );
        await harvester.mint(result.mintAmount, await user0.getAddress());

        expect(await token0.balanceOf(uniswapPool.address)).to.be.gt(0);
        expect(await token1.balanceOf(uniswapPool.address)).to.be.gt(0);
        const [liquidity] = await uniswapPool.positions(
          position(harvester.address, -887220, 887220)
        );
        expect(liquidity).to.be.gt(0);
        const supply = await harvester.totalSupply();
        expect(supply).to.be.gt(0);
        const result2 = await harvester.getMintAmounts(
          ethers.utils.parseEther("0.5"),
          ethers.utils.parseEther("1")
        );
        await harvester.mint(result2.mintAmount, await user0.getAddress());
        const [liquidity2] = await uniswapPool.positions(
          position(harvester.address, -887220, 887220)
        );
        expect(liquidity2).to.be.gt(liquidity);

        await harvester.transfer(
          await user1.getAddress(),
          ethers.utils.parseEther("1")
        );
        await harvester
          .connect(user1)
          .approve(await user0.getAddress(), ethers.utils.parseEther("1"));
        await harvester
          .connect(user0)
          .transferFrom(
            await user1.getAddress(),
            await user0.getAddress(),
            ethers.utils.parseEther("1")
          );

        const decimals = await harvester.decimals();
        const symbol = await harvester.symbol();
        const name = await harvester.name();
        expect(symbol).to.equal("HARV-1");
        expect(decimals).to.equal(18);
        expect(name).to.equal("Arrakis Harvester TOKEN/TOKEN");
      });
    });

    describe("onlyGelato", function () {
      it("should fail if not called by gelato", async function () {
        await expect(
          harvester
            .connect(user1)
            .rebalance(
              encodePriceSqrt("10", "1"),
              1000,
              true,
              10,
              token0.address
            )
        ).to.be.reverted;
      });
      it("should fail if no fees earned", async function () {
        await expect(
          harvester
            .connect(gelato)
            .rebalance(
              encodePriceSqrt("10", "1"),
              1000,
              true,
              10,
              token0.address
            )
        ).to.be.reverted;
      });
    });

    describe("onlyManager", function () {
      it("should be possible to executiveRebalance before deposits", async function () {
        await harvester.executiveRebalance(-887220, 0, 0, 0, false);
        await harvester.executiveRebalance(-887220, 887220, 0, 0, false);
      });
      it("should fail if not called by manager", async function () {
        await expect(
          harvester
            .connect(gelato)
            .updateAdminParams(
              -1,
              ethers.constants.AddressZero,
              300,
              5000,
              5000
            )
        ).to.be.reverted;

        await expect(
          harvester.connect(gelato).transferOwnership(await user1.getAddress())
        ).to.be.reverted;
        await expect(harvester.connect(gelato).renounceOwnership()).to.be
          .reverted;
      });
    });

    describe("After liquidity deposited", function () {
      beforeEach(async function () {
        const result = await harvester.getMintAmounts(
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );
        await harvester.mint(result.mintAmount, await user0.getAddress());
      });

      describe("withdrawal", function () {
        it("should burn LP tokens and withdraw funds", async function () {
          await harvester.burn(
            (await harvester.totalSupply()).div("2"),
            await user0.getAddress()
          );
          const [liquidity2] = await uniswapPool.positions(
            position(harvester.address, -887220, 887220)
          );
          expect(liquidity2).to.be.gt(0);
          expect(await harvester.totalSupply()).to.be.gt(0);
          expect(await harvester.balanceOf(await user0.getAddress())).to.equal(
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
              position(harvester.address, -887220, 887220)
            );
            const gelatoBalanceBefore = await token1.balanceOf(
              await gelato.getAddress()
            );

            await expect(
              harvester
                .connect(gelato)
                .rebalance(
                  encodePriceSqrt("1", "1"),
                  5000,
                  true,
                  10,
                  token0.address
                )
            ).to.be.reverted;

            const tx = await harvester.updateAdminParams(
              -1,
              ethers.constants.AddressZero,
              "1000",
              -1,
              -1
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

            await harvester
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
              position(harvester.address, -887220, 887220)
            );
            expect(liquidityNew).to.be.gt(liquidityOld);
          });
        });

        describe("executive rebalance", function () {
          it("should change the ticks and redeposit", async function () {
            const [liquidityOld] = await uniswapPool.positions(
              position(harvester.address, -887220, 887220)
            );

            const tx = await harvester
              .connect(user0)
              .updateAdminParams(
                -1,
                ethers.constants.AddressZero,
                "5000",
                -1,
                -1
              );
            await tx.wait();
            await swapTest.washTrade(
              uniswapPool.address,
              "500000000000000000",
              100,
              2
            );
            await token1.transfer(
              harvester.address,
              ethers.utils.parseEther("1")
            );
            if (network.provider && user0.provider && tx.blockHash) {
              const block = await user0.provider.getBlock(tx.blockHash);
              const executionTime = block.timestamp + 300;
              await network.provider.send("evm_mine", [executionTime]);
            }
            const lowerTickBefore = await harvester.lowerTick();
            const upperTickBefore = await harvester.upperTick();
            expect(lowerTickBefore).to.equal(-887220);
            expect(upperTickBefore).to.equal(887220);
            const { sqrtPriceX96 } = await uniswapPool.slot0();
            const slippagePrice = sqrtPriceX96.add(
              sqrtPriceX96.div(ethers.BigNumber.from("25"))
            );

            await harvester
              .connect(user0)
              .executiveRebalance(-443580, 443580, slippagePrice, 5000, false);

            const lowerTickAfter = await harvester.lowerTick();
            const upperTickAfter = await harvester.upperTick();
            expect(lowerTickAfter).to.equal(-443580);
            expect(upperTickAfter).to.equal(443580);

            const [liquidityOldAfter] = await uniswapPool.positions(
              position(harvester.address, -887220, 887220)
            );
            expect(liquidityOldAfter).to.equal("0");
            expect(liquidityOldAfter).to.be.lt(liquidityOld);

            const [liquidityNew] = await uniswapPool.positions(
              position(harvester.address, -443580, 443580)
            );
            expect(liquidityNew).to.be.gt(liquidityOld);

            await harvester.burn(
              await harvester.totalSupply(),
              await user0.getAddress()
            );

            const contractBalance0 = await token0.balanceOf(harvester.address);
            const contractBalance1 = await token1.balanceOf(harvester.address);

            const arrakisBalance0 = await harvester.arrakisBalance0();
            const arrakisBalance1 = await harvester.arrakisBalance1();

            expect(contractBalance0).to.equal(arrakisBalance0);
            expect(contractBalance1).to.equal(arrakisBalance1);
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
              .approve(harvester.address, ethers.constants.MaxUint256);
            await token1
              .connect(user1)
              .approve(harvester.address, ethers.constants.MaxUint256);
            const result = await harvester.getMintAmounts(
              ethers.utils.parseEther("9"),
              ethers.utils.parseEther("9")
            );
            await harvester
              .connect(user1)
              .mint(result.mintAmount, user1Address);
            await token0
              .connect(user2)
              .approve(harvester.address, ethers.constants.MaxUint256);
            await token1
              .connect(user2)
              .approve(harvester.address, ethers.constants.MaxUint256);
            const result2 = await harvester.getMintAmounts(
              ethers.utils.parseEther("10"),
              ethers.utils.parseEther("10")
            );
            await harvester
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

            await harvester
              .connect(user2)
              .burn(await harvester.balanceOf(user2Address), user2Address);
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
            harvester
              .connect(gelato)
              .rebalance(slippagePrice, 1000, true, 10, token0.address)
          ).to.be.reverted;

          const tx = await harvester
            .connect(user0)
            .updateAdminParams(
              -1,
              ethers.constants.AddressZero,
              "5000",
              -1,
              -1
            );
          if (network.provider && user0.provider && tx.blockHash) {
            const block = await user0.provider.getBlock(tx.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          await harvester
            .connect(gelato)
            .rebalance(0, 0, true, 2, token0.address);

          let contractBalance0 = await token0.balanceOf(harvester.address);
          let contractBalance1 = await token1.balanceOf(harvester.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());
          await token0.transfer(await user1.getAddress(), "10000000000");
          await token1.transfer(await user1.getAddress(), "10000000000");
          await token0
            .connect(user1)
            .approve(harvester.address, "10000000000000");
          await token1
            .connect(user1)
            .approve(harvester.address, "10000000000000");
          const result = await harvester.getMintAmounts(1000000, 1000000);
          await harvester
            .connect(user1)
            .mint(result.mintAmount, await user1.getAddress());

          contractBalance0 = await token0.balanceOf(harvester.address);
          contractBalance1 = await token1.balanceOf(harvester.address);
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
          await harvester
            .connect(gelato)
            .rebalance(slippagePrice2, 5000, true, 1, token0.address);
          contractBalance0 = await token0.balanceOf(harvester.address);
          contractBalance1 = await token1.balanceOf(harvester.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          // TEST MINT/BURN should return same amount
          await token0.transfer(await user2.getAddress(), "100000000000");
          await token1.transfer(await user2.getAddress(), "100000000000");
          await token0
            .connect(user2)
            .approve(harvester.address, "1000000000000000");
          await token1
            .connect(user2)
            .approve(harvester.address, "1000000000000000");
          const preBalance0 = await token0.balanceOf(await user2.getAddress());
          const preBalance1 = await token1.balanceOf(await user2.getAddress());
          const preBalanceG = await harvester.balanceOf(
            await user2.getAddress()
          );
          const mintAmounts = await harvester.getMintAmounts(
            "90000000002",
            "90000000002"
          );

          await harvester
            .connect(user2)
            .mint(mintAmounts.mintAmount, await user2.getAddress());
          const intermediateBalance0 = await token0.balanceOf(
            await user2.getAddress()
          );
          const intermediateBalance1 = await token1.balanceOf(
            await user2.getAddress()
          );
          const intermediateBalanceG = await harvester.balanceOf(
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
          await harvester
            .connect(user2)
            .burn(
              await harvester.balanceOf(await user2.getAddress()),
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

          await harvester
            .connect(user1)
            .burn(
              await harvester.balanceOf(await user1.getAddress()),
              await user1.getAddress()
            );

          contractBalance0 = await token0.balanceOf(harvester.address);
          contractBalance1 = await token1.balanceOf(harvester.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          await harvester
            .connect(user0)
            .burn(await harvester.totalSupply(), await user0.getAddress());

          await harvester.withdrawArrakisBalance();

          contractBalance0 = await token0.balanceOf(harvester.address);
          contractBalance1 = await token1.balanceOf(harvester.address);

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
            harvester
              .connect(gelato)
              .rebalance(slippagePrice, 1000, true, 2, token0.address)
          ).to.be.reverted;
          const tx = await harvester
            .connect(user0)
            .updateAdminParams(
              -1,
              ethers.constants.AddressZero,
              "9000",
              -1,
              -1
            );
          await tx.wait();
          if (network.provider && tx.blockHash && user0.provider) {
            const block = await user0.provider.getBlock(tx.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          await harvester
            .connect(user0)
            .updateAdminParams("5000", await user1.getAddress(), -1, -1, -1);
          await harvester
            .connect(gelato)
            .rebalance(slippagePrice, 5000, true, 2, token0.address);

          const treasuryBal0 = await token0.balanceOf(await user1.getAddress());
          const treasuryBal1 = await token1.balanceOf(await user1.getAddress());

          await harvester.withdrawManagerBalance();

          const treasuryBalEnd0 = await token0.balanceOf(
            await user1.getAddress()
          );
          const treasuryBalEnd1 = await token1.balanceOf(
            await user1.getAddress()
          );

          expect(treasuryBalEnd0).to.be.gt(treasuryBal0);
          expect(treasuryBalEnd1).to.be.gt(treasuryBal1);

          const bal0End = await harvester.managerBalance0();
          const bal1End = await harvester.managerBalance1();

          expect(bal0End).to.equal(ethers.constants.Zero);
          expect(bal1End).to.equal(ethers.constants.Zero);

          const arrakisBal0 = await token0.balanceOf(await user0.getAddress());
          const arrakisBal1 = await token1.balanceOf(await user0.getAddress());

          await harvester.withdrawArrakisBalance();

          const arrakisBalEnd0 = await token0.balanceOf(
            await user0.getAddress()
          );
          const arrakisBalEnd1 = await token1.balanceOf(
            await user0.getAddress()
          );

          expect(arrakisBalEnd0).to.be.gt(arrakisBal0);
          expect(arrakisBalEnd1).to.be.gt(arrakisBal1);

          const arrakisLeft0 = await harvester.arrakisBalance0();
          const arrakisLeft1 = await harvester.arrakisBalance1();

          expect(arrakisLeft0).to.equal(ethers.constants.Zero);
          expect(arrakisLeft1).to.equal(ethers.constants.Zero);

          const treasuryStart = await harvester.managerTreasury();
          expect(treasuryStart).to.equal(await user1.getAddress());
          await expect(harvester.connect(gelato).renounceOwnership()).to.be
            .reverted;
          const manager = await harvester.manager();
          expect(manager).to.equal(await user0.getAddress());
          await harvester
            .connect(user0)
            .transferOwnership(await user1.getAddress());
          const manager2 = await harvester.manager();
          expect(manager2).to.equal(await user1.getAddress());
          await harvester.connect(user1).renounceOwnership();
          const treasuryEnd = await harvester.managerTreasury();
          expect(treasuryEnd).to.equal(ethers.constants.AddressZero);
          const lastManager = await harvester.manager();
          expect(lastManager).to.equal(ethers.constants.AddressZero);
        });
      });
      describe("factory management", function () {
        it("should create pools correctly", async function () {
          await harvesterFactory.createPool(
            token0.address,
            token1.address,
            3000,
            -887220,
            887220
          );
          const deployers = await harvesterFactory.getDeployers();
          const deployer = deployers[0];
          let deployerPools = await harvesterFactory.getPools(deployer);
          let newPool = (await ethers.getContractAt(
            "HarvesterV1",
            deployerPools[deployerPools.length - 1]
          )) as HarvesterV1;
          let newPoolManager = await newPool.manager();
          expect(newPoolManager).to.equal(ethers.constants.AddressZero);
          await uniswapFactory.createPool(
            token0.address,
            token1.address,
            "500"
          );
          await harvesterFactory.createPool(
            token0.address,
            token1.address,
            500,
            -10,
            10
          );
          deployerPools = await harvesterFactory.getPools(deployer);
          newPool = (await ethers.getContractAt(
            "HarvesterV1",
            deployerPools[deployerPools.length - 1]
          )) as HarvesterV1;
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
          await harvesterFactory.createPool(
            token0.address,
            token1.address,
            10000,
            200,
            600
          );
          deployerPools = await harvesterFactory.getPools(deployer);
          newPool = (await ethers.getContractAt(
            "HarvesterV1",
            deployerPools[deployerPools.length - 1]
          )) as HarvesterV1;
          newPoolManager = await newPool.manager();
          expect(newPoolManager).to.equal(ethers.constants.AddressZero);
          lowerTick = await newPool.lowerTick();
          upperTick = await newPool.upperTick();
          expect(lowerTick).to.equal(200);
          expect(upperTick).to.equal(600);

          await expect(
            harvesterFactory.createPool(
              token0.address,
              token1.address,
              3000,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            harvesterFactory.createManagedPool(
              token0.address,
              token1.address,
              3000,
              0,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            harvesterFactory.createPool(
              token0.address,
              token1.address,
              10000,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            harvesterFactory.createManagedPool(
              token0.address,
              token1.address,
              10000,
              0,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            harvesterFactory.createPool(
              token0.address,
              token1.address,
              500,
              -5,
              5
            )
          ).to.be.reverted;
          await expect(
            harvesterFactory.createManagedPool(
              token0.address,
              token1.address,
              500,
              0,
              -5,
              5
            )
          ).to.be.reverted;
          await expect(
            harvesterFactory.createPool(
              token0.address,
              token1.address,
              500,
              100,
              0
            )
          ).to.be.reverted;
          await expect(
            harvesterFactory.createManagedPool(
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
          const manager = await harvesterFactory.manager();
          expect(manager).to.equal(await user0.getAddress());

          // only manager should be able to call permissioned functions
          await expect(
            harvesterFactory.connect(gelato).upgradePools([harvester.address])
          ).to.be.reverted;
          await expect(
            harvesterFactory
              .connect(gelato)
              .upgradePoolsAndCall([harvester.address], ["0x"])
          ).to.be.reverted;
          await expect(
            harvesterFactory
              .connect(gelato)
              .makePoolsImmutable([harvester.address])
          ).to.be.reverted;
          await expect(
            harvesterFactory
              .connect(gelato)
              .setPoolImplementation(ethers.constants.AddressZero)
          ).to.be.reverted;

          const implementationBefore =
            await harvesterFactory.poolImplementation();
          expect(implementationBefore).to.equal(implementationAddress);
          await harvesterFactory.setPoolImplementation(
            ethers.constants.AddressZero
          );
          const implementationAfter =
            await harvesterFactory.poolImplementation();
          expect(implementationAfter).to.equal(ethers.constants.AddressZero);
          await harvesterFactory.upgradePools([harvester.address]);
          await expect(harvester.totalSupply()).to.be.reverted;
          const proxyAdmin = await harvesterFactory.getProxyAdmin(
            harvester.address
          );
          expect(proxyAdmin).to.equal(harvesterFactory.address);
          const isNotImmutable = await harvesterFactory.isPoolImmutable(
            harvester.address
          );
          expect(isNotImmutable).to.be.false;
          await harvesterFactory.makePoolsImmutable([harvester.address]);
          await expect(harvesterFactory.upgradePools([harvester.address])).to.be
            .reverted;
          const poolProxy = (await ethers.getContractAt(
            "EIP173Proxy",
            harvester.address
          )) as EIP173Proxy;
          await expect(
            poolProxy.connect(user0).upgradeTo(implementationAddress)
          ).to.be.reverted;
          const isImmutable = await harvesterFactory.isPoolImmutable(
            harvester.address
          );
          expect(isImmutable).to.be.true;
          await harvesterFactory.transferOwnership(await user1.getAddress());
          const manager2 = await harvesterFactory.manager();
          expect(manager2).to.equal(await user1.getAddress());
          await harvesterFactory.connect(user1).renounceOwnership();
          const manager3 = await harvesterFactory.manager();
          expect(manager3).to.equal(ethers.constants.AddressZero);
        });
      });
    });
  });
});
