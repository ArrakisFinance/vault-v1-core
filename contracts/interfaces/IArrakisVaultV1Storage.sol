// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

interface IArrakisVaultV1Storage {
    function initialize(
        string memory _name,
        string memory _symbol,
        address _pool,
        uint16 _managerFeeBPS,
        int24 _lowerTick,
        int24 _upperTick,
        address _manager_
    ) external;
}
