const FameEXApi = require('./api/fameex_api');
const utils = require('../helpers/utils');
const networks = require('../helpers/cryptos/networks');

/**
 * API endpoints:
 * https://api.fameex.com
 */
const apiServer = 'https://api.fameex.com';
const exchangeName = 'FameEX';

const orderStates = {
  new: [1, 2],
  partiallyFilled: 3,
  filled: 4,
  cancelled: [5, 6],
  uncompleted: 7,
  completedOrCancelled: 9,
};

const orderStatuses = {
  new: 'new',
  partFilled: 'part_filled',
  filled: 'filled',
  cancelled: 'cancelled',
  unknown: 'unknown',
};

const orderTypes = [1, 2, 3, 4, 5];

const orderTypesMap = {
  1: 'limit',
  2: 'market',
  3: 'take_profit_and_stop_loss',
  4: 'tracking_order',
  5: 'maker_only',
};

const orderSides = {
  buy: 1,
  sell: 2,
};

const orderMaxPageSize = 500;

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const fameEXApiClient = FameEXApi();
  fameEXApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets and currencies on initialization
  if (loadMarket) {
    getCurrencies();
    getMarkets();
  }

  /**
   * Get info on all currencies
   * @param {String} coin
   * @param {Boolean} forceUpdate Update currencies to refresh parameters
   * @returns {Promise<unknown>|*}
   */
  function getCurrencies(coin, forceUpdate = false) {
    if (module.exports.gettingCurrencies) return;
    if (module.exports.exchangeCurrencies && !forceUpdate) return module.exports.exchangeCurrencies[coin];

    module.exports.gettingCurrencies = true;

    return new Promise((resolve) => {
      Promise.all([
        fameEXApiClient.currencies(),
        fameEXApiClient.currenciesWithNetwork(),
      ])
          .then(([currenciesData, currenciesWithNetworks]) => {
            try {
              const result = {};

              const currencies = currenciesData.data;

              const networksByCurrency = currenciesWithNetworks.data.list.reduce((acc, data) => {
                const currencyNetworks = Object.keys(data.currencyDetail).map(formatNetworkName);

                return acc.set(data.currency.toUpperCase(), currencyNetworks);
              }, new Map());

              for (const coin in currencies) {
                // Returned data is not full and doesn't include decimals, precision, min amounts, etc
                const currency = currencies[coin];

                result[currency.name.toUpperCase()] = {
                  symbol: currency.name.toUpperCase(),
                  name: currency.name.toUpperCase(),
                  status: undefined,
                  comment: undefined,
                  confirmations: undefined,
                  withdrawalFee: undefined,
                  minWithdraw: +currency.min_withdraw,
                  maxWithdraw: +currency.max_withdraw,
                  logoUrl: undefined,
                  exchangeAddress: undefined,
                  decimals: undefined,
                  precision: undefined,
                  networks: networksByCurrency.get(currency.name.toUpperCase()),
                  defaultNetwork: undefined,
                  withdrawEnabled: currency.can_withdraw,
                  depositEnabled: currency.can_deposit,
                  id: currency.unified_cryptoasset_id,
                };
              }

              if (Object.keys(result).length > 0) {
                module.exports.exchangeCurrencies = result;
                log.log(`${forceUpdate ? 'Updated' : 'Received'} info about ${Object.keys(result).length} currencies on ${exchangeName} exchange.`);
              }

              module.exports.gettingCurrencies = false;
              resolve(result);
            } catch (error) {
              log.warn(`Error while processing getCurrencies() request: ${error}`);
              resolve(undefined);
            }
          }).catch((error) => {
            log.warn(`API request getCurrencies() of ${utils.getModuleName(module.id)} module failed. ${error}`);
            resolve(undefined);
          }).finally(() => {
            module.exports.gettingCurrencies = false;
          });
    });
  }

  /**
   * Get info on all markets
   * @param {String} pair In classic format as BTC/USDT. If markets are already cached, get info for the pair.
   * @returns {Promise<unknown>|*}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairReadable : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      fameEXApiClient.markets().then((markets) => {
        try {
          const result = markets.data.reduce((acc, market) => {
            const pair = formatPairName(market.pair);

            acc[pair.pairReadable] = {
              pairReadable: pair.pairReadable,
              pairPlain: pair.pairPlain,
              coin1: pair.coin1,
              coin2: pair.coin2,
              coin1Decimals: market.amountPrecision,
              coin2Decimals: market.pricePrecision,
              coin1Precision: utils.getPrecision(market.amountPrecision),
              coin2Precision: utils.getPrecision(market.pricePrecision),
              coin1MinAmount: null,
              coin1MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: null,
              status: null,
            };

            return acc;
          }, {});

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

          module.exports.gettingMarkets = false;
          resolve(result);
        } catch (error) {
          log.warn(`Error while processing getMarkets(${paramString}) request: ${error}`);
          resolve(undefined);
        }
      }).catch((error) => {
        log.warn(`API request getMarkets() of ${utils.getModuleName(module.id)} module failed. ${error}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingMarkets = false;
      });
    });
  }

  return {
    getMarkets,
    getCurrencies,

    /**
     * Getter for stored markets info
     * @return {Object}
     */
    get markets() {
      return module.exports.exchangeMarkets;
    },

    /**
     * Getter for stored currencies info
     * @return {Object}
     */
    get currencies() {
      return module.exports.exchangeCurrencies;
    },

    /**
     * Get info for a specific market
     * @param pair In readable format as BTC/USDT or BTC-USDT or BTC_USDT
     * @returns {Promise<*>|*}
     */
    marketInfo(pair) {
      return getMarkets(pair);
    },

    /**
     * Get info for a specific currency
     * @param coin As BTC
     * @returns {Promise<*>|*}
     */
    currencyInfo(coin) {
      return getCurrencies(coin);
    },

    // TODO: test allowAmountForMarketBuy & amountForMarketOrderNecessary
    /**
     * Features available on FameEx exchange
     * @returns {Object}
     */
    features() {
      return {
        getMarkets: true,
        getCurrencies: true,
        placeMarketOrder: true,
        allowAmountForMarketBuy: false,
        amountForMarketOrderNecessary: false,
        getTradingFees: false,
        getAccountTradeVolume: false,
        selfTradeProhibited: false,
        getFundHistory: true,
        getFundHistoryImplemented: false,
        supportCoinNetworks: true,
      };
    },

    /**
     * Get user balances
     * @param {Boolean} nonzero Return only non-zero balances
     * @returns {Promise<Array|undefined>}
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      let balances;

      try {
        balances = await fameEXApiClient.getBalances();
      } catch (error) {
        log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      const spotWallet = balances.data.filter((wallet) => wallet.walletType === 'spot')[0].list;

      try {
        const result = spotWallet.map((crypto) => ({
          code: crypto.currency.toUpperCase(),
          free: +crypto.available,
          freezed: +crypto.hold,
          total: +crypto.total,
        }));

        if (nonzero) {
          return result.filter((crypto) => crypto.free || crypto.freezed);
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getBalances(${paramString}) request results: ${JSON.stringify(balances)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get one page of account open orders
     * !POSSIBLE IMPLEMENTATION ERRORS!
     * !At the moment it is impossible to implement this functional correctly, due to problems on the FameEX side
     * @param {Object} pair Formatted coin pair
     * @param {Number} pageNum Pagination, the first few pages (1 <= pageNum)
     * @returns {Promise<Array|undefined>}
     */
    async getOpenOrdersPage(pair, pageNum = 1) {
      const paramString = `pair: ${pair.pairReadable}`;

      let ordersData;

      try {
        ordersData = await Promise.all([
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.buy,
              orderTypes,
              orderStates.uncompleted,
              pageNum,
              orderMaxPageSize,
          ),
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.sell,
              orderTypes,
              orderStates.uncompleted,
              pageNum,
              orderMaxPageSize,
          ),
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.buy,
              orderTypes,
              orderStates.completedOrCancelled,
              pageNum,
              orderMaxPageSize,
          ),
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.sell,
              orderTypes,
              orderStates.completedOrCancelled,
              pageNum,
              orderMaxPageSize,
          ),
        ]);
      } catch (error) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      const [
        uncompletedOrdersBuy,
        uncompletedOrdersSell,
        completedOrCancelledOrdersBuy,
        completedOrCancelledOrdersSell,
      ] = ordersData;

      const orders = [
        ...uncompletedOrdersBuy.data.orders,
        ...uncompletedOrdersSell.data.orders,
        ...completedOrCancelledOrdersBuy.data.orders,
        ...completedOrCancelledOrdersSell.data.orders,
      ];

      try {
        const result = await Promise.all(orders.map(async (order) => {
          const transactionDetails = (await fameEXApiClient.getTransactionDetails(
              pair.coin1,
              pair.coin2,
              1,
              1,
              order.orderId,
          )).data.trades?.[0];

          return {
            orderId: order.orderId,
            symbol: pair.pairReadable,
            symbolPlain: pair.pairPlain,
            price: +transactionDetails.price,
            side: order.side === orderSides.buy ? 'buy' : 'sell',
            type: formatOrderType(order.orderType),
            timestamp: order.createTime,
            amount: +order.money,
            amountExecuted: +order.filledAmount,
            amountLeft: +order.filledAmount - +order.money,
            status: formatOrderStatus(order.state),
          };
        }));

        return result;
      } catch (error) {
        log.warn(`Error while processing getOpenOrders(${paramString}) request results: ${JSON.stringify(ordersData)}. ${error}`);
        return undefined;
      }
    },

    /**
     * List of all account open orders
     * !POSSIBLE IMPLEMENTATION ERRORS!
     * !At the moment it is impossible to implement this functional correctly, due to problems on the FameEX side
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Array|undefined>}
     */
    async getOpenOrders(pair) {
      const allOrders = [];
      const coinPair = formatPairName(pair);

      let pageNum = 1;

      const limit = (await fameEXApiClient.getTransactionDetails(
          coinPair.coin1,
          coinPair.coin2,
          pageNum,
          1,
      )).data.total;

      do {
        const ordersInfo = await this.getOpenOrdersPage(coinPair, pageNum);

        if (!ordersInfo) return undefined;

        allOrders.push(...ordersInfo);

        pageNum += 1;
      } while (allOrders.length < limit);

      return allOrders;
    },

  };
};
/**
 * Returns network name in classic format
 * @param {String} network
 * @return {String}
 */
