const API_URL = "/api/departures";
const FONT_URL = "/static/fonts/dotmatrix.ttf";
const FONT_CHECK = '24px "DotMatrix"';
const MAX_ROWS = 4;
const REFRESH_INTERVAL_MS = 15000;
const REQUEST_TIMEOUT_MS = 8000;
const BUS_PATTERN = Object.freeze([
    "01111110",
    "11111111",
    "10100101",
    "01000010"
]);

const MOCK_DEPARTURES = Object.freeze([
    { line: "2", destination: "Luzern Bhf", time: "12:03", minutes_left: 3, delay: 5 },
    { line: "12", destination: "Littau Bhf", time: "12:05", minutes_left: 2, delay: 0 },
    { line: "22", destination: "Emmenbruecke Sprengi", time: "12:09", minutes_left: 1, delay: 0 },
    { line: "30", destination: "Ebikon Bhf", time: "12:14", minutes_left: 11, delay: null }
]);

let departuresNode = null;
let mockModeLogged = false;
let fontFallbackApplied = false;
let refreshInFlight = false;
let lastRenderSignature = "";

function setBusyState(isBusy) {
    if (departuresNode) {
        departuresNode.setAttribute("aria-busy", String(isBusy));
    }
}

function applyFontFallback(reason) {
    if (!fontFallbackApplied) {
        console.warn(`[matrix] Font fallback active: ${reason}`);
        fontFallbackApplied = true;
    }

    document.body.classList.add("matrix-fallback");
}

