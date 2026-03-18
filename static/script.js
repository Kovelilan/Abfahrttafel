async function fetchDepartures() {
    const res = await fetch("/api/departures");
    return await res.json();
}

function renderBusIcon() {
    // 6×4 LED grid
    const pattern = [
        "111111",
        "110011",
        "111111",
        "101101"
    ];

    let html = '<div class="bus-icon">';
    for (const row of pattern) {
        for (const c of row) {
            html += `<span class="${c === '1' ? '' : 'off'}"></span>`;
        }
    }
    html += "</div>";
    return html;
}

function renderRows(data) {
    let html = "";

    data.slice(0, 4).forEach(dep => {
        html += `
            <div class="row">
                ${renderBusIcon()}
                <div class="line">${dep.line}</div>
                <div class="dest">${dep.destination}</div>
                <div class="time">${dep.time}</div>
                <div class="mins">${dep.minutes_left}</div>
            </div>
        `;
    });

    document.getElementById("departures").innerHTML = html;
}

async function refresh() {
    try {
        const data = await fetchDepartures();
        renderRows(data);
    } catch (e) {
        console.error(e);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    refresh();
    setInterval(refresh, 15000);
});
