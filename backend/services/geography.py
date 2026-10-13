"""OSM geocoding and the original Haversine warehouse selection."""
import math
import os
import time

import requests
from psycopg.types.json import Jsonb

from common.db import database
from common.security import ApiError

# Original warehouse coordinates; never replace these with frontend demo hubs.
WAREHOUSES = [
    {"name": "Foodbank kho chính", "lat": 10.85609385, "lon": 106.76522639999999, "address": "Foodbank kho chính, Hồ Chí Minh City"},
    {"name": "Foodbank Quận 1", "lat": 10.7707525, "lon": 106.6976235, "address": "Foodbank Quận 1, Hồ Chí Minh City"},
    {"name": "Foodbank Quận Bình Thạnh", "lat": 10.80484845, "lon": 106.71676215550468, "address": "Foodbank Quận Bình Thạnh, Hồ Chí Minh City"},
]


def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def find_nearest_warehouse(lat, lon):
    ranked = sorted(({**w, "distanceKm": haversine(lat, lon, w["lat"], w["lon"])} for w in WAREHOUSES), key=lambda w: w["distanceKm"])
    return ranked[0], ranked


def geocode_address(address):
    normalized = address.strip().casefold()
    with database() as connection:
        # One database lock serializes ALL workers/replicas for the public API.
        connection.execute("SELECT pg_advisory_xact_lock(726104)")
        cached = connection.execute("SELECT result FROM coordinator.geocode_cache WHERE query = %s AND created_at > now() - interval '7 days'", (normalized,)).fetchone()
        if cached:
            return cached["result"]
        last = connection.execute("SELECT extract(epoch FROM called_at) AS epoch FROM coordinator.geocode_rate WHERE id = 1").fetchone()
        if last:
            time.sleep(max(0, 1.05 - (time.time() - float(last["epoch"]))))
        try:
            response = requests.get(os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search"),
                                    params={"q": address, "format": "jsonv2", "limit": 1},
                                    headers={"User-Agent": os.getenv("OSM_USER_AGENT", "HumanLog-FoodDonation/1.0")}, timeout=8)
            response.raise_for_status()
            results = response.json()
        except (requests.RequestException, ValueError):
            results = None
        # Commit timing even when the upstream request fails.
        connection.execute("INSERT INTO coordinator.geocode_rate (id, called_at) VALUES (1, clock_timestamp()) ON CONFLICT (id) DO UPDATE SET called_at = excluded.called_at")
        if results:
            result = {"latitude": float(results[0]["lat"]), "longitude": float(results[0]["lon"])}
            connection.execute("INSERT INTO coordinator.geocode_cache (query, result) VALUES (%s, %s) ON CONFLICT (query) DO UPDATE SET result = excluded.result, created_at = now()", (normalized, Jsonb(result)))
    if results is None:
        raise ApiError("Address lookup is unavailable. Select a map pin or try again.", 503)
    if not results:
        raise ApiError("Address not found. Please enter a more precise address or select a map pin.", 422)
    return result


def get_directions(lat, lon, warehouse):
    try:
        base = os.getenv("OSRM_URL", "https://router.project-osrm.org")
        response = requests.get(f"{base}/route/v1/driving/{lon},{lat};{warehouse['lon']},{warehouse['lat']}",
                                params={"overview": "full", "geometries": "geojson"}, timeout=8)
        response.raise_for_status()
        data = response.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        route = data["routes"][0]
        return {"distanceKm": round(route["distance"] / 1000, 2), "durationMinutes": round(route["duration"] / 60, 1),
                "points": [[lat, lon] for lon, lat in route["geometry"]["coordinates"]]}
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return None


def location_preview(data):
    if "latitude" in data or "longitude" in data:
        try:
            lat, lon = float(data["latitude"]), float(data["longitude"])
            if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise ApiError("Invalid coordinates.")
    else:
        address = data.get("address")
        if not isinstance(address, str) or not address.strip() or len(address) > 500:
            raise ApiError("Enter an address or select a map pin.")
        result = geocode_address(address)
        lat, lon = result["latitude"], result["longitude"]
    nearest, ranked = find_nearest_warehouse(lat, lon)
    return {"latitude": lat, "longitude": lon, "warehouse": nearest, "warehouses": ranked,
            "geographicDistanceKm": nearest["distanceKm"], "route": get_directions(lat, lon, nearest)}

