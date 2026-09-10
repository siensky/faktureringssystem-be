#!/bin/sh
# Skapar en RabbitMQ-användare per tjänst med permissions begränsade till
# det den faktiskt använder — inte ett delat guest-konto (architecture.md,
# avsnittet M2M: "Varje tjänst får egna RabbitMQ-credentials..."). Körs som
# en engångscontainer (rabbitmq-init i docker-compose.yml) mot management-
# HTTP-API:et, EFTER att rabbitmq är healthy, och FÖRE att någon av de fyra
# tjänsterna får starta.
#
# Idempotent: PUT mot /api/users/<namn> och /api/permissions/... skapar
# eller uppdaterar — säkert att köra om vid varje `docker compose up`.
#
# Lösenord kommer från miljön (code-style.md #23), aldrig hårdkodade här.
# Ingen tjänst får management-taggen — de är renodlade programkonton, inte
# till för att logga in i UI:t.

set -eu

API="http://rabbitmq:15672/api"
AUTH="${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}"

echo "Väntar på RabbitMQ management API..."
until curl -sf -u "$AUTH" "$API/overview" > /dev/null 2>&1; do
  sleep 1
done
echo "RabbitMQ är uppe. Deklarerar 'events'-exchanget."

# Det delade topic-exchanget för affärshändelser deklareras HÄR, en gång,
# inte av tjänsterna. Då behöver ingen tjänst "configure"-behörighet på
# det — bara "write" (publicera) och "read" (binda köer). Ingen enskild
# tjänst kan då redeklarera det med andra parametrar eller ta bort det.
curl -sf -u "$AUTH" -X PUT "$API/exchanges/%2F/events" \
  -H "Content-Type: application/json" \
  -d '{"type":"topic","durable":true}' > /dev/null

echo "Skapar tjänstekonton."

create_user() {
  name="$1"
  password="$2"
  # Behörigheter per tjänst, granskningsbart och smalt:
  #   configure : sin egen system.ping.<namn>-kö + sina egna "<namn>.*"-köer
  #               + system.ping-exchanget (fanout, deklareras av tjänsten)
  #   write     : publicera på system.ping och events, binda sina egna köer
  #   read      : konsumera sina egna köer, binda mot system.ping/events
  # "events" saknas medvetet ur "configure" (se ovan).
  curl -sf -u "$AUTH" -X PUT "$API/users/$name" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$password\",\"tags\":\"\"}" > /dev/null

  # RabbitMQs permissionsmodell för queue.bind kräver "write" på KÖN (inte
  # bara på exchanget) — annars 403 vid varje bind. Se
  # https://www.rabbitmq.com/docs/access-control#permissions
  #
  # Hela JSON-payloaden skrivs som en enkelcitatad mall (så sh inte rör
  # backslash) och sed byter bara ut __NAME__. "configure" saknar "events".
  permissions_json=$(printf '%s' '{"configure":"^(system\\.ping(\\.__NAME__)?|__NAME__\\..*)$","write":"^(system\\.ping(\\.__NAME__)?|events|__NAME__\\..*)$","read":"^(system\\.ping(\\.__NAME__)?|events|__NAME__\\..*)$"}' | sed "s/__NAME__/$name/g")

  curl -sf -u "$AUTH" -X PUT "$API/permissions/%2F/$name" \
    -H "Content-Type: application/json" \
    -d "$permissions_json" > /dev/null

  echo "  ✓ $name"
}

create_user "auth" "${AUTH_RABBITMQ_PASSWORD}"
create_user "billing" "${BILLING_RABBITMQ_PASSWORD}"
create_user "payments" "${PAYMENTS_RABBITMQ_PASSWORD}"
create_user "documents" "${DOCUMENTS_RABBITMQ_PASSWORD}"

echo "Klart."
