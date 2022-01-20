//SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import {
    IUniswapV3Factory
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3TickSpacing} from "./interfaces/IUniswapV3TickSpacing.sol";
import {IHarvesterV1Factory} from "./interfaces/IHarvesterV1Factory.sol";
import {IHarvesterV1Storage} from "./interfaces/IHarvesterV1Storage.sol";
import {
    HarvesterV1FactoryStorage
} from "./abstract/HarvesterV1FactoryStorage.sol";
import {EIP173Proxy} from "./vendor/proxy/EIP173Proxy.sol";
import {IEIP173Proxy} from "./interfaces/IEIP173Proxy.sol";
import {
    IERC20Metadata
} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {
    EnumerableSet
} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract HarvesterV1Factory is HarvesterV1FactoryStorage, IHarvesterV1Factory {
    using EnumerableSet for EnumerableSet.AddressSet;

    constructor(address _uniswapV3Factory)
        HarvesterV1FactoryStorage(_uniswapV3Factory)
    {} // solhint-disable-line no-empty-blocks

    /// @notice deployHarvester creates a new instance of a Harvester on a specified
    /// UniswapV3Pool. The msg.sender is the initial manager of the pool and will
    /// forever be associated with the Harvester as it's `deployer`
    /// @param tokenA one of the tokens in the uniswap pair
    /// @param tokenB the other token in the uniswap pair
    /// @param uniFee fee tier of the uniswap pair
    /// @param managerFee proportion of earned fees that go to pool manager in Basis Points
    /// @param lowerTick initial lower bound of the Uniswap V3 position
    /// @param upperTick initial upper bound of the Uniswap V3 position
    /// @return pool the address of the newly created Harvester (proxy)
    function deployHarvester(
        address tokenA,
        address tokenB,
        uint24 uniFee,
        uint16 managerFee,
        int24 lowerTick,
        int24 upperTick
    ) external override returns (address pool) {
        return
            _deployHarvester(
                tokenA,
                tokenB,
                uniFee,
                managerFee,
                lowerTick,
                upperTick,
                msg.sender
            );
    }

    /// @notice deployStaticHarvester creates a new instance of a Harvester on a specified
    /// UniswapV3Pool. Here the manager role is immediately burned, however msg.sender will still
    /// forever be associated with the Harvester as it's `deployer`
    /// @param tokenA one of the tokens in the uniswap pair
    /// @param tokenB the other token in the uniswap pair
    /// @param uniFee fee tier of the uniswap pair
    /// @param lowerTick initial lower bound of the Uniswap V3 position
    /// @param upperTick initial upper bound of the Uniswap V3 position
    /// @return pool the address of the newly created Harvester (proxy)
    function deployStaticHarvester(
        address tokenA,
        address tokenB,
        uint24 uniFee,
        int24 lowerTick,
        int24 upperTick
    ) external override returns (address pool) {
        return
            _deployHarvester(
                tokenA,
                tokenB,
                uniFee,
                0,
                lowerTick,
                upperTick,
                address(0)
            );
    }

    function _deployHarvester(
        address tokenA,
        address tokenB,
        uint24 uniFee,
        uint16 managerFee,
        int24 lowerTick,
        int24 upperTick,
        address manager
    ) internal returns (address pool) {
        (address token0, address token1) = _getTokenOrder(tokenA, tokenB);

        pool = address(new EIP173Proxy(poolImplementation, address(this), ""));

        string memory name = "Arrakis Harvester";
        try this.getTokenName(token0, token1) returns (string memory result) {
            name = result;
        } catch {} // solhint-disable-line no-empty-blocks

        address uniPool =
            IUniswapV3Factory(factory).getPool(token0, token1, uniFee);
        require(uniPool != address(0), "uniswap pool does not exist");
        require(
            _validateTickSpacing(uniPool, lowerTick, upperTick),
            "tickSpacing mismatch"
        );

        IHarvesterV1Storage(pool).initialize(
            name,
            string(abi.encodePacked("RAKIS-", _uint2str(index + 1))),
            uniPool,
            managerFee,
            lowerTick,
            upperTick,
            manager
        );
        _deployers.add(msg.sender);
        _pools[msg.sender].add(pool);
        index += 1;
        emit PoolCreated(uniPool, manager, pool);
    }

    function _validateTickSpacing(
        address uniPool,
        int24 lowerTick,
        int24 upperTick
    ) internal view returns (bool) {
        int24 spacing = IUniswapV3TickSpacing(uniPool).tickSpacing();
        return
            lowerTick < upperTick &&
            lowerTick % spacing == 0 &&
            upperTick % spacing == 0;
    }

    function getTokenName(address token0, address token1)
        external
        view
        returns (string memory)
    {
        string memory symbol0 = IERC20Metadata(token0).symbol();
        string memory symbol1 = IERC20Metadata(token1).symbol();

        return _append("Arrakis Harvester ", symbol0, "/", symbol1);
    }

    function upgradePools(address[] memory pools) external onlyManager {
        for (uint256 i = 0; i < pools.length; i++) {
            IEIP173Proxy(pools[i]).upgradeTo(poolImplementation);
        }
    }

    function upgradePoolsAndCall(address[] memory pools, bytes[] calldata datas)
        external
        onlyManager
    {
        require(pools.length == datas.length, "mismatching array length");
        for (uint256 i = 0; i < pools.length; i++) {
            IEIP173Proxy(pools[i]).upgradeToAndCall(
                poolImplementation,
                datas[i]
            );
        }
    }

    function makePoolsImmutable(address[] memory pools) external onlyManager {
        for (uint256 i = 0; i < pools.length; i++) {
            IEIP173Proxy(pools[i]).transferProxyAdmin(address(0));
        }
    }

    /// @notice isPoolImmutable checks if a certain Harvester is "immutable" i.e. that the
    /// proxyAdmin is the zero address and thus the underlying implementation cannot be upgraded
    /// @param pool address of the Harvester
    /// @return bool signaling if pool is immutable (true) or not (false)
    function isPoolImmutable(address pool) external view returns (bool) {
        return address(0) == getProxyAdmin(pool);
    }

    /// @notice getGelatoPools gets all the Harvesters deployed by Gelato's
    /// default deployer address (since anyone can deploy and manage Harvesters)
    /// @return list of Gelato managed Harvester addresses
    function getGelatoPools() external view returns (address[] memory) {
        return getPools(gelatoDeployer);
    }

    /// @notice getDeployers fetches all addresses that have deployed a Harvester
    /// @return deployers the list of deployer addresses
    function getDeployers() public view returns (address[] memory) {
        uint256 length = numDeployers();
        address[] memory deployers = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            deployers[i] = _getDeployer(i);
        }

        return deployers;
    }

    /// @notice getPools fetches all the Harvester addresses deployed by `deployer`
    /// @param deployer address that has potentially deployed Harvesters (can return empty array)
    /// @return pools the list of Harvester addresses deployed by `deployer`
    function getPools(address deployer) public view returns (address[] memory) {
        uint256 length = numPools(deployer);
        address[] memory pools = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            pools[i] = _getPool(deployer, i);
        }

        return pools;
    }

    /// @notice numPools counts the total number of Harvesters in existence
    /// @return result total number of Harvesters deployed
    function numPools() public view returns (uint256 result) {
        address[] memory deployers = getDeployers();
        for (uint256 i = 0; i < deployers.length; i++) {
            result += numPools(deployers[i]);
        }
    }

    /// @notice numDeployers counts the total number of Harvester deployer addresses
    /// @return total number of Harvester deployer addresses
    function numDeployers() public view returns (uint256) {
        return _deployers.length();
    }

    /// @notice numPools counts the total number of Harvesters deployed by `deployer`
    /// @param deployer deployer address
    /// @return total number of Harvesters deployed by `deployer`
    function numPools(address deployer) public view returns (uint256) {
        return _pools[deployer].length();
    }

    /// @notice getProxyAdmin gets the current address who controls the underlying implementation
    /// of a Harvester. For most all pools either this contract address or the zero address will
    /// be the proxyAdmin. If the admin is the zero address the pool's implementation is naturally
    /// no longer upgradable (no one owns the zero address).
    /// @param pool address of the Harvester
    /// @return address that controls the Harvester implementation (has power to upgrade it)
    function getProxyAdmin(address pool) public view returns (address) {
        return IEIP173Proxy(pool).proxyAdmin();
    }

    function _getDeployer(uint256 index) internal view returns (address) {
        return _deployers.at(index);
    }

    function _getPool(address deployer, uint256 index)
        internal
        view
        returns (address)
    {
        return _pools[deployer].at(index);
    }

    function _getTokenOrder(address tokenA, address tokenB)
        internal
        pure
        returns (address token0, address token1)
    {
        require(tokenA != tokenB, "same token");
        (token0, token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(token0 != address(0), "no address zero");
    }

    function _append(
        string memory a,
        string memory b,
        string memory c,
        string memory d
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b, c, d));
    }

    function _uint2str(uint256 _i)
        internal
        pure
        returns (string memory _uintAsString)
    {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (_i != 0) {
            k = k - 1;
            uint8 temp = (48 + uint8(_i - (_i / 10) * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }
}
