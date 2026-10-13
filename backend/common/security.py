import os
from functools import wraps
from pathlib import Path

import jwt
from flask import Flask, g, jsonify, request
from werkzeug.exceptions import HTTPException

COOKIE = "humanlog_session"
ISSUER = "humanlog-coordinator"
AUDIENCE = "humanlog-services"
DEFAULT_FRONTEND_ORIGINS = ",".join(
    f"http://{host}:{port}"
    for port in (8080, 8443)
    for host in ("localhost", "127.0.0.1")
)


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def key(name):
    return Path(os.environ[name]).read_text(encoding="utf-8")


def base_app(name):
    app = Flask(name)
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

    @app.before_request
    def protect_cookie_mutations():
        if request.method in {"POST", "PATCH", "PUT", "DELETE"} and not request.headers.get("Authorization"):
            allowed = {origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", DEFAULT_FRONTEND_ORIGINS).split(",") if origin.strip()}
            if request.headers.get("Origin") not in allowed:
                raise ApiError("Untrusted request origin.", 403)

    @app.errorhandler(ApiError)
    def api_error(error):
        return jsonify(error=error.message), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        app.logger.exception("Request failed")
        return jsonify(error="Service unavailable. Please try again."), 503

    @app.get("/health")
    def health():
        from common.db import database
        with database() as connection:
            connection.execute("SELECT 1")
        return jsonify(service=name, status="ok")

    return app


def require_roles(*roles):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            authorization = request.headers.get("Authorization", "")
            token = authorization[7:] if authorization.startswith("Bearer ") else request.cookies.get(COOKIE)
            if not token:
                raise ApiError("Please sign in.", 401)
            try:
                claims = jwt.decode(token, key("JWT_PUBLIC_KEY_FILE"), algorithms=["RS256"],
                                    issuer=ISSUER, audience=AUDIENCE,
                                    options={"require": ["sub", "role", "exp", "iat", "iss", "aud"]})
                from uuid import UUID
                UUID(claims["sub"])
            except (jwt.PyJWTError, ValueError, TypeError):
                raise ApiError("Your session has expired. Please sign in again.", 401)
            if claims["role"] not in roles:
                raise ApiError("You do not have access to this resource.", 403)
            g.user, g.token = claims, token
            return function(*args, **kwargs)
        return wrapped
    return decorate


def json_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("A JSON object is required.")
    return data

