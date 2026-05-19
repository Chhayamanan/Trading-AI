import { CEOPA } from "./ceoPA";
import { SETTINGS } from "../config/settings";

export class GroupLeader {
  static async review(authenticatedSignal: any) {
    if (!authenticatedSignal.authenticated) {
      return { approved: false, reason: authenticatedSignal.reason };
    }

    const quantity = 1;
    const capitalRequired = authenticatedSignal.signal.entry * quantity;
    const ceoApproval = CEOPA.approveTrade(capitalRequired);

    if (!ceoApproval) {
      const reason = `capital required (${capitalRequired}) > 10% of total capital (${SETTINGS.CAPITAL})`;
      console.log(`[GroupLeader] Rejected ${authenticatedSignal.signal.symbol} - ${reason}`);
      return { approved: false, reason };
    }

    console.log(`[GroupLeader] Approved ${authenticatedSignal.signal.symbol} for Qty ${quantity}`);
    return {
      approved: true,
      signal: authenticatedSignal.signal
    };
  }
}
