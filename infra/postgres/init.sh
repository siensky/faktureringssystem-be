#!/bin/sh
# Sätter LOGIN-lösenordet för de fyra tjänsternas Postgres-roller (fas 7).
# Rollerna och deras GRANT skapas i migrations/0008_service_roles.js —
# STRUKTUR, en migration per fas (database.md #1). Lösenordet hör INTE
# hemma där: en applicerad migration ändras aldrig (database.md #2), men
# ett lösenord måste gå att ROTERA. Den här scriptet är den om-körbara
# motsvarigheten, exakt samma mönster som infra/rabbitmq/init.sh redan
# använder för RabbitMQ-kontona.
#
# Körs som en engångscontainer (postgres-init i docker-compose.yml) EFTER
# migrate (så rollerna redan finns) och FÖRE de fyra tjänsterna (som
# kopplar upp med just de här lösenorden).
#
# Idempotent: ALTER ROLE ... PASSWORD skriver om det befintliga lösenordet
# — säkert att köra om vid varje `docker compose up`.
#
# Lösenord kommer från miljön (code-style.md #23), aldrig hårdkodade här.
# DATABASE_URL är den delade SUPERUSER-anslutningen (samma som
# migrate/seed använder) — bara den kan skapa/ändra roller.

set -eu

alter_password() {
  role="$1"
  password="$2"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "ALTER ROLE \"$role\" WITH LOGIN PASSWORD '$password';"
  echo "  ✓ $role"
}

echo "Väntar på Postgres..."
until psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; do
  sleep 1
done

echo "Sätter lösenord för tjänsternas Postgres-roller."
alter_password "auth" "$AUTH_DB_PASSWORD"
alter_password "billing" "$BILLING_DB_PASSWORD"
alter_password "payments" "$PAYMENTS_DB_PASSWORD"
alter_password "documents" "$DOCUMENTS_DB_PASSWORD"
echo "Klart."