async function verifyFontAsset() {
    try {
        const response = await fetch(FONT_URL, { cache: "no-store" });
        if (!response.ok) {
            console.warn(`[matrix] Font asset missing (${response.status}) at ${FONT_URL}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error("[matrix] Font request failed:", error);
        return false;
    }
}

async function ensureMatrixFont() {
    if (!document.fonts || !document.fonts.check || !document.fonts.load) {
        console.warn("[matrix] document.fonts API unavailable");
        applyFontFallback("fonts-api-unavailable");
        return false;
    }

    const assetExists = await verifyFontAsset();
    if (!assetExists) {
        applyFontFallback("font-asset-unreachable");
        return false;
    }

    try {
        await document.fonts.load(FONT_CHECK);
        const loaded = document.fonts.check(FONT_CHECK);
        console.info(`[matrix] Font status: ${loaded ? "loaded" : "fallback"} (${FONT_URL})`);

        if (!loaded) {
            applyFontFallback("font-check-failed");
        }

        return loaded;
    } catch (error) {
        console.error("[matrix] Font load error:", error);
        applyFontFallback("font-load-error");
        return false;
    }
}

function isMockMode() {
    return new URLSearchParams(window.location.search).get("mock") === "1";
}

function sanitizeText(value, fallback = "--") {
    if (value === null || value === undefined) {
        return fallback;
    }

    const text = String(value).trim();
    return text || fallback;
}

function parseInteger(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function normalizeTime(entry) {
    const directValue = sanitizeText(entry?.time, "");
    if (/^\d{2}:\d{2}$/.test(directValue)) {
        return directValue;
    }

    const rawValue = entry?.raw_dt || entry?.departure || entry?.datetime;
    if (typeof rawValue === "string") {
        const parsed = new Date(rawValue);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleTimeString("de-CH", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            });
        }
    }

    return "--:--";
}

function formatDelay(delayValue) {
    if (delayValue === null || delayValue === 0) {
        return "";
    }

    return delayValue > 0 ? `+${delayValue}` : `${delayValue}`;
}

function normalizeDeparture(entry, index) {
    if (!entry || typeof entry !== "object") {
        console.warn(`[matrix] Invalid departure entry at index ${index}`, entry);
        return {
            line: "--",
            destination: "Keine Daten",
            time: "--:--",
            minutesDisplay: "--'",
            delayDisplay: "",
            imminent: false
        };
    }

    const rawMinutes = parseInteger(entry.minutes_left ?? entry.minutes);
    const rawDelay = parseInteger(entry.delay);
    const safeMinutes = rawMinutes === null ? null : Math.max(0, rawMinutes);
    const safeDelay = rawDelay === null ? null : rawDelay;
    // Backend-Minuten koennen die Verspaetung bereits enthalten; fuer die Anzeige ziehen wir sie wieder ab.
    const displayMinutes = safeMinutes === null
        ? null
        : safeDelay !== null && safeDelay > 0 && safeMinutes >= safeDelay
            ? safeMinutes - safeDelay
            : safeMinutes;

    return {
        line: sanitizeText(entry.line ?? entry.number),
        destination: sanitizeText(entry.destination ?? entry.to, "Keine Daten"),
        time: normalizeTime(entry),
        minutesValue: safeMinutes,
        minutesDisplay: displayMinutes === null ? "--'" : `${displayMinutes}'`,
        delayDisplay: formatDelay(safeDelay),
        imminent: safeMinutes !== null && safeMinutes <= 1
    };
}

function buildPlaceholderRows(message) {
    const rows = [{
        line: "--",
        destination: message,
        time: "--:--",
        minutesValue: null,
        minutesDisplay: "--'",
        delayDisplay: "",
        imminent: false,
        placeholder: true
    }];

    while (rows.length < MAX_ROWS) {
        rows.push({
            line: "",
            destination: "",
            time: "",
            minutesValue: null,
            minutesDisplay: "",
            delayDisplay: "",
            imminent: false,
            placeholder: true,
            empty: true
        });
    }

    return rows;
}

function normalizePayload(payload) {
    let items = [];

    if (Array.isArray(payload)) {
        items = payload;
    } else if (payload && Array.isArray(payload.departures)) {
        items = payload.departures;
    } else if (payload !== null && payload !== undefined) {
        console.warn("[matrix] Unexpected payload shape", payload);
    }

    const normalized = items.slice(0, MAX_ROWS).map(normalizeDeparture);
    if (normalized.length === 0) {
        return buildPlaceholderRows("Keine Daten");
    }

    while (normalized.length < MAX_ROWS) {
        normalized.push({
            line: "",
            destination: "",
            time: "",
            minutesValue: null,
            minutesDisplay: "",
            delayDisplay: "",
            imminent: false,
            placeholder: true,
            empty: true
        });
    }

    return normalized;
}

function createCell(className, value) {
    const node = document.createElement("div");
    node.className = `cell ${className}`;
    node.textContent = value || "\u00A0";
    return node;
}

function createBusIcon() {
    const node = document.createElement("div");
    node.className = "bus-icon";
    node.setAttribute("aria-hidden", "true");

    for (const row of BUS_PATTERN) {
        for (const dot of row) {
            const pixel = document.createElement("span");
            if (dot !== "1") {
                pixel.classList.add("off");
            }
            node.appendChild(pixel);
        }
    }

    return node;
}

function createMinutesCell(departure) {
    const node = document.createElement("div");
    node.className = "cell minutes";

    const mainNode = document.createElement("span");
    mainNode.className = "minutes-main";
    mainNode.textContent = departure.minutesDisplay || "\u00A0";
    node.appendChild(mainNode);

    const delayNode = document.createElement("span");
    delayNode.className = "minutes-delay";
    delayNode.textContent = departure.delayDisplay || "\u00A0";
    node.appendChild(delayNode);

    return node;
}

function createRow(departure) {
    const row = document.createElement("div");
    row.className = "departure-row";
    row.setAttribute("role", "listitem");

    if (departure.placeholder) {
        row.classList.add("is-placeholder");
    }

    if (departure.empty) {
        row.classList.add("is-empty");
    }

    if (departure.imminent) {
        row.classList.add("imminent");
    }

    const iconCell = document.createElement("div");
    iconCell.className = "cell icon-cell";
    iconCell.appendChild(createBusIcon());
    row.appendChild(iconCell);

    row.appendChild(createCell("line", departure.line));
    row.appendChild(createCell("destination", departure.destination));
    row.appendChild(createCell("time", departure.time));
    row.appendChild(createMinutesCell(departure));

    const delayLabel = departure.delayDisplay ? `, Verspaetung ${departure.delayDisplay} Minuten` : "";
    const minutesLabel = departure.minutesValue === null ? "unbekannte Minuten" : `${departure.minutesValue} Minuten`;
    row.setAttribute(
        "aria-label",
        `${departure.line || "Linie unbekannt"} nach ${departure.destination || "unbekannt"}, ${departure.time || "keine Zeit"}, ${minutesLabel}${delayLabel}`
    );

    return row;
}

function buildRenderSignature(rows) {
    // Unveraenderte Daten fuehren nicht erneut zu einem DOM-Austausch.
    return JSON.stringify(rows.map((row) => ({
        line: row.line,
        destination: row.destination,
        time: row.time,
        minutesDisplay: row.minutesDisplay,
        delayDisplay: row.delayDisplay,
        imminent: row.imminent,
        placeholder: Boolean(row.placeholder),
        empty: Boolean(row.empty)
    })));
}

function renderRows(rows) {
    if (!departuresNode) {
        return;
    }

    const signature = buildRenderSignature(rows);
    if (signature === lastRenderSignature) {
        setBusyState(false);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
        fragment.appendChild(createRow(row));
    }

    departuresNode.replaceChildren(fragment);
    lastRenderSignature = signature;
    setBusyState(false);
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal
        });
    } catch (error) {
        if (error.name === "AbortError") {
            console.error(`[matrix] API request timed out after ${REQUEST_TIMEOUT_MS}ms`);
        } else {
            console.error("[matrix] API request failed:", error);
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }

    if (!response.ok) {
        console.error(`[matrix] API error: ${response.status} ${response.statusText}`);
        throw new Error(`API error ${response.status}`);
    }

    const rawText = await response.text();
    if (!rawText.trim()) {
        console.warn("[matrix] API returned an empty response body");
        return [];
    }

    try {
        return JSON.parse(rawText);
    } catch (error) {
        console.error("[matrix] JSON parse error:", error);
        console.debug("[matrix] Invalid JSON payload:", rawText);
        throw error;
    }
}

async function getDepartures() {
    if (isMockMode()) {
        if (!mockModeLogged) {
            console.info("[matrix] Mock mode enabled via ?mock=1");
            mockModeLogged = true;
        }

        return MOCK_DEPARTURES;
    }

    return fetchJson(API_URL);
}

async function refreshDepartures() {
    if (refreshInFlight) {
        console.debug("[matrix] Skipping refresh because the previous request is still running");
        return;
    }

    refreshInFlight = true;
    setBusyState(true);

    try {
        const payload = await getDepartures();
        renderRows(normalizePayload(payload));
    } catch (error) {
        console.error("[matrix] Departure refresh failed:", error);
        renderRows(buildPlaceholderRows("Keine Daten"));
    } finally {
        refreshInFlight = false;
    }
}

function bootstrap() {
    departuresNode = document.getElementById("departures");
    if (!departuresNode) {
        console.error("[matrix] #departures container not found");
        return;
    }

    renderRows(buildPlaceholderRows("Lade Daten"));

    void ensureMatrixFont();
    void refreshDepartures();
    window.setInterval(() => {
        void refreshDepartures();
    }, REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", bootstrap);
