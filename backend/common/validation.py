import math
from datetime import date

from common.security import ApiError

CATEGORIES = ["Dry Food", "Fresh Food", "Canned Food", "Dairy & Chilled Food", "Condiments"]
STORAGE = ["Ambient", "Chilled", "Frozen"]
SHELF = ["Within a Day", "Within a Week", "Within a Month", "Over Six Months"]
QUANTITIES = {"dry": ("Dry Food", "kg"), "fresh": ("Fresh Food", "kg"),
              "canned": ("Canned Food", "units"), "dairy": ("Dairy & Chilled Food", "units"),
              "condiments": ("Condiments", "units")}


def string(data, field, required=True, limit=500):
    value = data.get(field, "")
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ApiError(f"Invalid {field}.")
    return value.strip()


def number(value, field, positive=False):
    try:
        if isinstance(value, bool):
            raise ValueError()
        value = float(value)
        if not math.isfinite(value) or value < 0 or (positive and value <= 0) or value > 1_000_000:
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise ApiError(f"{field} must be a finite {'positive' if positive else 'non-negative'} number.")


def validate_record(kind, data):
    clean = {"address": string(data, "address", required=False)}
    if "latitude" in data or "longitude" in data:
        try:
            lat, lon = float(data["latitude"]), float(data["longitude"])
            if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise ApiError("Invalid latitude/longitude.")
        clean.update(latitude=lat, longitude=lon)
    elif not clean["address"]:
        raise ApiError("Provide an address or latitude/longitude.")
    if kind == "donation":
        clean.update(donor=string(data, "donor"), category=string(data, "category"),
                     storage=string(data, "storage"), shelf=string(data, "shelf"),
                     unit=string(data, "unit"), expiry=string(data, "expiry", required=False),
                     quantityValue=number(data.get("quantityValue"), "Quantity", True),
                     weightValue=number(data.get("weightValue"), "Weight", True))
        if clean["category"] not in CATEGORIES or clean["storage"] not in STORAGE or clean["shelf"] not in SHELF or clean["unit"] not in ["units", "bags", "boxes"]:
            raise ApiError("Invalid category, storage, shelf life, or unit.")
        if clean["expiry"]:
            try:
                date.fromisoformat(clean["expiry"])
            except ValueError:
                raise ApiError("Expiry must be an ISO date.")
        clean.update(quantity=f"{clean['quantityValue']:g} {clean['unit']}", weight=f"{clean['weightValue']:g} kg")
    else:
        clean["requester"] = string(data, "requester")
        quantities = data.get("foodQuantities")
        if not isinstance(quantities, dict) or set(quantities) - set(QUANTITIES):
            raise ApiError("Invalid food quantities.")
        clean["foodQuantities"] = {field: number(quantities.get(field, 0), label) for field, (label, _) in QUANTITIES.items()}
        if not any(clean["foodQuantities"].values()):
            raise ApiError("At least one food quantity must be greater than zero.")
        clean["categories"] = ", ".join(label for field, (label, _) in QUANTITIES.items() if clean["foodQuantities"][field])
        clean["quantities"] = " · ".join(f"{label} {clean['foodQuantities'][field]:g} {unit}" for field, (label, unit) in QUANTITIES.items() if clean["foodQuantities"][field])
    return clean

