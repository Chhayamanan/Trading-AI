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

  static async placeOrder(symbol: string, quantity: number = 1) {
    if (!this.jwtToken) {
      const authed = await this.authenticate();
      if (!authed) {
        console.log(`[PAPER TRADE] BUY ${quantity} ${symbol}`);
        return `PAPER-${Date.now()}`;
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
        return `ERROR-${Date.now()}`;
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
          console.log(`[PAPER TRADE FALLBACK] BUY ${quantity} ${tradingSymbol} (IP Restriction AG7002)`);
          return `PAPER-${Date.now()}`;
        }
        return `FAILED: ${response.data.message || response.data.errorcode || Date.now()}`;
      }
    } catch (error: any) {
      console.error("Order placement error:", error.response?.data || error);
      return `ERROR: ${error.response?.data?.message || error.message || Date.now()}`;
    }
  }
}
