// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import {
    IUniswapV3MintCallback
} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol";
import {
    IUniswapV3SwapCallback
} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {GUniPoolStorage} from "./abstract/GUniPoolStorage.sol";
import {
    IUniswapV3Pool
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {TickMath} from "./vendor/uniswap/TickMath.sol";
import {
    IERC20,
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    FullMath,
    LiquidityAmounts
} from "./vendor/uniswap/LiquidityAmounts.sol";

contract GUniPool is
    IUniswapV3MintCallback,
    IUniswapV3SwapCallback,
    GUniPoolStorage
{
    using SafeERC20 for IERC20;
    using TickMath for int24;

    event Minted(
        address receiver,
        uint256 mintAmount,
        uint256 amount0In,
        uint256 amount1In,
        uint128 liquidityMinted
    );

    event Burned(
        address receiver,
        uint256 burnAmount,
        uint256 amount0Out,
        uint256 amount1Out,
        uint128 liquidityBurned
    );

    event Rebalance(
        int24 lowerTick_,
        int24 upperTick_,
        uint128 liquidityBefore,
        uint128 liquidityAfter
    );

    event FeesEarned(uint256 feesEarned0, uint256 feesEarned1);

    // solhint-disable-next-line max-line-length
    constructor(address payable _gelato) GUniPoolStorage(_gelato) {} // solhint-disable-line no-empty-blocks

    /// @notice Uniswap V3 callback fn, called back on pool.mint
    function uniswapV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata /*_data*/
    ) external override {
        require(msg.sender == address(pool), "callback caller");

        if (amount0Owed > 0) token0.safeTransfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) token1.safeTransfer(msg.sender, amount1Owed);
    }

    /// @notice Uniswap v3 callback fn, called back on pool.swap
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /*data*/
    ) external override {
        require(msg.sender == address(pool), "callback caller");

        if (amount0Delta > 0)
            token0.safeTransfer(msg.sender, uint256(amount0Delta));
        else if (amount1Delta > 0)
            token1.safeTransfer(msg.sender, uint256(amount1Delta));
    }

    // User functions => Should be called via a Router

    /// @notice mint fungible G-UNI tokens, fractional shares of a Uniswap V3 position
    /// @dev to compute the amouint of tokens necessary to mint `mintAmount` see getMintAmounts
    /// @param mintAmount The number of G-UNI tokens to mint
    /// @param receiver The account to receive the minted tokens
    /// @return amount0 amount of token0 transferred from msg.sender to mint `mintAmount`
    /// @return amount1 amount of token1 transferred from msg.sender to mint `mintAmount`
    /// @return liquidityMinted amount of liquidity added to the underlying Uniswap V3 position
    // solhint-disable-next-line function-max-lines, code-complexity
    function mint(uint256 mintAmount, address receiver)
        external
        nonReentrant
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityMinted
        )
    {
        require(mintAmount > 0, "mint 0");

        uint256 totalSupply = totalSupply();

        (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();

        if (totalSupply > 0) {
            (uint256 amount0Current, uint256 amount1Current) =
                getUnderlyingBalances();

            amount0 = FullMath.mulDivRoundingUp(
                amount0Current,
                mintAmount,
                totalSupply
            );
            amount1 = FullMath.mulDivRoundingUp(
                amount1Current,
                mintAmount,
                totalSupply
            );
        } else {
            // if supply is 0 mintAmount == liquidity to deposit
            (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
                sqrtRatioX96,
                lowerTick.getSqrtRatioAtTick(),
                upperTick.getSqrtRatioAtTick(),
                SafeCast.toUint128(mintAmount)
            );
        }

        // transfer amounts owed to contract
        if (amount0 > 0) {
            token0.safeTransferFrom(msg.sender, address(this), amount0);
        }
        if (amount1 > 0) {
            token1.safeTransferFrom(msg.sender, address(this), amount1);
        }

        // deposit as much new liquidity as possible
        liquidityMinted = LiquidityAmounts.getLiquidityForAmounts(
            sqrtRatioX96,
            lowerTick.getSqrtRatioAtTick(),
            upperTick.getSqrtRatioAtTick(),
            amount0,
            amount1
        );

        pool.mint(address(this), lowerTick, upperTick, liquidityMinted, "");

        _mint(receiver, mintAmount);
        emit Minted(receiver, mintAmount, amount0, amount1, liquidityMinted);
    }

    /// @notice burn G-UNI tokens (fractional shares of a Uniswap V3 position) and receive tokens
    /// @param burnAmount The number of G-UNI tokens to burn
    /// @param receiver The account to receive the underlying amounts of token0 and token1
    /// @return amount0 amount of token0 transferred to receiver for burning `burnAmount`
    /// @return amount1 amount of token1 transferred to receiver for burning `burnAmount`
    /// @return liquidityBurned amount of liquidity removed from the underlying Uniswap V3 position
    // solhint-disable-next-line function-max-lines
    function burn(uint256 burnAmount, address receiver)
        external
        nonReentrant
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        )
    {
        require(burnAmount > 0, "burn 0");

        uint256 totalSupply = totalSupply();

        (uint128 liquidity, , , , ) = pool.positions(_getPositionID());

        _burn(msg.sender, burnAmount);

        uint256 liquidityBurned_ =
            FullMath.mulDiv(burnAmount, liquidity, totalSupply);
        liquidityBurned = SafeCast.toUint128(liquidityBurned_);
        (uint256 burn0, uint256 burn1, uint256 fee0, uint256 fee1) =
            _withdraw(lowerTick, upperTick, liquidityBurned);
        _applyFees(fee0, fee1);
        (fee0, fee1) = _subtractAdminFees(fee0, fee1);
        emit FeesEarned(fee0, fee1);

        amount0 =
            burn0 +
            FullMath.mulDiv(
                token0.balanceOf(address(this)) -
                    burn0 -
                    managerBalance0 -
                    gelatoBalance0,
                burnAmount,
                totalSupply
            );
        amount1 =
            burn1 +
            FullMath.mulDiv(
                token1.balanceOf(address(this)) -
                    burn1 -
                    managerBalance1 -
                    gelatoBalance1,
                burnAmount,
                totalSupply
            );

        if (amount0 > 0) {
            token0.safeTransfer(receiver, amount0);
        }

        if (amount1 > 0) {
            token1.safeTransfer(receiver, amount1);
        }

        emit Burned(receiver, burnAmount, amount0, amount1, liquidityBurned);
    }

    // Manager Functions => Called by Pool Manager

    /// @notice Change the range of underlying UniswapV3 position, only manager can call
    /// @dev When changing the range the inventory of token0 and token1 may be rebalanced
    /// with a swap to deposit as much liquidity as possible into the new position. Swap parameters
    /// can be computed by simulating the whole operation: remove all liquidity, deposit as much
    /// as possible into new position, then observe how much of token0 or token1 is leftover.
    /// Swap a proportion of this leftover to deposit more liquidity into the position, since
    /// any leftover will be unused and sit idle until the next rebalance.
    /// @param newLowerTick The new lower bound of the position's range
    /// @param newUpperTick The new upper bound of the position's range
    /// @param swapThresholdPrice slippage parameter on the swap as a max or min sqrtPriceX96
    /// @param swapAmountBPS amount of token to swap as proportion of total. Pass 0 to ignore swap.
    /// @param zeroForOne Which token to input into the swap (true = token0, false = token1)
    // solhint-disable-next-line function-max-lines
    function executiveRebalance(
        int24 newLowerTick,
        int24 newUpperTick,
        uint160 swapThresholdPrice,
        uint256 swapAmountBPS,
        bool zeroForOne
    ) external onlyManager {
        uint128 liquidity;
        uint128 newLiquidity;
        if (totalSupply() > 0) {
            (liquidity, , , , ) = pool.positions(_getPositionID());
            if (liquidity > 0) {
                (, , uint256 fee0, uint256 fee1) =
                    _withdraw(lowerTick, upperTick, liquidity);

                _applyFees(fee0, fee1);
                (fee0, fee1) = _subtractAdminFees(fee0, fee1);
                emit FeesEarned(fee0, fee1);
            }

            lowerTick = newLowerTick;
            upperTick = newUpperTick;

            uint256 reinvest0 =
                token0.balanceOf(address(this)) -
                    managerBalance0 -
                    gelatoBalance0;
            uint256 reinvest1 =
                token1.balanceOf(address(this)) -
                    managerBalance1 -
                    gelatoBalance1;

            _deposit(
                newLowerTick,
                newUpperTick,
                reinvest0,
                reinvest1,
                swapThresholdPrice,
                swapAmountBPS,
                zeroForOne
            );

            (newLiquidity, , , , ) = pool.positions(_getPositionID());
            require(newLiquidity > 0, "new position 0");
        } else {
            lowerTick = newLowerTick;
            upperTick = newUpperTick;
        }

        emit Rebalance(newLowerTick, newUpperTick, liquidity, newLiquidity);
    }

    // Gelatofied functions => Automatically called by Gelato

    /// @notice Reinvest fees earned into underlying position, only gelato executors can call
    /// Position bounds CANNOT be altered by gelato, only manager may via executiveRebalance.
    /// Frequency of rebalance configured with gelatoRebalanceBPS, alterable by manager.
    function rebalance(
        uint160 swapThresholdPrice,
        uint256 swapAmountBPS,
        bool zeroForOne,
        uint256 feeAmount,
        address paymentToken
    ) external gelatofy(feeAmount, paymentToken) {
        if (swapAmountBPS > 0) {
            _checkSlippage(swapThresholdPrice, zeroForOne);
        }
        (uint128 liquidity, , , , ) = pool.positions(_getPositionID());
        _rebalance(
            liquidity,
            swapThresholdPrice,
            swapAmountBPS,
            zeroForOne,
            feeAmount,
            paymentToken
        );

        (uint128 newLiquidity, , , , ) = pool.positions(_getPositionID());
        require(newLiquidity > liquidity, "liquidity must increase");

        emit Rebalance(lowerTick, upperTick, liquidity, newLiquidity);
    }

    /// @notice withdraw manager fees accrued, only gelato executors can call.
    /// Target account to receive fees is managerTreasury, alterable by manager.
    /// Frequency of withdrawals configured with gelatoWithdrawBPS, alterable by manager.
    function withdrawManagerBalance(uint256 feeAmount, address feeToken)
        external
        gelatofy(feeAmount, feeToken)
    {
        (uint256 amount0, uint256 amount1) =
            _balancesToWithdraw(
                managerBalance0,
                managerBalance1,
                feeAmount,
                feeToken
            );

        managerBalance0 = 0;
        managerBalance1 = 0;

        if (amount0 > 0) {
            token0.safeTransfer(managerTreasury, amount0);
        }

        if (amount1 > 0) {
            token1.safeTransfer(managerTreasury, amount1);
        }
    }

    /// @notice withdraw gelato fees accrued, only gelato executors can call.
    /// Frequency of withdrawals configured with gelatoWithdrawBPS, alterable by manager.
    function withdrawGelatoBalance(uint256 feeAmount, address feeToken)
        external
        gelatofy(feeAmount, feeToken)
    {
        (uint256 amount0, uint256 amount1) =
            _balancesToWithdraw(
                gelatoBalance0,
                gelatoBalance1,
                feeAmount,
                feeToken
            );

        gelatoBalance0 = 0;
        gelatoBalance1 = 0;

        if (amount0 > 0) {
            token0.safeTransfer(GELATO, amount0);
        }

        if (amount1 > 0) {
            token1.safeTransfer(GELATO, amount1);
        }
    }

    function _balancesToWithdraw(
        uint256 balance0,
        uint256 balance1,
        uint256 feeAmount,
        address feeToken
    ) internal view returns (uint256 amount0, uint256 amount1) {
        if (feeToken == address(token0)) {
            require(
                (balance0 * gelatoWithdrawBPS) / 10000 >= feeAmount,
                "high fee"
            );
            amount0 = balance0 - feeAmount;
            amount1 = balance1;
        } else if (feeToken == address(token1)) {
            require(
                (balance1 * gelatoWithdrawBPS) / 10000 >= feeAmount,
                "high fee"
            );
            amount1 = balance1 - feeAmount;
            amount0 = balance0;
        } else {
            revert("wrong token");
        }
    }

    // View functions

    /// @notice compute maximum G-UNI tokens that can be minted from `amount0Max` and `amount1Max`
    /// @param amount0Max The maximum amount of token0 to forward on mint
    /// @param amount0Max The maximum amount of token1 to forward on mint
    /// @return amount0 actual amount of token0 to forward when minting `mintAmount`
    /// @return amount1 actual amount of token1 to forward when minting `mintAmount`
    /// @return mintAmount maximum number of G-UNI tokens to mint
    function getMintAmounts(uint256 amount0Max, uint256 amount1Max)
        external
        view
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        uint256 totalSupply = totalSupply();
        if (totalSupply > 0) {
            (amount0, amount1, mintAmount) = _computeMintAmounts(
                totalSupply,
                amount0Max,
                amount1Max
            );
        } else {
            (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
            uint128 newLiquidity =
                LiquidityAmounts.getLiquidityForAmounts(
                    sqrtRatioX96,
                    lowerTick.getSqrtRatioAtTick(),
                    upperTick.getSqrtRatioAtTick(),
                    amount0Max,
                    amount1Max
                );
            mintAmount = uint256(newLiquidity);
            (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
                sqrtRatioX96,
                lowerTick.getSqrtRatioAtTick(),
                upperTick.getSqrtRatioAtTick(),
                newLiquidity
            );
        }
    }

    /// @notice compute total underlying holdings of the G-UNI token supply
    /// includes current liquidity invested in uniswap position, current fees earned
    /// and any uninvested leftover (but does not include manager or gelato fees accrued)
    /// @return amount0Current current total underlying balance of token0
    /// @return amount1Current current total underlying balance of token1
    function getUnderlyingBalances()
        public
        view
        returns (uint256 amount0Current, uint256 amount1Current)
    {
        (uint160 sqrtRatioX96, int24 tick, , , , , ) = pool.slot0();
        return _getUnderlyingBalances(sqrtRatioX96, tick);
    }

    function getUnderlyingBalancesAtPrice(uint160 sqrtRatioX96)
        external
        view
        returns (uint256 amount0Current, uint256 amount1Current)
    {
        (, int24 tick, , , , , ) = pool.slot0();
        return _getUnderlyingBalances(sqrtRatioX96, tick);
    }

    // solhint-disable-next-line function-max-lines
    function _getUnderlyingBalances(uint160 sqrtRatioX96, int24 tick)
        internal
        view
        returns (uint256 amount0Current, uint256 amount1Current)
    {
        (
            uint128 liquidity,
            uint256 feeGrowthInside0Last,
            uint256 feeGrowthInside1Last,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = pool.positions(_getPositionID());

        // compute current holdings from liquidity
        (amount0Current, amount1Current) = LiquidityAmounts
            .getAmountsForLiquidity(
            sqrtRatioX96,
            lowerTick.getSqrtRatioAtTick(),
            upperTick.getSqrtRatioAtTick(),
            liquidity
        );

        // compute current fees earned
        uint256 fee0 =
            _computeFeesEarned(true, feeGrowthInside0Last, tick, liquidity) +
                uint256(tokensOwed0);
        uint256 fee1 =
            _computeFeesEarned(false, feeGrowthInside1Last, tick, liquidity) +
                uint256(tokensOwed1);

        (fee0, fee1) = _subtractAdminFees(fee0, fee1);

        // add any leftover in contract to current holdings
        amount0Current +=
            fee0 +
            token0.balanceOf(address(this)) -
            managerBalance0 -
            gelatoBalance0;
        amount1Current +=
            fee1 +
            token1.balanceOf(address(this)) -
            managerBalance1 -
            gelatoBalance1;
    }

    // Private functions

    // solhint-disable-next-line function-max-lines
    function _rebalance(
        uint128 liquidity,
        uint160 swapThresholdPrice,
        uint256 swapAmountBPS,
        bool zeroForOne,
        uint256 feeAmount,
        address paymentToken
    ) private {
        uint256 leftover0 =
            token0.balanceOf(address(this)) - managerBalance0 - gelatoBalance0;
        uint256 leftover1 =
            token1.balanceOf(address(this)) - managerBalance1 - gelatoBalance1;

        (, , uint256 feesEarned0, uint256 feesEarned1) =
            _withdraw(lowerTick, upperTick, liquidity);
        _applyFees(feesEarned0, feesEarned1);
        (feesEarned0, feesEarned1) = _subtractAdminFees(
            feesEarned0,
            feesEarned1
        );
        emit FeesEarned(feesEarned0, feesEarned1);
        feesEarned0 += leftover0;
        feesEarned1 += leftover1;

        if (paymentToken == address(token0)) {
            require(
                (feesEarned0 * gelatoRebalanceBPS) / 10000 >= feeAmount,
                "high fee"
            );
            leftover0 =
                token0.balanceOf(address(this)) -
                managerBalance0 -
                gelatoBalance0 -
                feeAmount;
            leftover1 =
                token1.balanceOf(address(this)) -
                managerBalance1 -
                gelatoBalance1;
        } else if (paymentToken == address(token1)) {
            require(
                (feesEarned1 * gelatoRebalanceBPS) / 10000 >= feeAmount,
                "high fee"
            );
            leftover0 =
                token0.balanceOf(address(this)) -
                managerBalance0 -
                gelatoBalance0;
            leftover1 =
                token1.balanceOf(address(this)) -
                managerBalance1 -
                gelatoBalance1 -
                feeAmount;
        } else {
            revert("wrong token");
        }

        _deposit(
            lowerTick,
            upperTick,
            leftover0,
            leftover1,
            swapThresholdPrice,
            swapAmountBPS,
            zeroForOne
        );
    }

    // solhint-disable-next-line function-max-lines
    function _withdraw(
        int24 lowerTick_,
        int24 upperTick_,
        uint128 liquidity
    )
        private
        returns (
            uint256 burn0,
            uint256 burn1,
            uint256 fee0,
            uint256 fee1
        )
    {
        uint256 preBalance0 = token0.balanceOf(address(this));
        uint256 preBalance1 = token1.balanceOf(address(this));

        (burn0, burn1) = pool.burn(lowerTick_, upperTick_, liquidity);

        pool.collect(
            address(this),
            lowerTick_,
            upperTick_,
            type(uint128).max,
            type(uint128).max
        );

        fee0 = token0.balanceOf(address(this)) - preBalance0 - burn0;
        fee1 = token1.balanceOf(address(this)) - preBalance1 - burn1;
    }

    // solhint-disable-next-line function-max-lines
    function _deposit(
        int24 lowerTick_,
        int24 upperTick_,
        uint256 amount0,
        uint256 amount1,
        uint160 swapThresholdPrice,
        uint256 swapAmountBPS,
        bool zeroForOne
    ) private {
        (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
        // First, deposit as much as we can
        uint128 baseLiquidity =
            LiquidityAmounts.getLiquidityForAmounts(
                sqrtRatioX96,
                lowerTick_.getSqrtRatioAtTick(),
                upperTick_.getSqrtRatioAtTick(),
                amount0,
                amount1
            );
        if (baseLiquidity > 0) {
            (uint256 amountDeposited0, uint256 amountDeposited1) =
                pool.mint(
                    address(this),
                    lowerTick_,
                    upperTick_,
                    baseLiquidity,
                    ""
                );

            amount0 -= amountDeposited0;
            amount1 -= amountDeposited1;
        }
        int256 swapAmount =
            SafeCast.toInt256(
                ((zeroForOne ? amount0 : amount1) * swapAmountBPS) / 10000
            );
        if (swapAmount > 0) {
            _swapAndDeposit(
                lowerTick_,
                upperTick_,
                amount0,
                amount1,
                swapAmount,
                swapThresholdPrice,
                zeroForOne
            );
        }
    }

    function _swapAndDeposit(
        int24 lowerTick_,
        int24 upperTick_,
        uint256 amount0,
        uint256 amount1,
        int256 swapAmount,
        uint160 swapThresholdPrice,
        bool zeroForOne
    ) private returns (uint256 finalAmount0, uint256 finalAmount1) {
        (int256 amount0Delta, int256 amount1Delta) =
            pool.swap(
                address(this),
                zeroForOne,
                swapAmount,
                swapThresholdPrice,
                ""
            );
        finalAmount0 = uint256(SafeCast.toInt256(amount0) - amount0Delta);
        finalAmount1 = uint256(SafeCast.toInt256(amount1) - amount1Delta);

        // Add liquidity a second time
        (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
        uint128 liquidityAfterSwap =
            LiquidityAmounts.getLiquidityForAmounts(
                sqrtRatioX96,
                lowerTick_.getSqrtRatioAtTick(),
                upperTick_.getSqrtRatioAtTick(),
                finalAmount0,
                finalAmount1
            );
        if (liquidityAfterSwap > 0) {
            pool.mint(
                address(this),
                lowerTick_,
                upperTick_,
                liquidityAfterSwap,
                ""
            );
        }
    }

    // solhint-disable-next-line function-max-lines, code-complexity
    function _computeMintAmounts(
        uint256 totalSupply,
        uint256 amount0Max,
        uint256 amount1Max
    )
        private
        view
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        (uint256 amount0Current, uint256 amount1Current) =
            getUnderlyingBalances();

        // compute proportional amount of tokens to mint
        if (amount0Current == 0 && amount1Current > 0) {
            mintAmount = FullMath.mulDiv(
                amount1Max,
                totalSupply,
                amount1Current
            );
        } else if (amount1Current == 0 && amount0Current > 0) {
            mintAmount = FullMath.mulDiv(
                amount0Max,
                totalSupply,
                amount0Current
            );
        } else if (amount0Current == 0 && amount1Current == 0) {
            revert("");
        } else {
            // only if both are non-zero
            uint256 amount0Mint =
                FullMath.mulDiv(amount0Max, totalSupply, amount0Current);
            uint256 amount1Mint =
                FullMath.mulDiv(amount1Max, totalSupply, amount1Current);
            require(amount0Mint > 0 && amount1Mint > 0, "mint 0");

            mintAmount = amount0Mint < amount1Mint ? amount0Mint : amount1Mint;
        }

        // compute amounts owed to contract
        amount0 = FullMath.mulDivRoundingUp(
            mintAmount,
            amount0Current,
            totalSupply
        );
        amount1 = FullMath.mulDivRoundingUp(
            mintAmount,
            amount1Current,
            totalSupply
        );
    }

    // solhint-disable-next-line function-max-lines
    function _computeFeesEarned(
        bool isZero,
        uint256 feeGrowthInsideLast,
        int24 tick,
        uint128 liquidity
    ) private view returns (uint256 fee) {
        uint256 feeGrowthOutsideLower;
        uint256 feeGrowthOutsideUpper;
        uint256 feeGrowthGlobal;
        if (isZero) {
            feeGrowthGlobal = pool.feeGrowthGlobal0X128();
            (, , feeGrowthOutsideLower, , , , , ) = pool.ticks(lowerTick);
            (, , feeGrowthOutsideUpper, , , , , ) = pool.ticks(upperTick);
        } else {
            feeGrowthGlobal = pool.feeGrowthGlobal1X128();
            (, , , feeGrowthOutsideLower, , , , ) = pool.ticks(lowerTick);
            (, , , feeGrowthOutsideUpper, , , , ) = pool.ticks(upperTick);
        }

        unchecked {
            // calculate fee growth below
            uint256 feeGrowthBelow;
            if (tick >= lowerTick) {
                feeGrowthBelow = feeGrowthOutsideLower;
            } else {
                feeGrowthBelow = feeGrowthGlobal - feeGrowthOutsideLower;
            }

            // calculate fee growth above
            uint256 feeGrowthAbove;
            if (tick < upperTick) {
                feeGrowthAbove = feeGrowthOutsideUpper;
            } else {
                feeGrowthAbove = feeGrowthGlobal - feeGrowthOutsideUpper;
            }

            uint256 feeGrowthInside =
                feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove;
            fee = FullMath.mulDiv(
                liquidity,
                feeGrowthInside - feeGrowthInsideLast,
                0x100000000000000000000000000000000
            );
        }
    }

    function _applyFees(uint256 _fee0, uint256 _fee1) private {
        gelatoBalance0 += (_fee0 * gelatoFeeBPS) / 10000;
        gelatoBalance1 += (_fee1 * gelatoFeeBPS) / 10000;
        managerBalance0 += (_fee0 * managerFeeBPS) / 10000;
        managerBalance1 += (_fee1 * managerFeeBPS) / 10000;
    }

    function _subtractAdminFees(uint256 rawFee0, uint256 rawFee1)
        private
        view
        returns (uint256 fee0, uint256 fee1)
    {
        uint256 deduct0 = (rawFee0 * (gelatoFeeBPS + managerFeeBPS)) / 10000;
        uint256 deduct1 = (rawFee1 * (gelatoFeeBPS + managerFeeBPS)) / 10000;
        fee0 = rawFee0 - deduct0;
        fee1 = rawFee1 - deduct1;
    }

    function _checkSlippage(uint160 swapThresholdPrice, bool zeroForOne)
        private
        view
    {
        uint32[] memory secondsAgo = new uint32[](2);
        secondsAgo[0] = gelatoSlippageInterval;
        secondsAgo[1] = 0;

        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgo);

        require(tickCumulatives.length == 2, "array len");
        uint160 avgSqrtRatioX96;
        unchecked {
            int24 avgTick =
                int24(
                    (tickCumulatives[1] - tickCumulatives[0]) /
                        int56(uint56(gelatoSlippageInterval))
                );
            avgSqrtRatioX96 = avgTick.getSqrtRatioAtTick();
        }

        uint160 maxSlippage = (avgSqrtRatioX96 * gelatoSlippageBPS) / 10000;
        if (zeroForOne) {
            require(
                swapThresholdPrice >= avgSqrtRatioX96 - maxSlippage,
                "high slippage"
            );
        } else {
            require(
                swapThresholdPrice <= avgSqrtRatioX96 + maxSlippage,
                "high slippage"
            );
        }
    }
}
