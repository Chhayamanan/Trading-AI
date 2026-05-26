import { DataKeeper } from "../../core/dataKeeper";
import { YahooService } from "../../services/yahooService";
import { MstockService } from "../../services/mstockService";

export interface IntradayRadarResult {
  symbol: string;
  lastCandleVolume: number;
  avg5MinVolume: number;
  volumeRatio: number;
  priceChangePercent: number;
  candleTime: string;
  currentPrice: number;
}

export class IntradayVolumeScanner {
  /**
   * Scans 5-minute candles for volume spikes
   * @param symbols Array of stock symbols to scan
   * @param volumeMultiplier Threshold ratio to flag a spike (e.g., 3 means 3x higher than average)
   */
  static async scan(symbols: string[], volumeMultiplier = 3.0): Promise<IntradayRadarResult[]> {
    const radarItems: IntradayRadarResult[] = [];

    // Pre-fetch live quotes for real-time fallback/price confirmation
    let liveQuotes = await MstockService.getCurrentPrices(symbols);
    if (Object.keys(liveQuotes).length === 0 && symbols.length > 0) {
      liveQuotes = await YahooService.getCurrentPrices(symbols);
    }

    for (const symbol of symbols) {
      try {
        // Fetch 5-minute intraday bars from cache/data layer
        const intraday = await DataKeeper.getIntradayData(symbol); // Ensure this returns 5m intervals
        
        // We need at least 12 candles (1 hour of 5-min data) to build a proper baseline
        if (!intraday || intraday.length < 12) {
          continue;
        }

        // 1. Identify the target candle (most recent completed 5-minute candle)
        const lastCandle = intraday[intraday.length - 1];
        const prevCandle = intraday[intraday.length - 2];
        const lastCandleVolume = lastCandle.volume || 0;

        if (lastCandleVolume === 0) continue;

        // 2. Build the baseline by skipping the last 2 candles
        // This ensures the unusual spike volume itself doesn't skew the "normal" historical average
        const historicalCandles = intraday.slice(0, -2);
        const historicalVolumes = historicalCandles
          .map((c: any) => c.volume || 0)
          .filter((v: number) => v > 0);

        if (historicalVolumes.length === 0) continue;

        // 3. Trim outliers (Top 10% and Bottom 10%) to get a true "normal" 5-minute average
        const sorted = [...historicalVolumes].sort((a, b) => a - b);
        const trimCount = Math.floor(sorted.length * 0.1);
        
        // Ensure slicing safely leaves elements behind
        const baselineVolumes = trimCount * 2 < sorted.length 
          ? sorted.slice(trimCount, sorted.length - trimCount)
          : sorted;

        const avg5MinVolume = baselineVolumes.reduce((a, b) => a + b, 0) / baselineVolumes.length;

        // 4. Calculate ratio against your dynamic multiplier
        const volumeRatio = lastCandleVolume / (avg5MinVolume || 1);

        // Check if volume crosses your configurable threshold
        if (volumeRatio >= volumeMultiplier) {
          
          // Calculate price volatility during this specific 5-minute block
          const open = lastCandle.open || prevCandle.close || lastCandle.close;
          const close = lastCandle.close;
          const priceChangePercent = open > 0 ? ((close - open) / open) * 100 : 0;

          // Format timestamp for presentation
          const candleTime = lastCandle.date 
            ? new Date(lastCandle.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : "N/A";

          radarItems.push({
            symbol,
            lastCandleVolume,
            avg5MinVolume: Math.round(avg5MinVolume),
            volumeRatio: parseFloat(volumeRatio.toFixed(2)),
            priceChangePercent: parseFloat(priceChangePercent.toFixed(2)),
            candleTime,
            currentPrice: liveQuotes[symbol]?.price || close
          });
        }
      } catch (err) {
        console.error(`[RADAR ERROR] Failed scanning 5m volume for ${symbol}:`, err);
      }
    }

    // Sort results showing highest volume surges at the top
    return radarItems.sort((a, b) => b.volumeRatio - a.volumeRatio);
  }
}