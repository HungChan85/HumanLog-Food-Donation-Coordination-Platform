import copy
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from migrate_legacy import backup_sources, convert_row, extract, import_records
from tests.test_permissions import account, coordinator_token


def legacy_row(kind):
    common = {"warehouse_name": "Foodbank Quận 1", "warehouse_lat": 10.7707525, "warehouse_lon": 106.6976235,
              "distance": "0.6 km", "duration": "1.1 mins", "polyline": "[[10.773,106.70],[10.7707525,106.6976235]]",
              "status": "Pending", "timestamp": "2025-04-19T20:07:49.866126"}
    if kind == "donation":
        return {**common, "id": 1, "user_name": "Legacy bakery", "user_lat": 10.773, "user_lon": 106.70,
                "user_address": "Original pickup", "category": "Tươi sống", "quantity": 10,
                "weight": 1000, "method": "Cần kho mát", "date": "Trong tháng", "exp": "12/2/2024"}
    return {**common, "rid": 1, "requester_name": "Legacy community", "requester_lat": 10.773, "requester_lon": 106.70,
            "requester_address": "Original delivery", "dry_food_qty": 5, "fresh_food_qty": 3,
            "canned_food_qty": 10, "milk_cold_qty": 2, "spice_qty": 10}


@pytest.mark.parametrize("kind,schema,resource,role", [("donation", "donor", "donations", "Donor"), ("request", "requester", "requests", "Requester")])
def test_legacy_rows_hidden_until_valid_coordinator_assignment(system, kind, schema, resource, role):
    record = convert_row(kind, legacy_row(kind), uuid4().hex + ".db")
    with psycopg.connect(system["urls"][schema], row_factory=dict_row) as connection:
        assert import_records(connection, schema, [record]) == {"inserted": 1, "skipped": 0}
    identity = ("DN-" if schema == "donor" else "RQ-") + str(record["id"])
    token, user = account(system, role)
    other, _ = account(system, role)
    wrong_role, wrong_user = account(system, "Requester" if role == "Donor" else "Donor")
    coordinator = coordinator_token(system)
    endpoint = f"/api/{schema}/{resource}"
    management = f"/api/coordinator/{resource}/{identity}"
    assert system["call"](schema, endpoint + "/" + identity, token=token).status_code == 404
    assert not any(row["id"] == identity for row in system["call"](schema, endpoint, token=token).json)
    listing = system["call"]("coordinator", f"/api/coordinator/{resource}", token=coordinator)
    imported = next(row for row in listing.json if row["id"] == identity)
    assert imported["ownerId"] is None
    assert "unit not recorded" in imported["quantity" if kind == "donation" else "quantities"]
    assert system["call"]("coordinator", management, "PATCH", token, {"ownerId": user["id"]}).status_code == 403
    assert system["call"]("coordinator", management, "PATCH", coordinator, {"ownerId": wrong_user["id"]}).status_code == 400
    assert system["call"]("coordinator", management, "PATCH", coordinator, {"ownerId": str(uuid4())}).status_code == 404
    assert system["call"]("coordinator", management, "PATCH", coordinator, {"ownerId": None}).status_code == 400
    assigned = system["call"]("coordinator", management, "PATCH", coordinator, {"ownerId": user["id"], "status": "Processed"})
    assert assigned.status_code == 200, assigned.json
    assert assigned.json["ownerId"] == user["id"]
    assert "unit not recorded" in assigned.json["quantity" if kind == "donation" else "quantities"]
    assert system["call"](schema, endpoint + "/" + identity, token=token).json["status"] == "Processed"
    assert system["call"](schema, endpoint + "/" + identity, token=other).status_code == 404
    assert system["call"]("coordinator", "/internal/accounts/" + user["id"], token=wrong_role).status_code == 403
    data = {"quantityValue": 12} if kind == "donation" else {"foodQuantities": {"dry": 12}}
    assert system["call"]("coordinator", management, "PATCH", coordinator, data).status_code == 400
    confirmed = system["call"]("coordinator", management, "PATCH", coordinator, {**data, "confirmLegacyUnits": True})
    assert confirmed.status_code == 200
    assert confirmed.json["legacy"]["needsUnitReview"] is False
    assert "unit not recorded" not in confirmed.json["quantity" if kind == "donation" else "quantities"]
    with psycopg.connect(system["urls"][schema], row_factory=dict_row) as connection:
        assert import_records(connection, schema, [record]) == {"inserted": 0, "skipped": 1}
        persisted = connection.execute(f"SELECT owner_id, status FROM {schema}.{resource} WHERE id = %s", (record["id"],)).fetchone()
        assert str(persisted["owner_id"]) == user["id"]
        assert persisted["status"] == "Processed"
    assert system["call"]("coordinator", management, "DELETE", coordinator).status_code == 200
    with psycopg.connect(system["urls"][schema], row_factory=dict_row) as connection:
        assert import_records(connection, schema, [record]) == {"inserted": 0, "skipped": 1}
        assert connection.execute(f"SELECT id FROM {schema}.{resource} WHERE id = %s", (record["id"],)).fetchone() is None


