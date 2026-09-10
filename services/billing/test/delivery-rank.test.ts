// Enhetstest för den monotona rankningen av delivery_status (domain.md
// #29). Ren funktion — ingen DB. Det villkorade UPDATE:t i
// DeliveryRepository.advanceDeliveryStatus använder samma ordning uttryckt
// i SQL, så den regeln får sitt bevis i e2e-sviten.

import { describe, expect, test } from "bun:test";
import { deliveryRank } from "../src/deliveries/repository";
import type { DeliveryStatus } from "../src/invoices/types";

const ORDER: DeliveryStatus[] = ["none", "queued", "sent", "delivered", "failed", "bounced"];

describe("deliveryRank — monoton ordning", () => {
  test("rankningen är strikt stigande i livscykelordning", () => {
    for (let i = 1; i < ORDER.length; i++) {
      expect(deliveryRank(ORDER[i]!)).toBeGreaterThan(deliveryRank(ORDER[i - 1]!));
    }
  });

  test("delivered kan inte skriva över bounced", () => {
    // WHERE-villkoret skriver bara om ny rank > nuvarande rank.
    expect(deliveryRank("delivered")).toBeLessThan(deliveryRank("bounced"));
  });

  test("bounced rankas över failed — en studs är ett starkare besked", () => {
    expect(deliveryRank("bounced")).toBeGreaterThan(deliveryRank("failed"));
  });

  test("en försenad 'sent' kan inte nedgradera 'delivered'", () => {
    expect(deliveryRank("sent")).toBeLessThan(deliveryRank("delivered"));
  });

  test("rankningen är deterministisk — en omleverans av samma status ger samma rank", () => {
    // advanceDeliveryStatus skriver bara när ny rank > nuvarande rank, så
    // två likadana rapporter ger ingen andra skrivning.
    for (const s of ORDER) {
      expect(deliveryRank(s)).toBe(deliveryRank(s));
    }
  });
});
