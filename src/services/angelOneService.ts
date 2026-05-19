import axios from 'axios';
import { TOTP } from 'totp-generator';
import { AngelOneTokenManager } from './angelOneTokenManager';
import os from 'os';

let publicIpCache = process.env.ANGEL_PUBLIC_IP || '';
let localIpCache = process.env.ANGEL_LOCAL_IP || '';

const getLocalIp = () => {
  if (localIpCache) return localIpCache;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIpCache = iface.address;
        return localIpCache;
      }
    }
  }
  return '192.168.1.1';
};

const getPublicIp = async () => {
  if (publicIpCache) return publicIpCache;
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
    publicIpCache = res.data.ip;
    console.log(`[AngelOne] Fetched container public IP: ${publicIpCache}. Make sure it is registered in SmartAPI if you get AG7002.`);
  } catch (e) {
    publicIpCache = '106.193.147.98';
  }
  return publicIpCache;
};

const getMacAddress = () => {
  return process.env.ANGEL_MAC_ADDRESS || 'fe80::216:3eff:fe99:1111';
};

const BASE_URL = 'https://apiconnect.angelbroking.com';


interface AngelOneAuthResponse {
  status: boolean;
  message: string;
  errorcode: string;
  data: {
    jwtToken: string;
    refreshToken: string;
    feedToken: string;
  };
}

export class AngelOneService {
  private static jwtToken: string | null = null;
  private static feedToken: string | null = null;

  static async authenticate() {
    const clientCode = process.env.ANGEL_CLIENT_CODE;
    const password = process.env.ANGEL_PASSWORD;
    const totpSecret = process.env.ANGEL_TOTP_SECRET;
    const apiKey = process.env.ANGEL_API_KEY;

    if (!clientCode || !password || !totpSecret || !apiKey) {
      console.warn("Angel One credentials not found, running in paper trading mode.");
      return false;
    }

    try {
      const { otp } = await TOTP.generate(totpSecret);
      
      const response = await axios.post<AngelOneAuthResponse>(
        `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
        {
          clientcode: clientCode,
          password: password,
          totp: otp,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': getLocalIp(),
            'X-ClientPublicIP': await getPublicIp(),
            'X-MACAddress': getMacAddress(),
            'X-PrivateKey': apiKey,
          }
        }
      );

      if (response.data.status && response.data.data) {
        this.jwtToken = response.data.data.jwtToken;
        this.feedToken = response.data.data.feedToken;
        console.log("Angel One Authentication Successful");
        return true;
      } else {
        console.error("Angel One Auth Failed:", response.data);
        return false;
      }
    } catch (error) {
      console.error("Angel One Auth Error:", error);
      return false;
    }
  }

  static async getCurrentPrices(symbols: string[]) {
    if (!this.jwtToken) {
      const authed = await this.authenticate();
      if (!authed) {
        console.warn("AngelOne auth failed, returning empty prices.");
        return {};
      }
    }

    const apiKey = process.env.ANGEL_API_KEY;
    const map: Record<string, { price: number, volume: number }> = {};
    const tokens: string[] = [];
    const symbolToTradingMap: Record<string, string> = {};

    for (const symbol of symbols) {
      // Ignore indices for AngelOne, or map appropriately
      if (symbol.startsWith('^')) continue; 
      
      const tradingSymbol = symbol.endsWith('.NS') ? symbol.replace('.NS', '-EQ') : `${symbol}-EQ`;
      const token = await AngelOneTokenManager.getToken(tradingSymbol);
      if (token) {
        tokens.push(token);
        symbolToTradingMap[token] = symbol;
      }
    }

    if (tokens.length === 0) return map;

    let successCount = 0;
    // API limits batch size to 50 tokens
    const BATCH_SIZE = 50;
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batchTokens = tokens.slice(i, i + BATCH_SIZE);
      try {
        const response = await axios.post(
          `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
          {
            mode: 'FULL',
            exchangeTokens: {
              NSE: batchTokens
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${this.jwtToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-UserType': 'USER',
              'X-SourceID': 'WEB',
              'X-ClientLocalIP': getLocalIp(),
              'X-ClientPublicIP': await getPublicIp(),
              'X-MACAddress': getMacAddress(),
              'X-PrivateKey': apiKey,
            }
          }
        );

        if (response.data.status && response.data.data && response.data.data.fetched) {
          response.data.data.fetched.forEach((q: any) => {
            const sym = symbolToTradingMap[q.symbolToken];
            if (sym) {
              map[sym.replace('.NS', '')] = {
                price: q.ltp || 0,
                volume: q.tradeVolume || q.tradedQty || q.volTraded || q.volume || 0
              };
              successCount++;
            }
          });
        }
      } catch (error: any) {
        console.error("Angel One Market Quote Error:", error.response?.data || error.message);
      }
      
      // Prevent hitting rate limits (allow 1000ms delay between batch requests)
      if (i + BATCH_SIZE < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (successCount === 0) {
      console.warn("[AngelOne] Failed to fetch quotes, likely IP restriction or rate limit. Returning empty.");
      return {};
    }

    return map;
  }
  static async placeOrder(symbol: string, quantity: number = 1) {
    if (!this.jwtToken) {
      const authed = await this.authenticate();
      if (!authed) {
        throw new Error("AngelOne Auth Failed. Cannot trade.");
      }
    }

    try {
      // Basic instrument formatting for Angel One (often requires token, but using generic equity symbol if possible, though SmartAPI usually requires tradingsymbol and symboltoken)
      // For simplicity in this implementation, assume symbol maps to tradingsymbol. 
      // In a real Angel One app, one would download the instrument list. We will send basic params.
      const apiKey = process.env.ANGEL_API_KEY;
      const tradingSymbol = symbol.endsWith('.NS') ? symbol.replace('.NS', '-EQ') : `${symbol}-EQ`;
      const symboltoken = await AngelOneTokenManager.getToken(tradingSymbol);

      if (!symboltoken) {
        console.error(`Angel One order failed: Token not found for ${tradingSymbol}`);
        throw new Error(`Token not found for ${tradingSymbol}`);
      }

      const response = await axios.post(
        `${BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder`,
        {
          "variety": "NORMAL",
          "tradingsymbol": tradingSymbol,
          "symboltoken": symboltoken,
          "transactiontype": "BUY",
          "exchange": "NSE",
          "ordertype": "MARKET",
          "producttype": "DELIVERY",
          "duration": "DAY",
          "price": "0",
          "squareoff": "0",
          "stoploss": "0",
          "quantity": quantity.toString()
        },
        {
          headers: {
            'Authorization': `Bearer ${this.jwtToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': getLocalIp(),
            'X-ClientPublicIP': await getPublicIp(),
            'X-MACAddress': getMacAddress(),
            'X-PrivateKey': apiKey,
          }
        }
      );

      if (response.data.status) {
        console.log(`Order placed successfully for ${tradingSymbol}:`, response.data);
        return response.data.data.orderid;
      } else {
        console.error("Order placement failed:", response.data);
        if (response.data.errorcode === 'AG7002' || response.data.message?.includes('Unregistered IP')) {
          throw new Error(`AngelOne API IP Restriction (AG7002): Please register IP ${await getPublicIp()} in SmartAPI`);
        }
        throw new Error(`FAILED: ${response.data.message || response.data.errorcode || "Unknown Error"}`);
      }
    } catch (error: any) {
      console.error("Order placement error:", error.response?.data || error);
      throw new Error(`ERROR: ${error.response?.data?.message || error.message || "Unknown error placing order"}`);
    }
  }
}
