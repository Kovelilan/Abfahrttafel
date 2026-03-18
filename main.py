import time
import sys
import os

# Add src to python path so we can import modules
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from client import TransportClient
from display import ConsoleDisplay

def main():
    STATION_NAME = "Michaelshof"
    REFRESH_RATE = 30  # Seconds

    client = TransportClient(station=STATION_NAME)
    display = ConsoleDisplay()

    print(f"Starting Departure Board for {STATION_NAME}...")

    try:
        while True:
            data = client.fetch_departures()
            display.print_board(STATION_NAME, data)

            # Wenn ein Bus <= 1 Min entfernt ist, schnell refreshen für Blinkeffekt
            bus_imminent = any(d.get('minutes_left', 999) <= 1 for d in data)
            time.sleep(0.5 if bus_imminent else REFRESH_RATE)

    except KeyboardInterrupt:
        print("\nExiting...")
        sys.exit(0)

if __name__ == "__main__":
    main()
