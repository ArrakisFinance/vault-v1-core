# Vault V1 Core

A shared fungible (ERC20) position for Uniswap V3 passive liquidity providers. ArrakisVaultV1 is auto-compounded by gelato network to reinvest accrued fees into the position. The position bounds are static and immutable by default, unless creating a "managed" pool, in which case an `executiveRebalance` can be performed by the governance/manager account which will redeposit liquidity into a new range (see [docs](https://docs-g-uni.gelato.network) for more info).

# test

yarn

yarn test
