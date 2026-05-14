import { CEOPA } from "./ceoPA";

export class GroupLeader {
  static async review(authenticatedSignal: any) {
    if (!authenticatedSignal.authenticated) {
      return { approved: false };
    }

    const capitalRequired = authenticatedSignal.signal.entry * 10;
    const ceoApproval = CEOPA.approveTrade(capitalRequired);

    if (!ceoApproval) {
      return { approved: false };
    }

    return {
      approved: true,
      signal: authenticatedSignal.signal
    };
  }
}
