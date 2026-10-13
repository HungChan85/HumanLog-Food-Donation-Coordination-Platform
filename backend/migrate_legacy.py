"""Read-only SQLite extraction and repeatable PostgreSQL import with no invented owners."""
import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from common.db import initialize_records
from common.validation import QUANTITIES, validate_record
from services.geography import find_nearest_warehouse, haversine

ROOT = Path(__file__).resolve().parent.parent
CATEGORIES = {"thực phẩm khô": "Dry Food", "tươi sống": "Fresh Food", "đồ hộp": "Canned Food",
              "sữa/ đồ lạnh": "Dairy & Chilled Food", "gia vị": "Condiments"}
STORAGE = {"bình thường": "Ambient", "cần kho mát": "Chilled", "đông lạnh": "Frozen"}
SHELF = {"trong ngày": "Within a Day", "trong tuần": "Within a Week", "trong tháng": "Within a Month", "trên 6 tháng": "Over Six Months"}
REQUEST_FIELDS = {"dry": "dry_food_qty", "fresh": "fresh_food_qty", "canned": "canned_food_qty", "dairy": "milk_cold_qty", "condiments": "spice_qty"}


def mapped(value, options, field):
    if not isinstance(value, str):
        raise ValueError(f"Missing legacy {field}.")
    if value in options.values():
        return value
    try:
        return options[value.strip().casefold()]
    except KeyError:
        raise ValueError(f"Unsupported legacy {field}: {value}")


def route_number(value, unit):
    if not isinstance(value, str) or not re.fullmatch(r"\s*\d+(?:\.\d+)?\s*" + unit + r"\s*", value):
        return None
    return float(value.strip().split()[0])


def stored_route(row):
    distance, duration = route_number(row.get("distance"), "km"), route_number(row.get("duration"), "mins?")
    try:
        points = json.loads(row.get("polyline") or "null")
        if not isinstance(points, list) or not points:
            return None
        for point in points:
            if not isinstance(point, list) or len(point) != 2:
                return None
            lat, lon = map(float, point)
            if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                return None
        if distance is None or duration is None:
            return None
        return {"distanceKm": distance, "durationMinutes": duration, "points": points}
    except (ValueError, TypeError):
        return None


def convert_row(kind, row, source_name, legacy_timezone="Asia/Ho_Chi_Minh"):
    donation = kind == "donation"
    old_id = row["id" if donation else "rid"]
    source_key = f"{source_name}:{'donations' if donation else 'requests'}:{old_id}"
    fingerprint = hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()
    source_timestamp = datetime.fromisoformat(row["timestamp"])
    if source_timestamp.tzinfo is None:
        source_timestamp = source_timestamp.replace(tzinfo=ZoneInfo(legacy_timezone))
    created_at = source_timestamp.astimezone(timezone.utc)
    expiry_text = (row.get("exp") or "").strip()
    expiry = ""
    if expiry_text:
        try:
            expiry = date.fromisoformat(expiry_text).isoformat()
        except ValueError:
            pass  # Preserve ambiguous dates exactly; do not guess day/month order.
    if donation:
        payload = {"donor": row["user_name"], "category": mapped(row["category"], CATEGORIES, "category"),
                   "quantityValue": row["quantity"], "unit": "units",
                   # The old form explicitly labelled this field as grams.
                   "weightValue": float(row["weight"]) / 1000,
                   "storage": mapped(row["method"], STORAGE, "storage"),
                   "shelf": mapped(row["date"], SHELF, "shelf life"), "expiry": expiry,
                   "address": row.get("user_address") or "", "latitude": row["user_lat"], "longitude": row["user_lon"]}
    else:
        payload = {"requester": row["requester_name"], "address": row.get("requester_address") or "",
                   "latitude": row["requester_lat"], "longitude": row["requester_lon"],
                   "foodQuantities": {field: row.get(old_field) or 0 for field, old_field in REQUEST_FIELDS.items()}}
    clean = validate_record(kind, payload)
    lat, lon = clean["latitude"], clean["longitude"]
    nearest, ranked = find_nearest_warehouse(lat, lon)
    warehouse = next((warehouse for warehouse in ranked
                      if warehouse["name"] == row["warehouse_name"]
                      and abs(warehouse["lat"] - float(row["warehouse_lat"])) < 1e-7
                      and abs(warehouse["lon"] - float(row["warehouse_lon"])) < 1e-7), None)
    if warehouse is None:
        raise ValueError(f"Unrecognized recorded warehouse for {source_key}.")
    route = stored_route(row)
    preview = {"latitude": lat, "longitude": lon, "warehouse": warehouse, "warehouses": ranked,
               "geographicDistanceKm": haversine(lat, lon, warehouse["lat"], warehouse["lon"]), "route": route}
    status = row["status"]
    if status not in {"Pending", "Processed", "Picked Up"}:
        raise ValueError(f"Invalid legacy status for {source_key}.")
    warnings = ["Quantity units were not recorded; coordinator must confirm them."]
    if expiry_text and not expiry:
        warnings.append(f"Expiry text preserved without guessing a date: {expiry_text}")
    if row["warehouse_name"] != nearest["name"]:
        warnings.append("Recorded warehouse differs from the current nearest warehouse; original assignment preserved.")
    if route is None:
        warnings.append("No valid stored road route; geographic warehouse information preserved.")
    if donation:
        clean["quantity"] = f"{clean['quantityValue']:g} (unit not recorded)"
    else:
        clean["quantities"] = " · ".join(f"{label} {clean['foodQuantities'][field]:g} (unit not recorded)"
                                           for field, (label, _) in QUANTITIES.items() if clean["foodQuantities"][field])
    data = {**clean, "address": clean["address"] or f"{lat}, {lon}", "warehouse": warehouse["name"],
            "warehouseAddress": warehouse["address"], "location": preview,
            "legacy": {"sourceKey": source_key, "sourceHash": fingerprint, "original": row,
                       "originalExpiry": expiry_text, "needsUnitReview": True, "warnings": warnings,
                       "assumedTimezone": legacy_timezone if datetime.fromisoformat(row["timestamp"]).tzinfo is None else None}}
    return {"id": uuid5(NAMESPACE_URL, "humanlog:legacy:" + source_key), "data": data,
            "status": status, "created_at": created_at, "source_key": source_key, "source_hash": fingerprint}


