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

# Dead-letter-exchange + en landningskö, deklarerade NU medan kö-argument
# fortfarande är billiga att sätta. Köargument är OFÖRÄNDERLIGA i
# RabbitMQ — att lägga till x-dead-letter-exchange senare skulle kräva att
# documents.events och billing.events raderas och återskapas.
#
# Fas 7: alla konsumenter (documents/consumer.py, billings deliveries-
# och payments-konsumenter) nackar nu (requeue=false) när de ger upp efter
# maxantal försök, så meddelanden FAKTISKT landar här. En policy nedan
# sätter message-ttl på events.dlq — utan den växer kön obegränsat om
# ingen operatör tömmer den; 7 dagar ger gott om tid att upptäcka och
# åtgärda innan meddelandet försvinner (GET /internal/ops/alerts i billing
# visar ködjupet under tiden).
echo "Deklarerar dead-letter-exchanget."
curl -sf -u "$AUTH" -X PUT "$API/exchanges/%2F/events.dlx" \
  -H "Content-Type: application/json" \
  -d '{"type":"fanout","durable":true}' > /dev/null
curl -sf -u "$AUTH" -X PUT "$API/queues/%2F/events.dlq" \
  -H "Content-Type: application/json" \
  -d '{"durable":true}' > /dev/null
curl -sf -u "$AUTH" -X POST "$API/bindings/%2F/e/events.dlx/q/events.dlq" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null
curl -sf -u "$AUTH" -X PUT "$API/policies/%2F/events-dlq-ttl" \
  -H "Content-Type: application/json" \
  -d '{"pattern":"^events\\.dlq$","apply-to":"queues","definition":{"message-ttl":604800000}}' > /dev/null

# Konsumenternas köer deklareras och BINDS här också, inte lämnat åt varje
# tjänst att göra vid sin egen uppstart. Ett topic-exchange utan matchande
# bindning SLÄNGER meddelandet (publisher-confirms bekräftar bara att
# brokern tog emot det, inte att det ruttades någonstans) — så på ett
# färskt `docker compose up` (eller i CI) kan billing hinna publicera
# invoice.sent innan documents-containern startat och bundit sin kö, och
# eventet är då borta för alltid trots att outboxen säger published_at.
# Genom att skapa och binda köerna här, INNAN någon tjänst får starta, kan
# det race:et inte uppstå. Tjänsternas egen queue.bind vid uppstart (se
# consumer.py/deliveries/consumer.ts) blir då bara en no-op-bekräftelse av
# en bindning som redan finns (RabbitMQ dedupar identiska bindningar).
declare_bound_queue() {
  queue="$1"
  shift
  curl -sf -u "$AUTH" -X PUT "$API/queues/%2F/$queue" \
    -H "Content-Type: application/json" \
    -d '{"durable":true,"arguments":{"x-dead-letter-exchange":"events.dlx"}}' > /dev/null
  for routing_key in "$@"; do
    curl -sf -u "$AUTH" -X POST "$API/bindings/%2F/e/events/q/$queue" \
      -H "Content-Type: application/json" \
      -d "{\"routing_key\":\"$routing_key\"}" > /dev/null
  done
  echo "  ✓ $queue ($*)"
}

echo "Deklarerar och binder konsumentköer."
declare_bound_queue "documents.events" "invoice.sent" "invoice.credited"
declare_bound_queue "billing.events" "invoice.delivery_updated"
# EGEN kö, inte fler routing keys på billing.events: två separat
# REGISTRERADE konsumenter (deliveries/consumer.ts och payments/consumer.ts)
# på SAMMA kö skulle få RabbitMQ att round-robina meddelanden mellan dem
# oavsett routing key — payment.matched kunde då hämtas av
# leveranskonsumenten (som inte känner igen eventtypen) och tvärtom,
# ungefär hälften av gångerna. En kö per konsument-registrering håller
# fördelningen deterministisk (fas 5-planens avsnitt 3.2 nämnde
# ursprungligen en delad kö — det här är en medveten, granskad avvikelse).
declare_bound_queue "billing.payments.events" "payment.matched" "payment.partial"

echo "Skapar tjänstekonton."