def test_conversion_preserves_legacy_values_and_converts_grams():
    original = legacy_row("donation")
    record = convert_row("donation", original, "donations.db")
    assert record["data"]["weightValue"] == 1
    assert record["data"]["weight"] == "1 kg"
    assert record["data"]["expiry"] == ""
    assert record["data"]["legacy"]["originalExpiry"] == "12/2/2024"
    assert record["data"]["legacy"]["original"] == original
    assert record["created_at"] == datetime(2025, 4, 19, 13, 7, 49, 866126, tzinfo=timezone.utc)
    assert record["data"]["location"]["route"]["distanceKm"] == 0.6
    assert record["data"]["location"]["route"]["durationMinutes"] == 1.1
    assert record["data"]["location"]["route"]["points"] == json.loads(original["polyline"])
    assert record["id"] == convert_row("donation", original, "donations.db")["id"]


def test_changed_sources_rejected_without_partial_service_import(system):
    record = convert_row("donation", legacy_row("donation"), uuid4().hex + ".db")
    fresh = convert_row("donation", {**legacy_row("donation"), "id": 2}, uuid4().hex + ".db")
    altered = copy.deepcopy(record)
    altered["source_hash"] = "changed"
    with psycopg.connect(system["urls"]["donor"], row_factory=dict_row) as connection:
        import_records(connection, "donor", [record])
        with pytest.raises(ValueError, match="Source changed"):
            import_records(connection, "donor", [fresh, altered])
        assert connection.execute("SELECT id FROM donor.donations WHERE id = %s", (fresh["id"],)).fetchone() is None


def test_sqlite_extraction_and_backup_do_not_change_sources(tmp_path):
    original = legacy_row("donation")
    source = tmp_path / "donations.db"
    connection = sqlite3.connect(source)
    columns = ", ".join(f'"{key}"' for key in original)
    connection.execute(f"CREATE TABLE donations ({columns})")
    connection.execute(f"INSERT INTO donations VALUES ({','.join('?' for _ in original)})", tuple(original.values()))
    connection.commit()
    connection.close()
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    records = extract(source, "donation")
    backup_sources([source], tmp_path / "backups")
    assert len(records) == 1
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    backup = sqlite3.connect(tmp_path / "backups/donations.db")
    assert backup.execute("SELECT count(*) FROM donations").fetchone()[0] == 1
    backup.close()


def test_account_directory_only_coordinator_and_correct_role(system):
    donor, donor_user = account(system, "Donor")
    requester, requester_user = account(system, "Requester")
    coordinator = coordinator_token(system)
    for token in [donor, requester]:
        assert system["call"]("coordinator", "/api/coordinator/accounts?role=Donor", token=token).status_code == 403
    result = system["call"]("coordinator", "/api/coordinator/accounts?role=Donor", token=coordinator)
    assert result.status_code == 200
    assert any(user["id"] == donor_user["id"] for user in result.json)
    assert not any(user["id"] == requester_user["id"] for user in result.json)
    assert all(set(user) == {"id", "email", "name", "role"} for user in result.json)
    assert system["call"]("coordinator", "/api/coordinator/accounts?role=Coordinator", token=coordinator).status_code == 400
