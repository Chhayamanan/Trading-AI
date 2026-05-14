import { BrokerService } from "../../services/brokerService";

export class DarvasExecuter {
  static async execute(symbol: string, entry: number) {
    const quantity = 10;
    return await BrokerService.executeBuy(symbol, entry, quantity);
  }
}
