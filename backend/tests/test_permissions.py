import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

import jwt
import psycopg
import pytest

from common.security import AUDIENCE, COOKIE, ISSUER, key
from services.geography import find_nearest_warehouse, haversine

DONATION = {"donor": "Test bakery", "category": "Fresh Food", "quantityValue": 10, "unit": "boxes", "weightValue": 25, "storage": "Chilled", "shelf": "Within a Day", "expiry": "", "address": "Test pickup", "latitude": 10.7707525, "longitude": 106.6976235}
REQUEST = {"requester": "Test community", "foodQuantities": {"dry": 12, "fresh": 4, "canned": 0, "dairy": 0, "condiments": 0}, "address": "Test delivery", "latitude": 10.80484845, "longitude": 106.71676215550468}


def account(system, role):
    result = system["call"]("coordinator", "/api/auth/register", "POST", data={"email": uuid4().hex + "@example.test", "password": "Integration-password-123", "name": role + " test", "role": role})
    assert result.status_code == 201
    return system["clients"]["coordinator"].get_cookie(COOKIE).value, result.json["user"]


def coordinator_token(system):
    with patch.dict(os.environ, system["settings"]):
        now = datetime.now(timezone.utc)
        return jwt.encode({"sub": str(uuid4()), "role": "Coordinator", "iat": now, "exp": now + timedelta(hours=1), "iss": ISSUER, "aud": AUDIENCE}, key("JWT_PRIVATE_KEY_FILE"), algorithm="RS256")


@pytest.mark.parametrize("role,schema,path,payload", [("Donor", "donor", "donations", DONATION), ("Requester", "requester", "requests", REQUEST)])
def test_ownership_persistence_and_coordinator_changes(system, role, schema, path, payload):
    token, user = account(system, role)
    other, _ = account(system, role)
    coordinator = coordinator_token(system)
    endpoint = f"/api/{schema}/{path}"
    created = system["call"](schema, endpoint, "POST", token, {**payload, "owner_id": str(uuid4()), "status": "Picked Up"})
    assert created.status_code == 201, created.json
    identity = created.json["id"]
    assert created.json["status"] == "Pending"
    assert created.json["location"]["route"] is None  # OSRM failure does not block submission.
    assert created.json["location"]["geographicDistanceKm"] == pytest.approx(0)
    assert system["call"](schema, endpoint, token=other).json == []
    assert system["call"](schema, endpoint + "/" + identity, token=other).status_code == 404
    assert any(record["id"] == identity for record in system["call"](schema, endpoint, token=token).json)
    with psycopg.connect(system["urls"][schema]) as connection:
        row = connection.execute(f"SELECT owner_id FROM {schema}.{path} WHERE id = %s", (identity[3:],)).fetchone()
        assert str(row[0]) == user["id"]
    assert system["call"](schema, f"/internal/{path}/{identity}", "PATCH", token, {"status": "Processed"}).status_code == 403
    patch_data = {"status": "Processed", "quantityValue": 11} if role == "Donor" else {"status": "Processed", "foodQuantities": {"dry": 15}}
    updated = system["call"]("coordinator", f"/api/coordinator/{path}/{identity}", "PATCH", coordinator, patch_data)
    assert updated.status_code == 200, updated.json
    assert system["call"](schema, endpoint + "/" + identity, token=token).json["status"] == "Processed"
    assert system["call"]("coordinator", f"/api/coordinator/{path}/{identity}", "PATCH", coordinator, {"owner_id": str(uuid4())}).status_code == 400
    assert system["call"]("coordinator", f"/api/coordinator/{path}/{identity}", "DELETE", coordinator).status_code == 200
    assert system["call"](schema, endpoint + "/" + identity, token=token).status_code == 404


