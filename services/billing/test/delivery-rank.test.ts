// Enhetstest för den monotona rankningen av delivery_status (domain.md
// #29). Ordningen kommer från packages/contracts/schemas/
// delivery-status-rank.json — SAMMA fil dokuments Python-sida läser — så
// det här testet bevisar samtidigt att importvägen fungerar, inte bara att
// en lokal konstant råkar vara sorterad rätt. Det villkorade UPDATE:t i
// DeliveryRepository.advanceDeliveryStatus använder array_position() på
// exakt den här ordningen, så SQL:en kan aldrig glida isär från TS-testet.

import { describe, expect, test } from "bun:test";
import { DELIVERY_STATUS_ORDER } from "@faktura/contracts";
import { deliveryRank } from "../src/deliveries/repository";

describe("deliveryRank — monoton ordning", () => {
  test("rankningen är strikt stigande i den delade ordningen", () => {
    for (let i = 1; i < DELIVERY_STATUS_ORDER.length; i++) {
      expect(deliveryRank(DELIVERY_STATUS_ORDER[i]!)).toBeGreaterThan(
        deliveryRank(DELIVERY_STATUS_ORDER[i - 1]!),
      );
    }
  });

  test("delivered kan inte skriva över bounced", () => {
    // WHERE-villkoret skriver bara om ny rank > nuvarande rank.
    expect(deliveryRank("delivered")).toBeLessThan(deliveryRank("bounced"));
  });

  test("failed kan INTE skriva över delivered — ett bekräftat mottaget mejl är inte 'misslyckat'", () => {
    // Ett förgiftat/ur-ordning-levererat webhook-event som rapporterar
    // 'failed' efter att providern redan bekräftat 'delivered' ska inte
    // kunna nedgradera statusen (PR-granskning fas 4, punkt 9).
    expect(deliveryRank("failed")).toBeLessThan(deliveryRank("delivered"));
  });

  test("failed kan INTE skriva över bounced", () => {
    expect(deliveryRank("failed")).toBeLessThan(deliveryRank("bounced"));
  });

  test("delivered och bounced (de två terminala utfallen) rankas högst", () => {
    const nonTerminal = DELIVERY_STATUS_ORDER.filter((s) => s !== "delivered" && s !== "bounced");
    for (const s of nonTerminal) {
      expect(deliveryRank(s)).toBeLessThan(deliveryRank("delivered"));
      expect(deliveryRank(s)).toBeLessThan(deliveryRank("bounced"));
    }
  });

  test("en försenad 'sent' kan inte nedgradera 'delivered'", () => {
    expect(deliveryRank("sent")).toBeLessThan(deliveryRank("delivered"));
  });

  test("rankningen är deterministisk — en omleverans av samma status ger samma rank", () => {
    // advanceDeliveryStatus skriver bara när ny rank > nuvarande rank, så
    // två likadana rapporter ger ingen andra skrivning.
    for (const s of DELIVERY_STATUS_ORDER) {
      expect(deliveryRank(s)).toBe(deliveryRank(s));
    }
  });

  test("okänd status kastar", () => {
    expect(() => deliveryRank("opened")).toThrow(/okänd delivery-status/);
  });
});
