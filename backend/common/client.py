import requests
from flask import g

from common.security import ApiError


def service_call(base, path, method="GET", data=None):
    try:
        response = requests.request(method, base.rstrip("/") + path,
                                    headers={"Authorization": f"Bearer {g.token}"}, json=data, timeout=30)
        result = response.json()
    except (requests.RequestException, ValueError):
        raise ApiError("A required service is unavailable. Please try again.", 503)
    if response.status_code >= 400:
        raise ApiError(result.get("error", "Service request failed."), response.status_code)
    return result

