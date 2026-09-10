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
echo "RabbitMQ är uppe. Skapar tjänstekonton."

create_user() {
  name="$1"
  password="$2"
  # Varje tjänst får:
  #   - system.ping + sin egen system.ping.<namn>-kö  (fas 0, infra-diagnostik)
  #   - "events"                                       (fas 1, det delade topic-exchanget för affärshändelser)
  #   - sina egna konsumentköer "<namn>.*"             (bind + consume)
  # En explicit, granskningsbar rad per tjänst — inte ett brett "allow all".
  # "events" är delat på samma sätt som system.ping: en topic-buss flera
  # tjänster legitimt publicerar till och konsumerar från.
  curl -sf -u "$AUTH" -X PUT "$API/users/$name" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$password\",\"tags\":\"\"}" > /dev/null

  # RabbitMQs permissionsmodell för queue.bind kräver "write" på KÖN (inte
  # bara på exchanget) — annars 403 (ACCESS-REFUSED) vid varje bind, även
  # om exchanget självt har rätt "write". Se
  # https://www.rabbitmq.com/docs/access-control#permissions för hela
  # tabellen (configure/write/read per operation).
  #
  # Regexen byggs med sed mot en enkelcitatad mall i stället för att
  # interpolera "\\." direkt i en dubbelcitatad sträng — POSIX sh reducerar
  # antalet backslash olika beroende på sammanhang (variabel-assignment vs
  # here-doc vs kommandosubstitution), och det är för lätt att råka skicka
  # fel antal till JSON-payloaden. Mallen skriver den bokstavliga JSON-
  # texten en gång, oavbrutet, och sed byter bara ut __NAME__ mot tjänstens
  # namn.
  pattern='^(system\\.ping(\\.__NAME__)?|events|__NAME__\\..*)$'
  permissions_json=$(printf '%s' "{\"configure\":\"$pattern\",\"write\":\"$pattern\",\"read\":\"$pattern\"}" | sed "s/__NAME__/$name/g")

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
