#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v coordinator_password="$COORDINATOR_DB_PASSWORD" \
  -v donor_password="$DONOR_DB_PASSWORD" \
  -v requester_password="$REQUESTER_DB_PASSWORD" <<'SQL'
CREATE ROLE humanlog_coordinator LOGIN PASSWORD :'coordinator_password';
CREATE ROLE humanlog_donor LOGIN PASSWORD :'donor_password';
CREATE ROLE humanlog_requester LOGIN PASSWORD :'requester_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA coordinator AUTHORIZATION humanlog_coordinator;
CREATE SCHEMA donor AUTHORIZATION humanlog_donor;
CREATE SCHEMA requester AUTHORIZATION humanlog_requester;
REVOKE ALL ON SCHEMA coordinator, donor, requester FROM PUBLIC;
ALTER ROLE humanlog_coordinator SET search_path = coordinator, pg_catalog;
ALTER ROLE humanlog_donor SET search_path = donor, pg_catalog;
ALTER ROLE humanlog_requester SET search_path = requester, pg_catalog;
SQL