@pytest.mark.parametrize("role,blocked_schema,blocked_path", [("Donor", "requester", "requests"), ("Requester", "donor", "donations")])
def test_cross_role_access_denied(system, role, blocked_schema, blocked_path):
    token, _ = account(system, role)
    assert system["call"](blocked_schema, f"/api/{blocked_schema}/{blocked_path}", token=token).status_code == 403
    assert system["call"](blocked_schema, f"/api/{blocked_schema}/{blocked_path}", "POST", token, REQUEST if blocked_path == "requests" else DONATION).status_code == 403
    for path in ["donations", "requests", "warehouses"]:
        assert system["call"]("coordinator", "/api/coordinator/" + path, token=token).status_code == 403
    assert system["call"](blocked_schema, "/internal/" + blocked_path, token=token).status_code == 403


def test_registration_login_session_and_csrf(system):
    email = uuid4().hex + "@example.test"
    payload = {"email": email, "password": "Strong-password-123", "name": "Account", "role": "Coordinator"}
    assert system["call"]("coordinator", "/api/auth/register", "POST", data=payload).status_code == 403
    payload["role"] = "Donor"
    registered = system["call"]("coordinator", "/api/auth/register", "POST", data=payload)
    assert registered.status_code == 201
    assert "HttpOnly" in registered.headers["Set-Cookie"]
    assert "SameSite=Lax" in registered.headers["Set-Cookie"]
    assert system["call"]("coordinator", "/api/auth/register", "POST", data=payload).status_code == 409
    assert system["call"]("coordinator", "/api/auth/login", "POST", data={**payload, "password": "Incorrect-password"}).status_code == 401
    assert system["call"]("coordinator", "/api/auth/login", "POST", data=payload).status_code == 200
    assert system["call"]("coordinator", "/api/auth/logout", "POST", origin="https://untrusted.test").status_code == 403
    assert system["call"]("coordinator", "/api/auth/logout", "POST").status_code == 200
    assert system["call"]("coordinator", "/api/auth/me").status_code == 401


def test_forged_role_and_expired_tokens(system):
    token, _ = account(system, "Donor")
    claims = jwt.decode(token, options={"verify_signature": False})
    claims["role"] = "Coordinator"
    forged = jwt.encode(claims, "malicious-key-that-is-at-least-32-bytes", algorithm="HS256")
    assert system["call"]("coordinator", "/api/coordinator/donations", token=forged).status_code == 401
    with patch.dict(os.environ, system["settings"]):
        claims["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
        expired = jwt.encode(claims, key("JWT_PRIVATE_KEY_FILE"), algorithm="RS256")
    assert system["call"]("donor", "/api/donor/donations", token=expired).status_code == 401


@pytest.mark.parametrize("field,value", [("quantityValue", -1), ("weightValue", float("nan")), ("latitude", 100), ("longitude", float("inf")), ("category", "Unknown")])
def test_invalid_donation_rejected(system, field, value):
    token, _ = account(system, "Donor")
    assert system["call"]("donor", "/api/donor/donations", "POST", token, {**DONATION, field: value}).status_code == 400


@pytest.mark.parametrize("quantities", [{}, {"dry": -2}, {"dry": float("nan")}, {"dry": 0}, {"dry": 1, "other": 2}])
def test_invalid_request_rejected(system, quantities):
    token, _ = account(system, "Requester")
    assert system["call"]("requester", "/api/requester/requests", "POST", token, {**REQUEST, "foodQuantities": quantities}).status_code == 400


@pytest.mark.parametrize("schema,foreign", [("coordinator", "donor"), ("donor", "requester"), ("requester", "coordinator")])
def test_postgres_schema_isolation(system, schema, foreign):
    table = "accounts" if foreign == "coordinator" else "donations" if foreign == "donor" else "requests"
    with psycopg.connect(system["urls"][schema]) as connection:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(f"SELECT * FROM {foreign}.{table}")


def test_original_nearest_warehouse_calculation():
    warehouse, ranked = find_nearest_warehouse(10.7707525, 106.6976235)
    assert warehouse["name"] == "Foodbank Quận 1"
    assert warehouse["distanceKm"] == pytest.approx(0)
    assert len(ranked) == 3
    assert [item["distanceKm"] for item in ranked] == sorted(item["distanceKm"] for item in ranked)
    assert haversine(0, 0, 0, 1) == pytest.approx(111.195, abs=0.001)

