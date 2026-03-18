from flask import Flask, render_template, jsonify
import sys
import os

# src import
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))
from client import TransportClient

app = Flask(__name__)
client = TransportClient(station="Michaelshof")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/departures")
def departures():
    data = client.fetch_departures()
    return jsonify(data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
