// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

interface IEIP173Proxy {
    function proxyAdmin() external view returns (address);

    function transferProxyAdmin(address newAdmin) external;

    function upgradeTo(address newImplementation) external;

    function upgradeToAndCall(address newImplementation, bytes calldata data)
        external
        payable;
}
