import os
from unittest.mock import patch

import pytest
from flask import jsonify

from common.security import base_app


def origin_client():
    app = base_app("origin-regression-test")

    @app.post("/write")
    def write():
        return jsonify(message="accepted")

    return app.test_client()


@pytest.mark.parametrize("origin", [
    "http://localhost:8080", "http://127.0.0.1:8080",
    "http://localhost:8443", "http://127.0.0.1:8443",
])
def test_default_local_frontend_origins_allowed(origin):
    with patch.dict(os.environ):
        os.environ.pop("FRONTEND_ORIGINS", None)
        response = origin_client().post("/write", headers={"Origin": origin})
    assert response.status_code == 200


@pytest.mark.parametrize("origin", [
    None, "null", "https://untrusted.test", "http://localhost:8081",
    "http://127.0.0.1:8080.evil.test", "http://localhost.evil.test:8080",
])
def test_missing_and_untrusted_origins_remain_blocked(origin):
    with patch.dict(os.environ):
        os.environ.pop("FRONTEND_ORIGINS", None)
        headers = {"Origin": origin} if origin is not None else {}
        response = origin_client().post("/write", headers=headers)
    assert response.status_code == 403
    assert response.json["error"] == "Untrusted request origin."


def test_configured_origins_trim_spaces_without_widening_allowlist():
    client = origin_client()
    with patch.dict(os.environ, {"FRONTEND_ORIGINS": " http://127.0.0.1:8080 , https://humanlog.example , "}):
        assert client.post("/write", headers={"Origin": "http://127.0.0.1:8080"}).status_code == 200
        assert client.post("/write", headers={"Origin": "https://humanlog.example"}).status_code == 200
        assert client.post("/write", headers={"Origin": "http://localhost:8080"}).status_code == 403


@pytest.mark.parametrize("role", ["Donor", "Requester"])
def test_register_login_logout_from_ipv4_frontend(system, role):
    from uuid import uuid4
    origin = "http://127.0.0.1:8080"
    payload = {"email": uuid4().hex + "@example.test", "name": "Origin test", "password": "Origin-test-password-123", "role": role}
    with patch.dict(system["settings"], {"FRONTEND_ORIGINS": "http://localhost:8080,http://127.0.0.1:8080"}):
        registered = system["call"]("coordinator", "/api/auth/register", "POST", data=payload, origin=origin)
        assert registered.status_code == 201
        assert system["call"]("coordinator", "/api/auth/logout", "POST", origin=origin).status_code == 200
        logged_in = system["call"]("coordinator", "/api/auth/login", "POST", data=payload, origin=origin)
        assert logged_in.status_code == 200
        assert logged_in.json["user"]["role"] == role
        assert system["call"]("coordinator", "/api/auth/logout", "POST", origin=origin).status_code == 200

