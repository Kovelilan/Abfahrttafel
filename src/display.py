class ConsoleDisplay:
    """Handles printing the departure board to the console."""

    def __init__(self):
        self.blink_on = True  # Toggle-Zustand

    def clear(self):
        # ANSI-Codes statt os.system – schneller, kein Flackern
        print("\033[2J\033[H", end="")

    def print_board(self, station_name: str, departures: list):
        self.clear()
        self.blink_on = not self.blink_on  # Bei jedem Aufruf umschalten

        if not departures:
            print("Keine Daten verfügbar.")
            return

        # Sort by minutes_left so the soonest bus is always first
        departures = sorted(departures, key=lambda d: d.get("minutes_left", 999))

        for dep in departures:
            destination = dep.get('destination') or "?"
            line = dep.get('line') or "?"
            time_str = dep.get('time') or "?"
            minutes_left = dep.get('minutes_left') or 0
            delay = dep.get('delay')

            # Delay anzeigen
            if delay:
                time_str = f"{time_str} +{delay}"

            if minutes_left <= 1:
                # Blinkend: Symbol an/aus im Wechsel
                min_display = " 🚌 " if self.blink_on else "    "
                print(f"{line:<3} {destination:<22} {time_str:<8} {min_display}")
            else:
                min_display = f"{minutes_left} Min"
                print(f"{line:<3} {destination:<22} {time_str:<8} ({min_display})")