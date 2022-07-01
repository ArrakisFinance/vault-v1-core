#!/usr/bin/env python

import requests
import math
import argparse
import datetime
import logging

def query_univ3_graph(query: str, variables=None, network='mainnet') -> dict:
    
    if network == 'mainnet':
        univ3_graph_url = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3'
    elif network == 'arbitrum':
        univ3_graph_url = 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-arbitrum-one'
    elif network == 'matic':
        univ3_graph_url = 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-polygon'
        
    if variables:
        params = {'query': query, 'variables': variables}
    else:
        params = {'query': query}
    
    response = requests.post(univ3_graph_url, json=params)
    if response.status_code != 200:
      logging.warning("retrying")
      return query_univ3_graph(query, variables, network)
    return response.json()

def getPoolParams(pool, network):

    query = f"""
    {{
    pool(id:"{pool}") {{
        feeTier,
        sqrtPrice,
        token0 {{
        symbol
        decimals
        }}
        token1 {{
        symbol
        decimals
        }}
    }}
    }}
    """

    result = query_univ3_graph(query,network=network)

    feeTier = int(result['data']['pool']['feeTier'])
    sqrtPrice = int(result['data']['pool']['sqrtPrice'])
    token0 = result['data']['pool']['token0']['symbol']
    decimals0 = int(result['data']['pool']['token0']['decimals'])
    token1 = result['data']['pool']['token1']['symbol']
    decimals1 = int(result['data']['pool']['token1']['decimals'])
    price = sqrtPrice ** 2 / 2 ** 192
    tickSpacing = int(2 * feeTier / 100)
    logging.info(f"token0: {token0}, decimals: {decimals0} token1: {token1}, decimals: {decimals1} Fee Tier: {feeTier/10000} Price: {price} Tick Spacing: {tickSpacing}")
    return [feeTier, token0, decimals0, token1, decimals1, price, tickSpacing]

def getPriceAtTime(pool, network, timestamp, decimals0, decimals1):

    query = f"""
    {{
        poolDayDatas(first: 1, orderDirection: desc, orderBy: date, where: {{
            pool: "{pool}",
            date_lte: {timestamp}
        }} ) {{
            sqrtPrice
        }}
    }}
    """

    result = query_univ3_graph(query,network=network)
    sqrtPrice = int(result['data']['poolDayDatas'][0]['sqrtPrice'])
    price = sqrtPrice ** 2 / 2 ** 192
    return price

def fetchMints(pool, network):
    query = f"""
    {{
    mints(first:1,where:{{pool:"{pool}"}},orderBy:id,orderDirection:asc) {{
        id
        timestamp
        amount
        tickLower
        tickUpper
    }}
    }}
    """

    mints = []

    result = query_univ3_graph(query,network=network)

    mints.append(result['data']['mints'][0])

    mint_id = mints[0]['id']

    query = query.replace("mints(first:1,where:{","mints(first:1000,where:{id_gt:$paginateId,")

    finished = False

    while not finished:

        result = query_univ3_graph(
            query
                .replace("$paginateId",f"\"{mint_id}\""),
            network=network
            )
        
        if 'data' not in result:
            logging.warning("Retrying due to missing data")
            # retry
            continue
        response = result['data']['mints']

        if len(response) == 0:
            finished = True
        else:
            mint_id = response[-1]['id']
            mints += response

    logging.debug(len(mints))

    return mints

def fetchBurns(pool, network):
    query = f"""
    {{
    burns(first:1,where:{{pool:"{pool}"}},orderBy:id,orderDirection:asc) {{
        id
        timestamp
        amount
        tickLower
        tickUpper
    }}
    }}
    """

    burns = []

    result = query_univ3_graph(query,network=network)

    burns.append(result['data']['burns'][0])

    burn_id = burns[0]['id']

    query = query.replace("burns(first:1,where:{","burns(first:1000,where:{id_gt:$paginateId,")

    finished = False

    while not finished:

        result = query_univ3_graph(
            query
                .replace("$paginateId",f"\"{burn_id}\""),
            network=network
            )
        
        if 'data' not in result:
            logging.warning("Retrying due to missing data")
            # retry
            continue
        response = result['data']['burns']

        if len(response) == 0:
            finished = True
        else:
            burn_id = response[-1]['id']
            burns += response

    logging.debug(len(burns))
    return burns

