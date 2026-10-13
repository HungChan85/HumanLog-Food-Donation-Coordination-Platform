import os
from unittest.mock import patch
from uuid import uuid4

import psycopg
import pytest
from werkzeug.security import check_password_hash


def invoke(system, arguments, input=None):
    runner = system["clients"]["coordinator"].application.test_cli_runner()
    with patch.dict(os.environ, {**system["settings"], "DATABASE_URL": system["urls"]["coordinator"]}):
        return runner.invoke(args=["create-coordinator", *arguments], input=input)


@pytest.mark.parametrize("field,value,expected", [
    ("email", "admin", "valid email"),
    ("email", "admin@example", "valid email"),
    ("password", "123456789", "10 to 128 characters"),
    ("password", "a" * 129, "10 to 128 characters"),
    ("name", " ", "Invalid name"),
])
def test_invalid_cli_options_report_field_without_traceback_or_account(system, field, value, expected):
    email = uuid4().hex + "@example.test"
    values = {"email": email, "name": "CLI Coordinator", "password": "CLI-password-123"}
    values[field] = value
    arguments = [argument for key, item in values.items() for argument in ["--" + key, item]]
    result = invoke(system, arguments)
    assert result.exit_code == 2
    assert "Invalid value for '--" + field + "'" in result.output
    assert expected in result.output
    assert "Traceback" not in result.output
    assert values["password"] not in result.output
    with psycopg.connect(system["urls"]["coordinator"]) as connection:
        assert connection.execute("SELECT id FROM coordinator.accounts WHERE email = %s", (email,)).fetchone() is None


def test_interactive_invalid_email_and_password_are_reprompted_and_password_hidden(system):
    email = uuid4().hex + "@example.test"
    password = "Private-CLI-password-123"
    result = invoke(system, [], input=f"invalid-email\n{email}\nCLI Admin\nshort\nshort\n{password}\n{password}\n")
    assert result.exit_code == 0, result.output
    assert "valid email" in result.output
    assert "10 to 128 characters" in result.output
    assert "Coordinator account created: " + email in result.output
    assert password not in result.output
    assert "short" not in result.output
    with psycopg.connect(system["urls"]["coordinator"]) as connection:
        role, stored = connection.execute("SELECT role, password_hash FROM coordinator.accounts WHERE email = %s", (email,)).fetchone()
    assert role == "Coordinator"
    assert stored != password
    assert check_password_hash(stored, password)
    login = system["call"]("coordinator", "/api/auth/login", "POST", data={"email": email, "password": password})
    assert login.status_code == 200
    assert login.json["user"]["role"] == "Coordinator"


def test_duplicate_email_is_readable_error_and_preserves_existing_account(system):
    email = uuid4().hex + "@example.test"
    arguments = ["--email", email.upper(), "--name", "CLI Admin", "--password", "CLI-password-123"]
    assert invoke(system, arguments).exit_code == 0
    result = invoke(system, ["--email", email, "--name", "Changed Admin", "--password", "Replacement-password-123"])
    assert result.exit_code == 1
    assert "An account already exists with that email" in result.output
    assert "Traceback" not in result.output
    with psycopg.connect(system["urls"]["coordinator"]) as connection:
        name, password_hash = connection.execute("SELECT name, password_hash FROM coordinator.accounts WHERE email = %s", (email,)).fetchone()
    assert name == "CLI Admin"
    assert check_password_hash(password_hash, "CLI-password-123")

