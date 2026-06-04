# ⚠️ DEPRECATED

**This repository is no longer maintained.** The Arrakis V1 vault contracts
remain deployed and immutable on-chain, but this codebase is frozen and will
receive no further updates, fixes, or security patches.

For current Arrakis liquidity-management contracts, see
**[arrakis-modular](https://github.com/ArrakisFinance/arrakis-modular)**.

---

# Vault V1 Core

A shared fungible (ERC20) Uniswap V3 Liquidity Position for liquidity aggregation, management and optimization. ArrakisVaultV1 earned fees are auto-compounded by Gelato Network keepers, intermittently harvesting and reinvesting the earnings into the liquidity position. For vaults with a `manager` role set, manager may call `executiveRebalance` which will adjust the price range within which vault liquidity is deployed to the underlying Uniswap V3 pool.

Vaults can be permissionlessly deployed and managed by anyone on any existing Uniswap V3 pair, via the ArrakisFactoryV1 contract. Due to sensitivity of the `manager` role, only vaults explicitly under Arrakis DAO management or without any manager can be safely trusted, in the absence of further information.

(see [docs](https://docs.arrakis.fi/developer-docs) for more info)

# test

yarn

yarn compile

yarn test
