// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {
    IERC20,
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev DO NOT ADD STATE VARIABLES - APPEND THEM TO GelatoUniV3PoolStorage
/// @dev DO NOT ADD BASE CONTRACTS WITH STATE VARS - APPEND THEM TO GelatoUniV3PoolStorage
abstract contract Gelatofied {
    using Address for address payable;
    using SafeERC20 for IERC20;

    // solhint-disable-next-line var-name-mixedcase
    address payable public immutable GELATO;

    address private constant _ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    constructor(address payable _gelato) {
        GELATO = _gelato;
    }

    modifier gelatofy(uint256 _amount, address _paymentToken) {
        require(msg.sender == GELATO, "Gelatofied: Only gelato");
        _;
        if (_paymentToken == _ETH) GELATO.sendValue(_amount);
        else IERC20(_paymentToken).safeTransfer(GELATO, _amount);
    }
}
