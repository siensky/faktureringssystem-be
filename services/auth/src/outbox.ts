// Outbox-mönstret bor i @faktura/shared (delas av alla tjänster). Denna
// fil finns kvar bara för att inte röra alla importvägar i auth-modulen.
export {
  writeEvent,
  startOutboxPublisher,
  EVENTS_EXCHANGE,
  type WriteEventInput,
} from "@faktura/shared";
