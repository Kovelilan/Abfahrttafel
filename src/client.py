import requests
import re
from datetime import datetime, timezone
import math
from typing import List, Dict

class TransportClient:
    """Handles interactions with the transport.opendata.ch API."""

    BASE_URL = "https://transport.opendata.ch/v1/stationboard"

    def __init__(self, station: str = "Michaelshof"):
        self.station = station

    def _normalize_destination(self, destination: str) -> str:
        """Normalize destination string for consistent formatting."""
        # Strip leading/trailing whitespace
        destination = destination.strip()
        # Collapse multiple spaces into one
        destination = re.sub(r'\s+', ' ', destination)
        # Fix spacing around commas: "Luzern , Bhf" -> "Luzern, Bhf"
        destination = re.sub(r'\s*,\s*', ', ', destination)
        return destination

    def _get_fallback_line(self, destination: str) -> str:
        """Determine fallback bus line number based on destination (case-insensitive)."""
        dest_lower = destination.lower()
        # Line 12: destinations containing "luzern, bhf" or "luzern, gasshof"
        if "luzern, bhf" in dest_lower or "luzern, gasshof" in dest_lower:
            return "12"
        # Line 30: destinations containing "ebikon, bhf" or "littau, bhf"
        if "ebikon, bhf" in dest_lower or "littau, bhf" in dest_lower:
            return "30"
        return "?"

    def fetch_departures(self, limit: int = 20, next_n: int = 4) -> List[Dict]:
        params = {
            'station': self.station,
            'limit': limit
        }

        try:
            response = requests.get(self.BASE_URL, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as e:
            print(f"Error fetching data: {e}")
            return []

        if 'stationboard' not in data:
            return []

        stationboard = data['stationboard']
        formatted_departures = []
        now = datetime.now(tz=timezone.utc)

        for entry in stationboard:
            raw_dep = entry['stop']['departure']
            if not raw_dep:
                continue

            dep_dt = datetime.fromisoformat(raw_dep.replace("Z", "+00:00"))

            if dep_dt > now:
                diff_seconds = (dep_dt - now).total_seconds()
                minutes_left = math.ceil(diff_seconds / 60)

                destination = entry.get('to', "?")
                destination = self._normalize_destination(destination)
                destination = destination.replace("Bahnhof", "Bhf")

                # Get line number, using fallback logic if not provided
                line = entry.get('number')
                if not line:
                    line = self._get_fallback_line(destination)

                # Only remove "Luzern" when it's "Luzern Littau"
                if destination.startswith("Luzern Littau"):
                    destination = destination.replace("Luzern ", "", 1)

                delay = entry['stop'].get('delay')

                # Add delay to countdown
                if delay:
                    minutes_left += delay

                formatted_departures.append({
                    'line': line,
                    'destination': destination,
                    'time': dep_dt.strftime("%H:%M"),
                    'minutes_left': minutes_left,
                    'delay': delay,
                    'raw_dt': dep_dt
                })

            if len(formatted_departures) >= next_n:
                break

        return formatted_departures