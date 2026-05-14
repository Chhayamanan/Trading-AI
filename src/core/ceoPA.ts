import { SETTINGS } from "../config/settings";

export class CEOPA {
  static approveTrade(capitalRequired: number) {
    const availableCapital = SETTINGS.CAPITAL;
    // Risk management: Max 10% of capital per trade
    if (capitalRequired > availableCapital * 0.1) {
      return false;
    }
    return true;
  }
}
