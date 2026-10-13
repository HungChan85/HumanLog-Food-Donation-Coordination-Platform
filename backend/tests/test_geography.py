import os
from unittest.mock import Mock, patch
from uuid import uuid4

import psycopg
import requests

from services.geography import geocode_address, get_directions


def test_explicit_address_lookup_cached_and_identified(system):
    address = "Public test place " + uuid4().hex
    response = Mock()
    response.json.return_value = [{"lat": "10.7707525", "lon": "106.6976235"}]
    settings = {**system["settings"], "DATABASE_URL": system["urls"]["coordinator"], "OSM_USER_AGENT": "HumanLog-IntegrationTests/1.0"}
    with patch.dict(os.environ, settings), patch("services.geography.requests.get", return_value=response) as upstream:
        first = geocode_address(address)
        second = geocode_address(address.upper())
        assert first == second == {"latitude": 10.7707525, "longitude": 106.6976235}
        assert upstream.call_count == 1
        assert upstream.call_args.kwargs["headers"]["User-Agent"] == "HumanLog-IntegrationTests/1.0"
        assert upstream.call_args.kwargs["timeout"] == 8
        assert upstream.call_args.kwargs["params"]["q"] == address
    with psycopg.connect(system["urls"]["coordinator"]) as connection:
        assert connection.execute("SELECT called_at FROM coordinator.geocode_rate WHERE id = 1").fetchone()


def test_osrm_unavailability_has_no_fabricated_route():
    with patch("services.geography.requests.get", side_effect=requests.Timeout):
        assert get_directions(10.77, 106.69, {"lat": 10.8, "lon": 106.71}) is None