function formatNetworkName(network) {
  return networks[network?.toUpperCase()]?.code ?? network;
}

/**
 * Returns pair in classic format BTC/USDT
 * @param {String} pair Pair in FameEX format BTC_USDT or BTC-USDT or BTC/USDT
 * @return {Object}
 */
function formatPairName(pair) {
  pair = pair?.toUpperCase();
  const [coin1, coin2] = pair.split(/[\-\_\/]/);

  return {
    pair: `${coin1}/${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}_${coin2}`,
    coin1,
    coin2,
  };
}

/**
 * Returns system order status
 * @param {String} orderState State in FameEX format
 * @return {string}
 */
function formatOrderStatus(orderState) {
  if (orderStates.new.includes(orderState)) {
    return orderStatuses.new;
  }
  if (orderState === orderStates.partiallyFilled) {
    return orderStatuses.partFilled;
  }
  if (orderState === orderStates.filled) {
    return orderStatuses.filled;
  }
  if (orderStates.cancelled.includes(orderState)) {
    return orderStatuses.cancelled;
  }

  return orderStatuses.unknown;
}

/**
 * Returns system order type
 * @param {Number} orderType Order type in FameEX format
 * @return {string}
 */
function formatOrderType(orderType) {
  return orderTypesMap[orderType] || 'unknown';
}
