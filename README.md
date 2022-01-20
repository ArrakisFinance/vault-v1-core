[![CircleCI](https://circleci.com/gh/gelatodigital/g-uni-v1-core/tree/master.svg?style=svg&circle-token=0a89a0c369a448314a37b2f2312cc1a3e5d3d4e8)](https://circleci.com/gh/gelatodigital/g-uni-v1-core/tree/master)
[![Coverage Status](https://coveralls.io/repos/github/gelatodigital/uni-v3-lp/badge.svg?branch=master&t=IlcAEC)](https://coveralls.io/github/gelatodigital/uni-v3-lp?branch=master)

# G-UNI v1 Core

A shared fungible (ERC20) position for Uniswap V3 passive liquidity providers. G-UNI pools are auto-compounded by gelato network to reinvest accrued fees into the position. The position bounds are static and immutable by default, unless creating a "managed" pool, in which case an `executiveRebalance` can be performed by the governance/manager account which will redeposit liquidity into a new range (see [docs](https://docs-g-uni.gelato.network) for more info).

## G-UNI Pool Overview

### mint

```
    function mint(uint256 mintAmount, address receiver)
        external
        nonReentrant
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityMinted
        )
```

Arguments:

- `mintAmount` amount of G-UNI tokens to mint
- `receiver` account that receives the G-UNI tokens

Returns:

- `amount0` amount of token0 actually deposited into G-UNI
- `amount1` amount of token1 actually deposited into G-UNI
- `liquidityMinted` amount of liqudiity added to G-UNI position

Note: to find out the amount of token0 and token1 you would owe by minting that many G-UNI tokens use getMintAmounts method.

### burn

```
    function burn(uint256 _burnAmount, address _receiver)
        external
        nonReentrant
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        )
```

Arguments:

- `_burnAmount` number of G-UNI tokens to burn
- `_receiver` account that receives the remitted token0 and token1

Returns:

- `amount0` amount of token0 remitted to \_receiver
- `amount1` amount of token1 remitted to \_receiver
- `liquidityBurned` amount of liquidity burned from G-UNI positon

### getMintAmounts (view call)

```
    function getMintAmounts(uint256 amount0Max, uint256 amount1Max)
        external
        view
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
```

Arguments:

- `amount0Max` maximum amount of token0 to deposit into G-UNI
- `amount1Max` maximum amount of token1 to deposit into G-UNI

Returns:

- `amount0` actual amount of token0 to deposit into G-UNI
- `amount1` actual amount of token1 to deposit into G-UNI
- `mintAmount` amount of G-UNI tokens to pass to mint function (will cost exactly `amount0` and `amount1`)

### rebalance

```
    function rebalance(
        uint160 _swapThresholdPrice,
        uint256 _swapAmountBPS,
        uint256 _feeAmount,
        address _paymentToken
    ) external gelatofy(_feeAmount, _paymentToken) {
```

Arguments:

- `_swapThresholdPrice` a sqrtPriceX96 which is used as the slippage parameter in uniswap v3 swaps.
- `_swapAmountBPS` amount to swap passed as basis points of current amount of leftover token held (e.g. "swap 50% of balance" would be a value of 5000)
- `_feeAmount` amount that gelato will take as a fee (`GelatoDiamond` checks against gas consumption so bot is not allowed to overcharge)
- `_paymentToken` the token in which `_feeAmount` is collected

Note: This method can only be called by gelato executors

### executiveRebalance (for managed pools)

If governance/admin wants to change bounds of the underlying position, or wants to force a rebalance for any other reason, they are allowed to call this executive rebalance function.

```
    function executiveRebalance(
        int24 _newLowerTick,
        int24 _newUpperTick,
        uint160 _swapThresholdPrice,
        uint256 _swapAmountBPS,
        bool _zeroForOne
    ) external onlyOwner {
```

Arguments:

- `_newLowerTick` the tick to use as position lower bound on reinvestment
- `_newUpperTick` the tick to use as position upper bound on reinvestment
- `_swapThresholdPrice` a sqrtPriceX96 which is used as the slippage parameter in uniswap v3 swaps.
- `_swapAmountBPS` amount to swap passed as basis points of current amount of leftover token held (e.g. "swap 50% of balance" would be a value of 5000)
- `_zeroForOne` which token to input into the swap (true = token0, false = token1)

# test

yarn

yarn test