def mergeMintsBurns(mints, burns, timelimit):
    
    positions = {}

    # Fill in all the positions that were minted up to the timelimit
    for mint in mints:
        if int(mint['timestamp']) <= timelimit:
            if str(mint['tickLower']) in positions:
                if str(mint['tickUpper']) in positions[str(mint['tickLower'])]:
                    positions[str(mint['tickLower'])][str(mint['tickUpper'])] += int(mint['amount'])
                else:
                    positions[str(mint['tickLower'])][str(mint['tickUpper'])] = int(mint['amount'])
            else:
                positions[str(mint['tickLower'])] = {}
                positions[str(mint['tickLower'])][str(mint['tickUpper'])] = int(mint['amount'])

    # Apply all of the burns to these positions up to the timelimit
    for burn in burns:
        if int(burn['timestamp']) <= timelimit:
            if str(burn['tickLower']) in positions:
                if str(burn['tickUpper']) in positions[str(burn['tickLower'])]:
                    positions[str(burn['tickLower'])][str(burn['tickUpper'])] -= int(burn['amount'])
                else:
                    # Can't burn a position that didn't exist
                    assert("THIS SHOULD NEVER HAPPEN")
            else:
                # Can't burn a position that didn't exist
                assert("THIS SHOULD NEVER HAPPEN")

    # Cleanup the empty positions
    count = 0
    for tickLower in list(positions):
        for tickUpper in list(positions[tickLower]):
            if positions[tickLower][tickUpper] == 0:
                del positions[tickLower][tickUpper]
            else:
                # Make sure the amount is positive
                assert(positions[tickLower][tickUpper] > 0)
                count += 1
            if len(positions[tickLower]) == 0:
                del positions[tickLower]

    logging.debug(count)
    return positions

def getLiquidity(positions,tickSpacing):
    # Generate the full liquidity
    liquidity = {}
    for tickLower in list(positions):
        for tickUpper in list(positions[tickLower]):
            assert(int(tickLower) < int(tickUpper))
            for tick in range(int(tickLower),int(tickUpper)+1,tickSpacing):
                if str(tick) in liquidity:
                    liquidity[str(tick)] += positions[tickLower][tickUpper]
                else:
                    liquidity[str(tick)] = positions[tickLower][tickUpper]
    liquidity = dict(sorted(liquidity.items(), key=lambda x: int(x[0])))

    return liquidity

