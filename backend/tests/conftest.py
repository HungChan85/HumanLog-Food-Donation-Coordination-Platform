"""Integration tests use a temporary PostgreSQL database, never production tables."""
import os
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from flask import g
from psycopg import sql

from common.security import ApiError


@pytest.fixture(scope="session")
def system(tmp_path_factory):
    from services.coordinator import create_app as coordinator
    from services.donor import create_app as donor
    from services.requester import create_app as requester
    import common.records
    import services.coordinator
    import services.geography

    root = Path(__file__).resolve().parents[2]
    environment = {}
    if (root / ".env").exists():
        for line in (root / ".env").read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                name, value = line.split("=", 1)
                environment[name] = value
    password = environment.get("POSTGRES_PASSWORD", "local-postgres-change-me")
    admin = os.getenv("TEST_POSTGRES_URL", f"postgresql://postgres:{password}@127.0.0.1:5432/postgres")
    database_name = "humanlog_test_" + uuid4().hex
    with psycopg.connect(admin, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    admin_parameters = psycopg.conninfo.conninfo_to_dict(admin)
    admin_parameters["dbname"] = database_name
    with psycopg.connect(**admin_parameters, autocommit=True) as connection:
        for schema in ["coordinator", "donor", "requester"]:
            connection.execute(sql.SQL("CREATE SCHEMA {} AUTHORIZATION {}").format(sql.Identifier(schema), sql.Identifier("humanlog_" + schema)))
            connection.execute(sql.SQL("REVOKE ALL ON SCHEMA {} FROM PUBLIC").format(sql.Identifier(schema)))

    directory = tmp_path_factory.mktemp("keys")
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    (directory / "private.pem").write_bytes(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (directory / "public.pem").write_bytes(private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    settings = {"JWT_PRIVATE_KEY_FILE": str(directory / "private.pem"), "JWT_PUBLIC_KEY_FILE": str(directory / "public.pem"), "FRONTEND_ORIGINS": "http://localhost:8443", "DONOR_URL": "http://donor", "REQUESTER_URL": "http://requester", "COORDINATOR_URL": "http://coordinator"}
    clients, urls = {}, {}
    for schema, factory in [("coordinator", coordinator), ("donor", donor), ("requester", requester)]:
        parameters = {**admin_parameters, "user": "humanlog_" + schema, "password": environment.get(schema.upper() + "_DB_PASSWORD", f"local-{schema}-change-me")}
        urls[schema] = psycopg.conninfo.make_conninfo(**parameters)
        with patch.dict(os.environ, {**settings, "DATABASE_URL": urls[schema]}):
            clients[schema] = factory().test_client()

    def call(schema, path, method="GET", token=None, data=None, origin="http://localhost:8443"):
        headers = {"Origin": origin}
        if token:
            headers["Authorization"] = "Bearer " + token
        with patch.dict(os.environ, {**settings, "DATABASE_URL": urls[schema]}):
            return clients[schema].open(path, method=method, json=data, headers=headers)

    def transport(base, path, method="GET", data=None):
        schema = {"http://donor": "donor", "http://requester": "requester", "http://coordinator": "coordinator"}[base]
        response = call(schema, path, method, token=g.token, data=data)
        if response.status_code >= 400:
            raise ApiError(response.json["error"], response.status_code)
        return response.json

    with patch.object(common.records, "service_call", transport), patch.object(services.coordinator, "service_call", transport), patch.object(services.geography, "get_directions", return_value=None):
        yield {"call": call, "clients": clients, "urls": urls, "settings": settings}
    # Only the random database created above is dropped.
    with psycopg.connect(admin, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name)))

