import os
from uuid import UUID, uuid4

from flask import g, jsonify
from psycopg import sql
from psycopg.types.json import Jsonb

from common.client import service_call
from common.db import database, initialize_records
from common.security import ApiError, base_app, json_body, require_roles
from common.validation import validate_record


def create_records_app(kind):
    donation = kind == "donation"
    role, schema, table, prefix = ("Donor", "donor", "donations", "DN-") if donation else ("Requester", "requester", "requests", "RQ-")
    app = base_app(schema)
    initialize_records(schema, table)
    identifier = sql.SQL("{}.{}").format(sql.Identifier(schema), sql.Identifier(table))
    public_path, internal_path = f"/api/{schema}/{table}", f"/internal/{table}"

    def record_id(value):
        try:
            if not value.startswith(prefix):
                raise ValueError()
            return UUID(value[len(prefix):])
        except ValueError:
            raise ApiError("Record not found.", 404)

    def serialize(row):
        flow = {"Pending": "Submitted", "Processed": "Confirmed" if donation else "Under Review",
                "Picked Up": "Received at Warehouse" if donation else "Delivered"}
        return {**row["data"], "id": prefix + str(row["id"]), "status": row["status"],
                "ownerId": str(row["owner_id"]) if row["owner_id"] else None,
                "flowStatus": flow[row["status"]], "submitted": row["created_at"].isoformat(),
                "updatedAt": row["updated_at"].isoformat()}

    def located(clean):
        preview = service_call(os.getenv("COORDINATOR_URL", "http://127.0.0.1:5000"), "/api/location/preview", "POST", clean)
        warehouse = preview["warehouse"]
        return {**clean, "latitude": preview["latitude"], "longitude": preview["longitude"],
                "address": clean["address"] or f"{preview['latitude']}, {preview['longitude']}",
                "warehouse": warehouse["name"], "warehouseAddress": warehouse["address"], "location": preview}

    @app.get(public_path)
    @require_roles(role)
    def own_records():
        with database() as connection:
            rows = connection.execute(sql.SQL("SELECT * FROM {} WHERE owner_id = %s ORDER BY created_at DESC").format(identifier), (g.user["sub"],)).fetchall()
        return jsonify([serialize(row) for row in rows])

    @app.get(public_path + "/<value>")
    @require_roles(role)
    def own_record(value):
        with database() as connection:
            row = connection.execute(sql.SQL("SELECT * FROM {} WHERE id = %s AND owner_id = %s").format(identifier), (record_id(value), g.user["sub"])).fetchone()
        if not row:
            raise ApiError("Record not found.", 404)
        return jsonify(serialize(row))

    @app.post(public_path)
    @require_roles(role)
    def submit():
        clean = located(validate_record(kind, json_body()))
        with database() as connection:
            row = connection.execute(sql.SQL("INSERT INTO {} (id, owner_id, data) VALUES (%s, %s, %s) RETURNING *").format(identifier), (uuid4(), g.user["sub"], Jsonb(clean))).fetchone()
        return jsonify(serialize(row)), 201

    @app.get(internal_path)
    @require_roles("Coordinator")
    def all_records():
        with database() as connection:
            rows = connection.execute(sql.SQL("SELECT * FROM {} ORDER BY created_at DESC").format(identifier)).fetchall()
        return jsonify([serialize(row) for row in rows])

    @app.patch(internal_path + "/<value>")
    @require_roles("Coordinator")
    def edit(value):
        identity, patch = record_id(value), json_body()
        editable = {"address", "latitude", "longitude", "status", "ownerId", "confirmLegacyUnits"}
        editable |= {"donor", "category", "quantityValue", "unit", "weightValue", "storage", "shelf", "expiry"} if donation else {"requester", "foodQuantities"}
        if not patch or set(patch) - editable:
            raise ApiError("Unsupported or empty update.")
        with database() as connection:
            row = connection.execute(sql.SQL("SELECT * FROM {} WHERE id = %s FOR UPDATE").format(identifier), (identity,)).fetchone()
            if not row:
                raise ApiError("Record not found.", 404)
            status = patch.get("status", row["status"])
            if not isinstance(status, str) or status not in {"Pending", "Processed", "Picked Up"}:
                raise ApiError("Invalid status.")
            owner = row["owner_id"]
            if "ownerId" in patch:
                try:
                    owner = UUID(patch["ownerId"])
                except (ValueError, TypeError, AttributeError):
                    raise ApiError("Select a valid account to own this record.")
                account = service_call(os.getenv("COORDINATOR_URL", "http://127.0.0.1:5000"), f"/internal/accounts/{owner}")
                if account["role"] != role:
                    raise ApiError(f"The owner must have the {role} role.")
            merged = {**row["data"], **patch}
            if "address" in patch and patch["address"] != row["data"]["address"] and "latitude" not in patch and "longitude" not in patch:
                merged.pop("latitude", None)
                merged.pop("longitude", None)
            clean = validate_record(kind, merged)
            data = located(clean) if set(patch) & {"address", "latitude", "longitude"} else {**row["data"], **clean}
            legacy = row["data"].get("legacy")
            if legacy:
                data["legacy"] = dict(legacy)
                if legacy.get("needsUnitReview"):
                    if patch.get("confirmLegacyUnits") is True:
                        data["legacy"]["needsUnitReview"] = False
                    else:
                        quantities_changed = (clean["quantityValue"] != row["data"]["quantityValue"] or clean["unit"] != row["data"]["unit"]) if donation else clean["foodQuantities"] != row["data"]["foodQuantities"]
                        if quantities_changed:
                            raise ApiError("Confirm the quantity units before changing imported quantities.")
                        data["quantity" if donation else "quantities"] = row["data"]["quantity" if donation else "quantities"]
            updated = connection.execute(sql.SQL("UPDATE {} SET data = %s, status = %s, owner_id = %s, updated_at = now() WHERE id = %s RETURNING *").format(identifier), (Jsonb(data), status, owner, identity)).fetchone()
        return jsonify(serialize(updated))

    @app.delete(internal_path + "/<value>")
    @require_roles("Coordinator")
    def delete(value):
        with database() as connection:
            row = connection.execute(sql.SQL("DELETE FROM {} WHERE id = %s RETURNING id").format(identifier), (record_id(value),)).fetchone()
        if not row:
            raise ApiError("Record not found.", 404)
        return jsonify(message="Record deleted.")

    return app

