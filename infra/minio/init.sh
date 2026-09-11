#!/bin/sh
# Skapar bucketen och en S3-nyckel SKILD från MinIO-root, begränsad till
# bara den bucketen. Körs som en engångscontainer (minio-init i
# docker-compose.yml), EFTER att MinIO är healthy och FÖRE att documents
# får starta.
#
# Utan det här kör documents med MINIO_ROOT_USER/MINIO_ROOT_PASSWORD —
# fullständig administrativ åtkomst till HELA objektlagret (alla buckets,
# policyer, andra tenants objekt om fler bucketar tillkommer). Samma
# resonemang som planens fas 7 (separata Postgres-roller): en tjänst ska
# bara kunna det den faktiskt behöver (PR-granskning fas 4, punkt 13).
#
# Idempotent: mb --ignore-existing, admin user add skriver över lösenordet
# om användaren redan finns, admin policy create/attach är säkra att köra
# om — allt säkert vid varje `docker compose up`.

set -eu

# MC_HOST_local (satt i docker-compose.yml) autentiserar `mc` som
# MinIO-root mot alias:et "local" utan en separat `mc alias set`.

echo "Väntar på MinIO..."
until mc ls local > /dev/null 2>&1; do
  sleep 1
done

echo "Skapar bucket '$S3_BUCKET'."
mc mb --ignore-existing "local/$S3_BUCKET"

echo "Skapar documents S3-nyckel, begränsad till '$S3_BUCKET'."
mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"

cat > /tmp/documents-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::${S3_BUCKET}/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::${S3_BUCKET}"]
    }
  ]
}
POLICY

mc admin policy create local documents-bucket-rw /tmp/documents-policy.json
mc admin policy attach local documents-bucket-rw --user "$S3_ACCESS_KEY_ID"

echo "Klart."