def extract(path, kind, legacy_timezone="Asia/Ho_Chi_Minh"):
    path = Path(path).resolve(strict=True)
    table = "donations" if kind == "donation" else "requests"
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(f"SELECT * FROM {table} ORDER BY {'id' if kind == 'donation' else 'rid'}").fetchall()
    return [convert_row(kind, dict(row), path.name, legacy_timezone) for row in rows]


def backup_sources(paths, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    for path in paths:
        path = Path(path).resolve(strict=True)
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(directory / path.name)) as backup:
                source.backup(backup)


def import_records(connection, schema, records):
    if schema not in {"donor", "requester"}:
        raise ValueError("Legacy records belong only in donor/requester schemas.")
    table = "donations" if schema == "donor" else "requests"
    ledger = sql.SQL("{}.legacy_imports").format(sql.Identifier(schema))
    target = sql.SQL("{}.{}").format(sql.Identifier(schema), sql.Identifier(table))
    inserted, skipped = 0, 0
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("humanlog:legacy:" + schema,))
        # Validate the entire batch before inserting anything in this service.
        pending = []
        for record in records:
            existing = connection.execute(sql.SQL("SELECT source_hash, record_id FROM {} WHERE source_key = %s").format(ledger), (record["source_key"],)).fetchone()
            if existing:
                if existing["source_hash"] != record["source_hash"] or existing["record_id"] != record["id"]:
                    raise ValueError(f"Source changed since import: {record['source_key']}. Review it before reimporting.")
                skipped += 1  # Includes coordinator-deleted records; never resurrect them.
            else:
                pending.append(record)
        for record in pending:
            connection.execute(sql.SQL("INSERT INTO {} (id, owner_id, data, status, created_at, updated_at) VALUES (%s, NULL, %s, %s, %s, %s)").format(target),
                               (record["id"], Jsonb(record["data"]), record["status"], record["created_at"], record["created_at"]))
            connection.execute(sql.SQL("INSERT INTO {} (source_key, source_hash, record_id) VALUES (%s, %s, %s)").format(ledger),
                               (record["source_key"], record["source_hash"], record["id"]))
            inserted += 1
    return {"inserted": inserted, "skipped": skipped}


def connection_settings(schema):
    environment = {}
    if (ROOT / ".env").exists():
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                name, value = line.split("=", 1)
                environment[name.strip()] = value.strip()
    environment.update(os.environ)
    explicit = environment.get(schema.upper() + "_DATABASE_URL")
    if explicit:
        return explicit
    return psycopg.conninfo.make_conninfo(host=environment.get("POSTGRES_HOST", "127.0.0.1"),
                                         port=environment.get("POSTGRES_PORT", "5432"),
                                         dbname=environment.get("POSTGRES_DB", "humanlog"),
                                         user="humanlog_" + schema,
                                         password=environment[schema.upper() + "_DB_PASSWORD"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Back up SQLite sources and import unassigned rows; default is preview only.")
    parser.add_argument("--donations", type=Path, default=ROOT / "backend/donations.db")
    parser.add_argument("--requests", type=Path, default=ROOT / "backend/requestlist.db")
    parser.add_argument("--legacy-timezone", default="Asia/Ho_Chi_Minh")
    parser.add_argument("--output", type=Path, default=ROOT / "migration/legacy-plan.json")
    args = parser.parse_args()
    sources = [("donor", "donation", args.donations), ("requester", "request", args.requests)]
    batches = {schema: extract(path, kind, args.legacy_timezone) for schema, kind, path in sources}
    report = {"mode": "preview", "legacyTimezone": args.legacy_timezone,
              "records": [{"schema": schema, "id": ("DN-" if schema == "donor" else "RQ-") + str(record["id"]),
                           "sourceKey": record["source_key"], "ownerId": None, "status": record["status"],
                           "warnings": record["data"]["legacy"]["warnings"]}
                          for schema, batch in batches.items() for record in batch]}
    if args.apply:
        directory = ROOT / "migration/backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_sources([path for _, _, path in sources], directory)
        report.update(mode="applied", backupDirectory=str(directory), results={})
        for schema, batch in batches.items():
            dsn = connection_settings(schema)
            previous = os.environ.get("DATABASE_URL")
            os.environ["DATABASE_URL"] = dsn
            try:
                initialize_records(schema, "donations" if schema == "donor" else "requests")
            finally:
                if previous is None:
                    os.environ.pop("DATABASE_URL", None)
                else:
                    os.environ["DATABASE_URL"] = previous
            with psycopg.connect(dsn, row_factory=dict_row) as connection:
                report["results"][schema] = import_records(connection, schema, batch)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{report['mode']}: {len(report['records'])} records. Report: {args.output}")
    if args.apply:
        print(json.dumps(report["results"]))
        print("Imported records remain coordinator-only until assigned to verified Donor/Requester accounts.")


if __name__ == "__main__":
    main()
