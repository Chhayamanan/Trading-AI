import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export class YahooService {
  static async getHistoricalData(symbol: string, excludeToday = false) {
    const ticker = (symbol.includes(".") || symbol.startsWith("^")) ? symbol : `${symbol}.NS`;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 150); 
    const today = new Date();
    
    // If excluding today, set end date to yesterday 23:59:59
    const endDate = excludeToday ? new Date(new Date().setDate(today.getDate() - 1)) : today;
    if (excludeToday) endDate.setHours(23, 59, 59, 999);

    let result;
    try {
      // @ts-ignore
      const chartData = await yahooFinance.chart(ticker, {
        period1: startDate,
        period2: endDate,
        interval: "1d"
      });
      result = chartData.quotes || [];
    } catch (e: any) {
      console.warn(`[YAHOO] NSE fetch failed for ${ticker}: ${e.message}`);
    }

    if (!result || result.length === 0) {
      if (!symbol.includes(".") && !symbol.startsWith("^")) {
        const bseTicker = `${symbol}.BO`;
        try {
          // @ts-ignore
          const chartData = await yahooFinance.chart(bseTicker, {
            period1: startDate,
            period2: endDate,
            interval: "1d"
          });
          result = chartData.quotes || [];
        } catch (e: any) {
          console.error(`[YAHOO] BSE fetch failed for ${bseTicker}: ${e.message}`);
        }
      }
    }

    if (!result || result.length === 0) {
      throw new Error("No data found, symbol may be delisted or incorrect");
    }

    return result;
  }

  static async get90DayData(symbol: string) {
    // Legacy support, now calls with excludeToday=true as requested
    return this.getHistoricalData(symbol, true);
  }

  static async getIntradayData(symbol: string, days = 59) {
    const ticker = (symbol.includes(".") || symbol.startsWith("^")) ? symbol : `${symbol}.NS`;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      // @ts-ignore - yahoo-finance2 types might be outdated for chart
      const result = await yahooFinance.chart(ticker, {
        period1: startDate,
        interval: "5m"
      });
      return result.quotes || [];
    } catch (e: any) {
      console.warn(`[YAHOO] Intraday fetch failed for ${ticker}: ${e.message}`);
      return [];
    }
  }

  static async getCurrentPrices(symbols: string[]) {
    const tickers = symbols.map(s => (s.includes(".") || s.startsWith("^")) ? s : `${s}.NS`);
    
    try {
      const quotes: any[] = await yahooFinance.quote(tickers, {}, { validateResult: false });
      const map: Record<string, { price: number, volume: number }> = {};
      
      quotes.forEach(q => {
        const sym = q.symbol.replace(".NS", "").replace(".BO", "");
        map[sym] = {
          price: q.regularMarketPrice || q.price || 0,
          volume: q.regularMarketVolume || q.volume || 0
        };
      });
      
      return map;
    } catch (e: any) {
      console.error(`[YAHOO] Batch quote failed: ${e.message}`);
      return {};
    }
  }

  static async getCurrentPrice(symbol: string) {
    const ticker = (symbol.includes(".") || symbol.startsWith("^")) ? symbol : `${symbol}.NS`;
    const quote: any = await yahooFinance.quote(ticker, {}, { validateResult: false });
    return {
      price: quote.regularMarketPrice || quote.price || 0,
      volume: quote.regularMarketVolume || quote.volume || 0
    };
  }
}