create_user() {
  name="$1"
  password="$2"
  # Valfri EXTRA resurs (regex-alternativ, REDAN escapad, t.ex.
  # "events\\.dlq") att lägga till i "configure" — fas 7: billing behöver
  # göra en PASSIV queue.declare (amqplibs checkQueue) mot events.dlq för
  # att läsa dess meddelandeantal (GET /internal/ops/alerts). RabbitMQs
  # behörighetsmodell kräver "configure" för queue.declare oavsett
  # passive-flaggan — INTE "read" (den behövs bara för att KONSUMERA, vilket
  # billing aldrig gör mot den kön). Tomt för de andra tre tjänsterna.
  extra="${3:-}"
  # Behörigheter per tjänst, granskningsbart och smalt:
  #   configure : sin egen system.ping.<namn>-kö + sina egna "<namn>.*"-köer
  #               + system.ping-exchanget (fanout, deklareras av tjänsten)
  #               + ev. extra (se ovan)
  #   write     : publicera på system.ping och events, binda sina egna köer,
  #               OCH publicera på default-exchanget ("amq.default"), som
  #               krävs för konsumenternas x-attempts-ompublicering — se
  #               nästa stycke.
  #   read      : konsumera sina egna köer, binda mot system.ping/events
  # "events" saknas medvetet ur "configure" (se ovan).
  curl -sf -u "$AUTH" -X PUT "$API/users/$name" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$password\",\"tags\":\"\"}" > /dev/null

  # RabbitMQs permissionsmodell för queue.bind kräver "write" på KÖN (inte
  # bara på exchanget) — annars 403 vid varje bind. Se
  # https://www.rabbitmq.com/docs/access-control#permissions
  #
  # "amq\\.default": default-exchangets INTERNA namn är tom sträng (""),
  # men RabbitMQs behörighetskontroll för basic.publish mot det prövar
  # regeln mot den STRÄNGEN "amq.default" (samma namn felmeddelandet
  # visar: "write access to exchange 'amq.default' ... refused") — inte
  # mot "" som man annars kan tro utifrån exchangets faktiska namn.
  # Verifierat direkt mot Erlangs re-modul (samma motor RabbitMQ
  # använder): "^($|...)$" matchar "" fint men INTE "amq.default".
  #
  # deliveries/consumer.ts och payments/consumer.ts republicerar VID FEL
  # via just default-exchanget (channel.publish("", <kö>, ...) — routing
  # key = könamnet är hur RabbitMQ routar via default-exchanget till en
  # specifik kö utan en egen bindning). Utan den här behörigheten
  # nekades publiceringen tyst (access_refused), och retry-/dead-letter-
  # mekanismen kunde ALDRIG faktiskt försöka om ett meddelande — upptäckt
  # under PR-granskning fas 5 (punkt 5/6) när en konfirmerad kanal gjorde
  # den tidigare TYSTA nekade publiceringen till en KRASCH i stället,
  # vilket avslöjade att behörigheten saknats sedan fas 4.
  #
  # Hela JSON-payloaden skrivs som en enkelcitatad mall (så sh inte rör
  # backslash) och sed byter bara ut __NAME__ — precis som förut.
  # "configure" saknar "events".
  permissions_json=$(printf '%s' '{"configure":"^(system\\.ping(\\.__NAME__)?|__NAME__\\..*__EXTRA__)$","write":"^(amq\\.default|system\\.ping(\\.__NAME__)?|events|__NAME__\\..*)$","read":"^(system\\.ping(\\.__NAME__)?|events|__NAME__\\..*)$"}' \
    | sed "s/__NAME__/$name/g")

  # __EXTRA__ ersätts INTE med sed: $extra kan innehålla bakstreck (t.ex.
  # "events\\.dlq"), som sed:s ERSÄTTNINGSsyntax skulle tolka om (\1 m.m.).
  # Ren strängdelning i stället — den omtolkar aldrig innehållet.
  extra_alt=""
  if [ -n "$extra" ]; then
    extra_alt="|$extra"
  fi
  permissions_json="${permissions_json%%__EXTRA__*}${extra_alt}${permissions_json#*__EXTRA__}"

  curl -sf -u "$AUTH" -X PUT "$API/permissions/%2F/$name" \
    -H "Content-Type: application/json" \
    -d "$permissions_json" > /dev/null

  echo "  ✓ $name"
}

create_user "auth" "${AUTH_RABBITMQ_PASSWORD}"
# events\\.dlq (redan JSON/regex-escapad): fas 7, GET /internal/ops/alerts
# behöver en passiv queue.declare mot dead-letter-kön — se create_user ovan.
create_user "billing" "${BILLING_RABBITMQ_PASSWORD}" 'events\\.dlq'
create_user "payments" "${PAYMENTS_RABBITMQ_PASSWORD}"
create_user "documents" "${DOCUMENTS_RABBITMQ_PASSWORD}"

echo "Klart."
