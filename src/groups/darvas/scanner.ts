import { DataKeeper } from "../../core/dataKeeper";
import { SETTINGS } from "../../config/settings";
import { LoggerService } from "../../services/loggerService";
import { StockCandidate } from "../../models/stock";
import { RSAgent } from "../../core/rsAgent";
import { LARGE_CAP_STOCKS, MIDCAP_STOCKS, SMALLCAP_STOCKS, getBenchmarkIndex, MARKET_UNIVERSE } from "../../services/marketDataService";
import { YahooService } from "../../services/yahooService";
import { MstockService } from "../../services/mstockService";

export class DarvasScanner {
  static async scan(symbols: string[], options: { 
    volumeMultiplier?: number, 
    rsTrendOnly?: boolean,
    customFilters?: {
      volMult?: number,
      distFromHigh?: number,
      dailyChangeMin?: number,
      dailyChangeMax?: number
    }
  } = {}): Promise<StockCandidate[]> {
    const candidates: StockCandidate[] = [];
    const multiplier = options.volumeMultiplier ?? SETTINGS.VOLUME_MULTIPLIER;
    
    // Check if cache is healthy
    const healthy = await DataKeeper.isCacheHealthy();
    if (!healthy) {
      LoggerService.log("[SCANNER] WARNING: Data Keeper cache is older than 12 hours. Please sync!");
    }

    // Pre-fetch LIVE prices for all symbols in this scan
    LoggerService.log(`[SCANNER] Fetching live quotes for ${symbols.length} symbols...`);
    let liveQuotes = await MstockService.getCurrentPrices(symbols);

    if (Object.keys(liveQuotes).length === 0 && symbols.length > 0) {
      LoggerService.log(`[SCANNER] WARNING: Mstock returned 0 live quotes. Falling back to Yahoo Finance...`);
      liveQuotes = await YahooService.getCurrentPrices(symbols);
    }

    // Pre-fetch Nifty 50 data for comparison (Historical)
    const niftyData = await DataKeeper.getData("^NSEI");
    if (!niftyData) {
      LoggerService.log("[SCANNER] ERROR: Nifty 50 benchmark data missing in cache. Sync data to fix Relative Strength 0 values.");
    }

    for (const symbol of symbols) {
      try {
        const candles = await DataKeeper.getData(symbol);
        
        if (!candles || candles.length === 0) {
          continue;
        }

        let historicalHigh = -Infinity;
        let historicalLow = Infinity;
        let sumVolume = 0;
        
        for (let i = 0; i < candles.length; i++) {
          const c = candles[i];
          if (c.high > historicalHigh) historicalHigh = c.high;
          if (c.low < historicalLow) historicalLow = c.low;
          sumVolume += c.volume || 0;
        }

        if (historicalHigh === -Infinity) historicalHigh = 0;
        if (historicalLow === Infinity) historicalLow = 0;

        const prevClose = candles[candles.length - 1].close || 0;
        
        // Use LIVE quote instead of last cached candle
        const live = liveQuotes[symbol];
        if (!live) continue;
        
        const currentPrice = live.price;
        const currentVolume = live.volume;
        const dailyChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
        const distFromHigh = historicalHigh > 0 ? Math.max(0, ((historicalHigh - currentPrice) / historicalHigh) * 100) : 0;
        const avgVolume90d = sumVolume / (candles.length || 1);
        const volumeRatio = currentVolume / (avgVolume90d || 1);

        // Step 1: Filters
        if (options.customFilters) {
          const { volMult, distFromHigh: maxDist, dailyChangeMin, dailyChangeMax } = options.customFilters;
          
          if (volMult !== undefined && volumeRatio < volMult) continue;
          if (maxDist !== undefined && distFromHigh > maxDist) continue;
          if (dailyChangeMin !== undefined && dailyChange < dailyChangeMin) continue;
          if (dailyChangeMax !== undefined && dailyChange > dailyChangeMax) continue;
        } else if (!options.rsTrendOnly) {
          // Standard Darvas Filters
          const range = ((historicalHigh - historicalLow) / (historicalLow || 1)) * 100;
          if (range > SETTINGS.BOX_RANGE_LIMIT) continue;
          if (volumeRatio < multiplier) continue;
        }

        // Determine Market Cap
        let marketCap: 'Large' | 'Mid' | 'Small' = 'Small';
        if (LARGE_CAP_STOCKS.includes(symbol)) marketCap = 'Large';
        else if (MIDCAP_STOCKS.includes(symbol)) marketCap = 'Mid';

        const candidate: StockCandidate = {
          symbol,
          boxHigh: historicalHigh,
          boxLow: historicalLow,
          currentPrice,
          avgVolume90d,
          currentVolume,
          volumeRatio,
          marketCap,
          dailyChange,
          distFromHigh
        };

        // Relative Strength Analysis (Step 3) - Uses historical candles for consistency
        if (niftyData) {
          const rsNifty = RSAgent.analyze(symbol, candles, niftyData, "^NSEI");
          
          if (options.rsTrendOnly) {
            const isImproving = rsNifty.rpi10 > rsNifty.rpi30 && 
                              rsNifty.rpi30 > rsNifty.rpi60 && 
                              rsNifty.rpi60 > rsNifty.rpi90;
            if (!isImproving) continue;
          }

          candidate.rsNifty = { rpi90: rsNifty.rpi90, rpi60: rsNifty.rpi60, rpi30: rsNifty.rpi30, rpi10: rsNifty.rpi10 };
        }

        const benchSym = getBenchmarkIndex(symbol);
        const benchData = await DataKeeper.getData(benchSym);
        if (benchData) {
          const rsIndex = RSAgent.analyze(symbol, candles, benchData, benchSym);
          candidate.rsIndex = rsIndex;
        }

        candidates.push(candidate);
      } catch (err) {
        console.error(`Error scanning ${symbol}:`, err);
      }
    }
    return candidates;
  }
}
