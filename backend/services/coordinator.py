import os
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import click
import jwt
from flask import g, jsonify, request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from werkzeug.security import check_password_hash, generate_password_hash

from common.client import service_call
from common.db import database
from common.security import ApiError, AUDIENCE, COOKIE, ISSUER, base_app, json_body, key, require_roles
from common.validation import string
from services.geography import WAREHOUSES, location_preview


def initialize():
    with database() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS coordinator.accounts (
                id uuid PRIMARY KEY, email text UNIQUE NOT NULL,
                name text NOT NULL, password_hash text NOT NULL,
                role text NOT NULL CHECK (role IN ('Donor', 'Requester', 'Coordinator')),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS coordinator.audit_log (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                actor_id uuid NOT NULL, resource text NOT NULL, record_id text NOT NULL,
                action text NOT NULL, details jsonb NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS coordinator.geocode_cache (
                query text PRIMARY KEY, result jsonb NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS coordinator.geocode_rate (
                id integer PRIMARY KEY, called_at timestamptz NOT NULL
            );
            CREATE TABLE IF NOT EXISTS coordinator.login_attempts (
                email text NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS login_attempts_email_time ON coordinator.login_attempts(email, attempted_at);
        """)


def public_account(account):
    return {"id": str(account["id"]), "email": account["email"], "name": account["name"], "role": account["role"]}


def validate_email(value):
    if not isinstance(value, str):
        raise ApiError("Enter a valid email, for example name@example.com.")
    email = value.strip().casefold()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ApiError("Enter a valid email, for example name@example.com.")
    return email


def validate_password(value):
    if not isinstance(value, str) or not 10 <= len(value) <= 128:
        raise ApiError("Password must contain 10 to 128 characters.")
    return value


def credentials(data):
    return validate_email(data.get("email")), validate_password(data.get("password"))


def coordinator_option(ctx, parameter, value):
    try:
        if parameter.name == "email":
            return validate_email(value)
        if parameter.name == "password":
            return validate_password(value)
        return string({"name": value}, "name", limit=120)
    except ApiError as error:
        # Click handles this during the prompt, so interactive input is retried
        # and explicit invalid options fail with a readable field-specific error.
        raise click.BadParameter(error.message, ctx=ctx, param=parameter) from None


def session_response(account, status=200):
    now = datetime.now(timezone.utc)
    token = jwt.encode({"sub": str(account["id"]), "role": account["role"], "iat": now,
                        "exp": now + timedelta(hours=1), "iss": ISSUER, "aud": AUDIENCE},
                       key("JWT_PRIVATE_KEY_FILE"), algorithm="RS256")
    response = jsonify(user=public_account(account))
    response.set_cookie(COOKIE, token, max_age=3600, httponly=True,
                        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true", samesite="Lax", path="/")
    return response, status


def create_app():
    app = base_app("coordinator")
    initialize()

    @app.post("/api/auth/register")
    def register():
        data = json_body()
        email, password = credentials(data)
        name, role = string(data, "name", limit=120), data.get("role")
        if not isinstance(role, str) or role not in {"Donor", "Requester"}:
            raise ApiError("Only donor and requester accounts may register.", 403)
        try:
            with database() as connection:
                account = connection.execute("INSERT INTO coordinator.accounts (id, email, name, password_hash, role) VALUES (%s, %s, %s, %s, %s) RETURNING *",
                                             (uuid4(), email, name, generate_password_hash(password), role)).fetchone()
        except UniqueViolation:
            raise ApiError("An account already exists with that email.", 409)
        return session_response(account, 201)

    @app.post("/api/auth/login")
    def login():
        email, password = credentials(json_body())
        with database() as connection:
            # Persist failed attempts across service restarts.
            connection.execute("DELETE FROM coordinator.login_attempts WHERE attempted_at < now() - interval '15 minutes'")
            count = connection.execute("SELECT count(*) AS total FROM coordinator.login_attempts WHERE email = %s", (email,)).fetchone()["total"]
            if count >= 10:
                raise ApiError("Too many sign-in attempts. Try again in 15 minutes.", 429)
            account = connection.execute("SELECT * FROM coordinator.accounts WHERE email = %s", (email,)).fetchone()
            valid = account and check_password_hash(account["password_hash"], password)
            if valid:
                connection.execute("DELETE FROM coordinator.login_attempts WHERE email = %s", (email,))
            else:
                connection.execute("INSERT INTO coordinator.login_attempts (email) VALUES (%s)", (email,))
        if not valid:
            raise ApiError("Incorrect email or password.", 401)
        return session_response(account)

    @app.get("/api/auth/me")
    @require_roles("Donor", "Requester", "Coordinator")
    def me():
        with database() as connection:
            account = connection.execute("SELECT * FROM coordinator.accounts WHERE id = %s", (g.user["sub"],)).fetchone()
        if not account:
            raise ApiError("Account not found.", 401)
        return jsonify(user=public_account(account))

    @app.post("/api/auth/logout")
    def logout():
        response = jsonify(message="Signed out.")
        response.delete_cookie(COOKIE, path="/", samesite="Lax")
        return response

    @app.post("/api/location/preview")
    @require_roles("Donor", "Requester", "Coordinator")
    def preview():
        return jsonify(location_preview(json_body()))

    @app.get("/api/coordinator/warehouses")
    @require_roles("Coordinator")
    def warehouses():
        return jsonify(WAREHOUSES)

    @app.get("/api/coordinator/accounts")
    @require_roles("Coordinator")
    def accounts():
        role = request.args.get("role")
        if role not in {"Donor", "Requester"}:
            raise ApiError("Choose a Donor or Requester account list.")
        with database() as connection:
            rows = connection.execute("SELECT id, email, name, role FROM coordinator.accounts WHERE role = %s ORDER BY name, email", (role,)).fetchall()
        return jsonify([public_account(account) for account in rows])

    @app.get("/internal/accounts/<account_id>")
    @require_roles("Coordinator")
    def account_identity(account_id):
        try:
            identity = UUID(account_id)
        except ValueError:
            raise ApiError("Account not found.", 404)
        with database() as connection:
            account = connection.execute("SELECT id, email, name, role FROM coordinator.accounts WHERE id = %s", (identity,)).fetchone()
        if not account:
            raise ApiError("Account not found.", 404)
        return jsonify(public_account(account))

    @app.route("/api/coordinator/<resource>", methods=["GET"])
    @app.route("/api/coordinator/<resource>/<record_id>", methods=["PATCH", "DELETE"])
    @require_roles("Coordinator")
    def coordinate(resource, record_id=None):
        if resource not in {"donations", "requests"}:
            raise ApiError("Resource not found.", 404)
        base = os.getenv("DONOR_URL", "http://127.0.0.1:5001") if resource == "donations" else os.getenv("REQUESTER_URL", "http://127.0.0.1:5002")
        data = json_body() if request.method == "PATCH" else None
        path = f"/internal/{resource}" + (f"/{record_id}" if record_id else "")
        result = service_call(base, path, request.method, data)
        if request.method != "GET":
            with database() as connection:
                connection.execute("INSERT INTO coordinator.audit_log (actor_id, resource, record_id, action, details) VALUES (%s, %s, %s, %s, %s)",
                                   (g.user["sub"], resource, record_id, request.method, Jsonb(data or {})))
        return jsonify(result)

    @app.cli.command("create-coordinator")
    @click.option("--email", prompt="Email (e.g. name@example.com)", callback=coordinator_option)
    @click.option("--name", prompt="Name", callback=coordinator_option)
    @click.option("--password", prompt="Password (10 to 128 characters)", hide_input=True, confirmation_prompt=True, callback=coordinator_option)
    def create_coordinator(email, name, password):
        try:
            with database() as connection:
                connection.execute("INSERT INTO coordinator.accounts (id, email, name, password_hash, role) VALUES (%s, %s, %s, %s, 'Coordinator')", (uuid4(), email, name, generate_password_hash(password)))
        except UniqueViolation:
            raise click.ClickException("An account already exists with that email. Use its existing login or choose another email.") from None
        click.echo(f"Coordinator account created: {email}")

    return app

