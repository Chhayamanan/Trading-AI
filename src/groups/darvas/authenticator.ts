import { BuySignal } from "../../models/signal";
import { YahooService } from "../../services/yahooService";
import { SETTINGS } from "../../config/settings";

export class DarvasAuthenticator {
  static async authenticate(signal: BuySignal, multiplierOverride?: number) {
    try {
      const multiplier = multiplierOverride || Number(SETTINGS.VOLUME_MULTIPLIER);
      const validVolume = signal.currentVolume > signal.avgVolume * multiplier;
      
      // We still fetch history to check the box range and breakout against the absolute high
      const candles = await YahooService.get90DayData(signal.symbol);
      if (!candles || candles.length === 0) return { authenticated: false };

      const highs = candles.map(c => c.high || 0);
      const lows = candles.map(c => c.low || 0);
      const high = Math.max(...highs);
      const low = Math.min(...lows);

      const range = ((high - low) / low) * 100;
      const validRange = range <= SETTINGS.BOX_RANGE_LIMIT;
      const validBreakout = signal.entry > high;

      if (validRange && validVolume && validBreakout) {
        return { authenticated: true, confidence: 95, signal };
      }
    } catch (err) {
      console.error(`Error authenticating ${signal.symbol}:`, err);
    }
    return { authenticated: false };
  }
}