def sellY(y_to_sell, token0, decimals0, token1, decimals1, feeTier, price, liquidity, date):

    logging.debug(f"Selling: {y_to_sell} {token1}")

    fee = y_to_sell * feeTier / 1000000
    y_to_sell -= fee

    start = 0
    ticks = list(liquidity.keys())
    bought = 0
    spent = 0
    for i in range(1,len(ticks)):
        if liquidity[ticks[start]] != liquidity[ticks[i]]:
            lower = 1.0001 ** int(ticks[start])
            upper = 1.0001 ** int(ticks[i])
            if price >= upper:
                pass
            elif price <= lower:
                amountX = liquidity[ticks[start]] * (upper ** 0.5 - lower ** 0.5) / (upper ** 0.5) / (lower ** 0.5) / (10 ** decimals0)
                assert(amountX > 0)

                # How much Y can be put in the range?
                capacityY = liquidity[ticks[start]] * (upper ** 0.5 - lower ** 0.5) / (10 ** decimals1)

                # Should we only buy up to the amount remaining?
                delta = y_to_sell - spent
                if capacityY > delta:

                    spent += delta

                    # The amount of Y in the range is what we spent
                    newY = delta

                    # At what price does this new Y happen?
                    p = (newY * (10 ** decimals1) / liquidity[ticks[start]] + lower ** 0.5) ** 2
                    y = liquidity[ticks[start]] * (p ** 0.5 - lower ** 0.5) / (10 ** decimals1)
                    assert(math.isclose(y,newY))

                    # Determine how much X was taken to get to the new price
                    newX = liquidity[ticks[start]] * (upper ** 0.5 - p ** 0.5) / (p ** 0.5) / (upper ** 0.5) / (10 ** decimals0)
                    deltaX = amountX - newX
                    bought += deltaX

                else:

                    # Fill the range with Y while taking all the X
                    spent += capacityY
                    bought += amountX

                logging.debug(f"{bought} {spent}")
                if spent >= y_to_sell:
                    break
            else:

                amountX = liquidity[ticks[start]] * (upper ** 0.5 - price ** 0.5) / (upper ** 0.5) / (price ** 0.5) / (10 ** decimals0)
                assert(amountX > 0)
                amountY = liquidity[ticks[start]] * (price ** 0.5 - lower ** 0.5) / (10 ** decimals1)
                assert(amountY > 0)

                # How much more Y can be put in the range?
                filledY = liquidity[ticks[start]] * (upper ** 0.5 - lower ** 0.5) / (10 ** decimals1)
                capacityY = filledY - amountY

                # Should we only sell up to the amount remaining?
                delta = y_to_sell - spent
                if capacityY > delta:

                    spent += delta
                    
                    # Get the amount of Y now in the range
                    newY = amountY + delta

                    # At what price does this new Y happen?
                    p = (newY * (10 ** decimals1) / liquidity[ticks[start]] + lower ** 0.5) ** 2
                    y = liquidity[ticks[start]] * (p ** 0.5 - lower ** 0.5) / (10 ** decimals1)
                    assert(math.isclose(y,newY))

                    # Determine how much X was taken to get to the new price
                    newX = liquidity[ticks[start]] * (upper ** 0.5 - p ** 0.5) / (p ** 0.5) / (upper ** 0.5) / (10 ** decimals0)
                    deltaX = amountX - newX
                    bought += deltaX

                else:

                    # Get all the X in the range for filling the capacity
                    spent += capacityY
                    bought += amountX

                logging.debug(f"{bought} {spent}")
                if spent >= y_to_sell:
                    break
            start = i
    spent += fee
    logging.info(f"{date.strftime('%Y-%m-%d %H:%M')} Bought: {bought} {token0} Spent: {spent} {token1} New Price: {p * (10 ** (decimals0 - decimals1))} @ ticks: {ticks[start]} => {ticks[i]}")

def sellX(x_to_sell, token0, decimals0, token1, decimals1, feeTier, price, liquidity, date):
    
    fee = x_to_sell * feeTier / 1000000
    x_to_sell -= fee

    start = 0
    ticks = list(liquidity.keys())
    bought = 0
    spent = 0
    ranges = []
    for i in range(1,len(ticks)):

        if liquidity[ticks[start]] != liquidity[ticks[i]]:

            lower = 1.0001 ** int(ticks[start])
            upper = 1.0001 ** int(ticks[i])
            if price >= upper:

                ranges.append([start,i])

            else:

                amountX = liquidity[ticks[start]] * (upper ** 0.5 - price ** 0.5) / (upper ** 0.5) / (price ** 0.5) / (10 ** decimals0)
                assert(amountX > 0)
                amountY = liquidity[ticks[start]] * (price ** 0.5 - lower ** 0.5) / (10 ** decimals1)
                assert(amountY > 0)

                # How much more X can we put in this range?
                filledX = liquidity[ticks[start]] * (upper ** 0.5 - lower ** 0.5) / (upper ** 0.5) / (lower ** 0.5) / (10 ** decimals0)
                capacityX = filledX - amountX

                # Should we only buy up to the amount remaining?
                delta = x_to_sell - spent
                if capacityX > delta:

                    spent += delta
                    
                    # Get the new amount of X in the range
                    newX = amountX + delta

                    # At what price does this new X happen?
                    p = upper / ( 1 + newX * (10 ** decimals0) / liquidity[ticks[start]] * (upper ** 0.5) ) ** 2
                    x = liquidity[ticks[start]] * (upper ** 0.5 - p ** 0.5) / (upper ** 0.5) / (p ** 0.5) / (10 ** decimals0)
                    assert(math.isclose(x,newX))

                    # Determine how much Y was removed to get to the new price
                    newY = liquidity[ticks[start]] * (p ** 0.5 - lower ** 0.5) / (10 ** decimals1)
                    deltaY = amountY - newY
                    bought += deltaY

                else:

                    # Fill the X capacity and take all the Y
                    spent += capacityX
                    bought += amountY

                logging.debug(f"{bought} {spent}")
                
                break
            start = i

    if spent < x_to_sell:
        for r in reversed(ranges):
            [start, i] = r

            lower = 1.0001 ** int(ticks[start])
            upper = 1.0001 ** int(ticks[i])

            amountY = liquidity[ticks[start]] * (upper ** 0.5 - lower ** 0.5) / (10 ** decimals1)
            assert(amountY > 0)

            # How much X can we put in this range?
            capacityX = liquidity[ticks[start]] * (upper ** 0.5 - lower ** 0.5) / (upper ** 0.5) / (lower ** 0.5) / (10 ** decimals0)

            # Should we only buy up to the amount remaining?
            delta = x_to_sell - spent
            if capacityX > delta:

                spent += delta

                # The amount of X in the range is now what we spent
                newX = delta

                # At what price does this new X happen?
                p = upper / ( 1 + newX * (10 ** decimals0) / liquidity[ticks[start]] * (upper ** 0.5) ) ** 2
                x = liquidity[ticks[start]] * (upper ** 0.5 - p ** 0.5) / (upper ** 0.5) / (p ** 0.5) / (10 ** decimals0)
                assert(math.isclose(x,newX))

                # Determine how much Y was removed to get to the new price
                newY = liquidity[ticks[start]] * (p ** 0.5 - lower ** 0.5) / (10 ** decimals1)
                deltaY = amountY - newY
                bought += deltaY
            else:
                
                # Fill the capacity and take all the Y
                spent += capacityX
                bought += amountY

            logging.debug(f"{bought} {spent}")
            if spent >= x_to_sell:
                break
    spent += fee
    logging.info(f"{date.strftime('%Y-%m-%d %H:%M')} Bought: {bought} {token1} Spent: {spent} {token0} New Price: {p * (10 ** (decimals0 - decimals1))} @ ticks: {ticks[start]} => {ticks[i]}")

