#!/usr/bin/env python3
import json
import sys


def _error(message):
    print(json.dumps({"status": "error", "message": message}), file=sys.stderr)
    sys.exit(1)


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        _error(f"Invalid JSON input: {exc}")

    dob = payload.get("dob")
    time_str = payload.get("time")
    lat = payload.get("lat")
    lng = payload.get("lng")
    tz = payload.get("tz")
    language = payload.get("language", "en")

    if not dob or not time_str:
        _error("Missing required fields: dob and time are required")
    if lat is None or lng is None or tz is None:
        _error("Missing required fields: lat, lng, and tz are required")

    try:
        year, month, day = [int(part) for part in dob.split("-")]
    except ValueError:
        _error("dob must be in YYYY-MM-DD format")

    try:
        lat = float(lat)
        lng = float(lng)
        tz = float(tz)
    except ValueError:
        _error("lat, lng, and tz must be numeric")

    try:
        from jhora.horoscope.main import Horoscope
        from jhora.panchanga import drik
    except Exception as exc:
        _error(f"PyJHora import failed: {exc}")

    date_in = drik.Date(year, month, day)
    horoscope = Horoscope(
        latitude=lat,
        longitude=lng,
        timezone_offset=tz,
        date_in=date_in,
        birth_time=time_str,
        language=language,
    )

    horoscope_info = horoscope.get_horoscope_information()

    result = {
        "status": "success",
        "source": "PyJHora",
        "input": {
            "dob": dob,
            "time": time_str,
            "lat": lat,
            "lng": lng,
            "tz": tz,
            "language": language,
        },
        "horoscope": horoscope_info,
    }

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
