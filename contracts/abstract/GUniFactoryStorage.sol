//SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import {OwnableUninitialized} from "./OwnableUninitialized.sol";
import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    EnumerableSet
} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

// solhint-disable-next-line max-states-count
contract GUniFactoryStorage is
    OwnableUninitialized, /* XXXX DONT MODIFY ORDERING XXXX */
    Initializable
    // APPEND ADDITIONAL BASE WITH STATE VARS BELOW:
    // XXXX DONT MODIFY ORDERING XXXX
{
    // XXXXXXXX DO NOT MODIFY ORDERING XXXXXXXX
    // solhint-disable-next-line const-name-snakecase
    string public constant version = "1.0.0";
    address public immutable factory;
    address public poolImplementation;
    address public gelatoDeployer;
    EnumerableSet.AddressSet internal _deployers;
    mapping(address => EnumerableSet.AddressSet) internal _pools;
    // APPPEND ADDITIONAL STATE VARS BELOW:
    // XXXXXXXX DO NOT MODIFY ORDERING XXXXXXXX

    event UpdatePoolImplementation(
        address previousImplementation,
        address newImplementation
    );

    event UpdateGelatoDeployer(
        address previosGelatoDeployer,
        address newGelatoDeployer
    );

    constructor(address _uniswapV3Factory) {
        factory = _uniswapV3Factory;
    }

    function initialize(
        address _implementation,
        address _gelatoDeployer,
        address _manager_
    ) external initializer {
        poolImplementation = _implementation;
        gelatoDeployer = _gelatoDeployer;
        _manager = _manager_;
    }

    function setPoolImplementation(address nextImplementation)
        external
        onlyManager
    {
        emit UpdatePoolImplementation(poolImplementation, nextImplementation);
        poolImplementation = nextImplementation;
    }

    function setGelatoDeployer(address nextGelatoDeployer)
        external
        onlyManager
    {
        emit UpdateGelatoDeployer(gelatoDeployer, nextGelatoDeployer);
        gelatoDeployer = nextGelatoDeployer;
    }
}