def main():

    # create parser object
    parser = argparse.ArgumentParser(description = "A text file manager!")
 
    # defining arguments for parser object
    parser.add_argument("-n", "--network", type = str, choices=["mainnet","arbitrum","matic","optimism"],
                        metavar = "network", required = True,
                        help = "The network of the pool. Options: [mainnet,arbitrum,matic,optimism]")
     
    parser.add_argument("-p", "--pool", type = str,
                        metavar = "address", default = None, required=True,
                        help = "The address of the pool to analyze.")
     
    parser.add_argument("-z", "--zeroForOne", type = str, choices=["True","False"],
                        metavar = "zeroForOne", required = True,
                        help = "True for selling token0 for token1. False for selling token1 for token0.")
     
    parser.add_argument("-a", "--amount", type = int, required=True,
                        metavar = 'amount', help = "The amount of tokens to sell.")

    parser.add_argument("-s", "--start", type = int, required=True,
                        metavar = 'days', help = "The number of days before today to start the process.")
 
    # parse the arguments from standard input
    args = parser.parse_args()

    logging.info(f"{args.network} {args.pool} {args.zeroForOne} {args.amount} {args.start}")

    #pool = "0x151ccb92bc1ed5c6d0f9adb5cec4763ceb66ac7f"
    #pool = "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8"
    [feeTier, token0, decimals0, token1, decimals1, price, tickSpacing] = getPoolParams(args.pool,args.network)
    mints = fetchMints(args.pool, args.network)
    burns = fetchBurns(args.pool, args.network)

    date = datetime.datetime.today() - datetime.timedelta(days=args.start)
    date = date.replace(hour=0,minute=0,second=0,microsecond=0)
    while date <= datetime.datetime.today():
        timelimit = int(datetime.datetime.timestamp(date))
        price = getPriceAtTime(args.pool, args.network, timelimit, decimals0, decimals1)
        positions = mergeMintsBurns(mints, burns, timelimit)
        liquidity = getLiquidity(positions,tickSpacing)
        if args.zeroForOne == 'True':
            sellX(args.amount, token0, decimals0, token1, decimals1, feeTier, price, liquidity, date)
        else:
            sellY(args.amount, token0, decimals0, token1, decimals1, feeTier, price, liquidity, date)
        date += datetime.timedelta(hours=1)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    main()
