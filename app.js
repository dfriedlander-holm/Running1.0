const state = { runs: [] };
let rollingChart;
let histogramChart;

const fmtMiles = (v) => `${v.toFixed(1)} mi`;
const fmtPace = (minPerMi) => {
  if (!Number.isFinite(minPerMi) || minPerMi <= 0) return "--";
  const mins = Math.floor(minPerMi);
  const secs = Math.round((minPerMi - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/mi`;
};


function setStravaStatus(message, kind = "") {
  const el = document.getElementById("stravaStatus");
  el.className = `hint ${kind}`.trim();
  el.textContent = message;
}

function setSheetStatus(message, kind = "") {
  const el = document.getElementById("sheetStatus");
  el.className = `hint ${kind}`.trim();
  el.textContent = message;
}

function parseStravaCredentialInput(rawToken) {
  const cleaned = (rawToken || "").trim();
  if (!cleaned) return { token: "" };

  const unprefixed = cleaned.replace(/^bearer\s+/i, "").trim();

  if (unprefixed.startsWith("{")) {
    try {
      const parsed = JSON.parse(unprefixed);
      if (parsed?.access_token) {
        return { token: String(parsed.access_token).trim(), warning: "Extracted access_token from pasted JSON." };
      }
    } catch (_err) {}
  }

  try {
    const maybeUrl = new URL(unprefixed);
    const tokenFromUrl = maybeUrl.searchParams.get("access_token") || maybeUrl.hash.match(/access_token=([^&]+)/)?.[1];
    if (tokenFromUrl) {
      return { token: decodeURIComponent(tokenFromUrl).trim(), warning: "Extracted access_token from pasted URL." };
    }

    if (maybeUrl.searchParams.get("code")) {
      return {
        token: "",
        error:
          "That value is a Strava authorization code, not an access token. Exchange the code for an access token first, then paste the access token here.",
      };
    }
  } catch (_err) {}

  if (/(\?|&)code=/.test(unprefixed) || /^code=/.test(unprefixed)) {
    return {
      token: "",
      error:
        "That value is a Strava authorization code, not an access token. Exchange the code for an access token first, then paste the access token here.",
    };
  }

  return { token: unprefixed };
}

function createStrava401Help(debugText = "") {
  return [
    "Strava returned 401 (Unauthorized).",
    "Check that you pasted an access token (not an authorization code).",
    "Your token may be expired; Strava access tokens are short-lived.",
    "Your app must request activity scopes (e.g. activity:read_all).",
    debugText ? `API details: ${debugText}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function parseDate(d) {
  return new Date(`${d}T00:00:00`);
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / 86400000);
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function googleSheetUrlToCsvUrl(rawUrl) {
  const url = new URL((rawUrl || "").trim());
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "docs.google.com") {
    throw new Error("Use a docs.google.com Google Sheet URL.");
  }

  const path = url.pathname;
  const match = path.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error("Could not find the Google Sheet ID in the URL.");
  }

  const sheetId = match[1];
  const fromQuery = url.searchParams.get("gid");
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("gid");
  const gid = fromQuery || fromHash || "0";
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

async function fetchStravaRuns(token) {
  const runs = [];
  const headers = { Authorization: `Bearer ${token}` };

  let athleteRes;
  try {
    athleteRes = await fetch("https://www.strava.com/api/v3/athlete", { headers });
  } catch (_err) {
    throw new Error(
      "Unable to reach Strava API from this browser (network/CORS). If this is GitHub Pages, verify browser console for CORS blocks and that your token is current."
    );
  }

  if (!athleteRes.ok) {
    let debugText = "";
    try {
      const errJson = await athleteRes.json();
      debugText = errJson?.message || JSON.stringify(errJson);
    } catch (_err) {
      debugText = `status=${athleteRes.status}`;
    }

    if (athleteRes.status === 401) {
      throw new Error(createStrava401Help(debugText));
    }
    throw new Error(`Strava athlete check failed (${athleteRes.status}): ${debugText}`);
  }

  for (let page = 1; page <= 8; page += 1) {
    let res;
    try {
      res = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`, { headers });
    } catch (_err) {
      throw new Error(
        "Strava activities request failed before response (network/CORS). Confirm internet access and check browser console for blocked requests."
      );
    }
    if (!res.ok) {
      let debugText = "";
      try {
        const errJson = await res.json();
        debugText = errJson?.message || JSON.stringify(errJson);
      } catch (_err) {
        debugText = `status=${res.status}`;
      }

      if (res.status === 401) {
        throw new Error(createStrava401Help(debugText));
      }
      throw new Error(`Strava request failed (${res.status}): ${debugText}`);
    }

    const data = await res.json();
    if (!data.length) break;
    data
      .filter((a) => a.sport_type === "Run" || a.type === "Run" || a.type === "VirtualRun")
      .forEach((a) => {
        runs.push({
          date: (a.start_date_local || a.start_date).slice(0, 10),
          distanceMi: a.distance / 1609.344,
          movingSec: a.moving_time ?? 0,
          name: a.name ?? "Run",
        });
      });
  }
  return runs;
}

function parseCsvRuns(text) {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());
  const idx = (k) => headers.indexOf(k);
  const dateIdx = idx("date");
  const miIdx = idx("distance_mi");
  const kmIdx = idx("distance_km");
  const mIdx = idx("distance_m");
  const secIdx = idx("moving_time_sec");
  if (dateIdx === -1 || (miIdx === -1 && kmIdx === -1 && mIdx === -1)) {
    throw new Error("CSV needs date and distance_mi (or distance_km/distance_m)");
  }

  return rows
    .map((r) => r.split(","))
    .map((c) => {
      const rawMi = miIdx !== -1 ? parseFloat(c[miIdx]) : NaN;
      const rawKm = kmIdx !== -1 ? parseFloat(c[kmIdx]) : NaN;
      const rawM = mIdx !== -1 ? parseFloat(c[mIdx]) : NaN;
      const distanceMi = Number.isFinite(rawMi) ? rawMi : Number.isFinite(rawKm) ? rawKm * 0.621371 : rawM / 1609.344;
      return {
        date: c[dateIdx],
        distanceMi,
        movingSec: secIdx !== -1 ? parseFloat(c[secIdx]) : 0,
        name: "Imported",
      };
    })
    .filter((r) => r.date && Number.isFinite(r.distanceMi) && r.distanceMi > 0)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function buildAnalytics(runs, paceA, paceB, predictorDistance) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const doy = dayOfYear(now);
  const isLeapYear = new Date(year, 1, 29).getMonth() === 1;
  const daysYear = isLeapYear ? 366 : 365;
  const yearRuns = runs.filter((r) => parseDate(r.date).getFullYear() === year);
  const monthRuns = yearRuns.filter((r) => parseDate(r.date).getMonth() === month);

  const annualMileage = sum(yearRuns.map((r) => r.distanceMi));
  const monthlyMileage = sum(monthRuns.map((r) => r.distanceMi));

  const monthlyTargetA = paceA * daysInMonth(year, month);
  const monthlyTargetB = paceB * daysInMonth(year, month);
  const annualTargetA = paceA * daysYear;
  const annualTargetB = paceB * daysYear;

  const recent = [...yearRuns].sort((a, b) => parseDate(b.date) - parseDate(a.date)).slice(0, 10);
  const recentMiles = sum(recent.map((r) => r.distanceMi));
  const recentSecs = sum(recent.map((r) => r.movingSec));
  const recentPace = recentMiles > 0 ? recentSecs / 60 / recentMiles : NaN;

  const predictedMinutes = recentPace * predictorDistance;

  const last7Start = new Date(now);
  last7Start.setDate(last7Start.getDate() - 6);
  const miles7d = sum(
    yearRuns
      .filter((r) => {
        const d = parseDate(r.date);
        return d >= last7Start && d <= now;
      })
      .map((r) => r.distanceMi)
  );

  const monthlyBuckets = Array.from({ length: 12 }, (_, m) => {
    const bucket = yearRuns.filter((r) => parseDate(r.date).getMonth() === m);
    const miles = sum(bucket.map((r) => r.distanceMi));
    const pace = sum(bucket.map((r) => r.movingSec)) / 60 / (miles || NaN);
    return { month: m, miles, pace };
  });

  const rollingSeries = [];
  const start = new Date(year, 0, 1);
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const end = new Date(d);
    const begin = new Date(d);
    begin.setDate(begin.getDate() - 6);
    const miles = sum(
      yearRuns
        .filter((r) => {
          const rd = parseDate(r.date);
          return rd >= begin && rd <= end;
        })
        .map((r) => r.distanceMi)
    );
    rollingSeries.push({ date: new Date(d), miles });
  }

  const bins = [0, 2, 4, 6, 8, 10, 13, 16, 20, 30];
  const histogram = bins.slice(0, -1).map((min, i) => ({
    label: `${min}-${bins[i + 1]} mi`,
    count: yearRuns.filter((r) => r.distanceMi >= min && r.distanceMi < bins[i + 1]).length,
  }));

  const cumulativeMiles = sum(
    yearRuns.filter((r) => dayOfYear(parseDate(r.date)) <= doy).map((r) => r.distanceMi)
  );

  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - now.getDay());
  const thisWeekMiles = sum(
    yearRuns
      .filter((r) => {
        const d = parseDate(r.date);
        return d >= thisWeekStart && d <= now;
      })
      .map((r) => r.distanceMi)
  );

  const weeksLeft = Math.max(1, Math.ceil((new Date(year, 11, 31) - now) / 604800000));

  return {
    year,
    month,
    monthlyMileage,
    annualMileage,
    monthlyTargetA,
    monthlyTargetB,
    annualTargetA,
    annualTargetB,
    miles7d,
    recentPace,
    predictedMinutes,
    monthlyBuckets,
    rollingSeries,
    histogram,
    cumulativeMiles,
    thisWeekMiles,
    weeksLeft,
    overUnderA: cumulativeMiles - paceA * doy,
    overUnderB: cumulativeMiles - paceB * doy,
  };
}

function renderMetrics(a) {
  const cards = [
    ["Monthly mileage", fmtMiles(a.monthlyMileage)],
    ["Month remaining (A)", fmtMiles(Math.max(0, a.monthlyTargetA - a.monthlyMileage))],
    ["Month remaining (B)", fmtMiles(Math.max(0, a.monthlyTargetB - a.monthlyMileage))],
    ["Annual mileage", fmtMiles(a.annualMileage)],
    ["Annual remaining (A)", fmtMiles(Math.max(0, a.annualTargetA - a.annualMileage))],
    ["Annual remaining (B)", fmtMiles(Math.max(0, a.annualTargetB - a.annualMileage))],
    ["7-day rolling total", fmtMiles(a.miles7d)],
    ["Over/Under pace A", fmtMiles(a.overUnderA)],
    ["Over/Under pace B", fmtMiles(a.overUnderB)],
    ["Year complete (A)", `${((a.annualMileage / a.annualTargetA) * 100 || 0).toFixed(1)}%`],
    ["Year complete (B)", `${((a.annualMileage / a.annualTargetB) * 100 || 0).toFixed(1)}%`],
    ["Predicted time", `${Math.floor(a.predictedMinutes)}m ${Math.round((a.predictedMinutes % 1) * 60)}s`],
  ];
  document.getElementById("metrics").innerHTML = cards
    .map(
      ([label, value]) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");
}

function renderWeeklyBreakdown(a) {
  const row = (name, pace, annualTarget) => {
    const remainingYear = Math.max(0, annualTarget - a.annualMileage);
    const requiredWeekly = remainingYear / a.weeksLeft;
    const thisWeekTarget = pace * 7;
    const thisWeekRemaining = Math.max(0, thisWeekTarget - a.thisWeekMiles);
    return `<tr><td>${name}</td><td>${fmtMiles(thisWeekRemaining)}</td><td>${fmtMiles(requiredWeekly)}</td><td>${a.weeksLeft}</td></tr>`;
  };
  document.getElementById("weeklyBreakdown").innerHTML = `
    <table>
      <thead><tr><th>Target</th><th>This week remaining</th><th>Avg weekly needed rest of year</th><th>Weeks left</th></tr></thead>
      <tbody>
        ${row("Pace A", parseFloat(document.getElementById("paceA").value), a.annualTargetA)}
        ${row("Pace B", parseFloat(document.getElementById("paceB").value), a.annualTargetB)}
      </tbody>
    </table>`;
}

function renderMonthlyComparison(a) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rows = a.monthlyBuckets
    .map((b, i, arr) => {
      const prev = i > 0 ? arr[i - 1].miles : 0;
      const delta = b.miles - prev;
      return `<tr><td>${monthNames[b.month]}</td><td>${fmtMiles(b.miles)}</td><td>${delta >= 0 ? "+" : ""}${delta.toFixed(
        1
      )}</td></tr>`;
    })
    .join("");
  document.getElementById("monthlyComparison").innerHTML = `
    <table><thead><tr><th>Month</th><th>Mileage</th><th>Vs prior month</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPaceAnalysis(a) {
  const yearAvgPace = sum(state.runs.map((r) => r.movingSec)) / 60 / (sum(state.runs.map((r) => r.distanceMi)) || NaN);
  const monthly = a.monthlyBuckets
    .map((m) => `<tr><td>${m.month + 1}</td><td>${fmtPace(m.pace)}</td></tr>`)
    .join("");
  const recentRuns = [...state.runs]
    .sort((x, y) => parseDate(y.date) - parseDate(x.date))
    .slice(0, 8)
    .map(
      (r) => `<tr><td>${r.date}</td><td>${fmtMiles(r.distanceMi)}</td><td>${fmtPace(r.movingSec / 60 / r.distanceMi)}</td></tr>`
    )
    .join("");

  document.getElementById("paceAnalysis").innerHTML = `
    <p><strong>Year pace:</strong> ${fmtPace(yearAvgPace)}</p>
    <h4>Monthly pace</h4>
    <table><thead><tr><th>Month</th><th>Avg pace</th></tr></thead><tbody>${monthly}</tbody></table>
    <h4>Recent runs</h4>
    <table><thead><tr><th>Date</th><th>Distance</th><th>Pace</th></tr></thead><tbody>${recentRuns}</tbody></table>`;
}

function renderCharts(a) {
  if (rollingChart) rollingChart.destroy();
  if (histogramChart) histogramChart.destroy();

  rollingChart = new Chart(document.getElementById("rollingChart"), {
    type: "line",
    data: {
      labels: a.rollingSeries.map((x) => x.date.toISOString().slice(5, 10)),
      datasets: [{ label: "7-day miles", data: a.rollingSeries.map((x) => x.miles), borderColor: "#60a5fa" }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  histogramChart = new Chart(document.getElementById("histogramChart"), {
    type: "bar",
    data: {
      labels: a.histogram.map((h) => h.label),
      datasets: [{ label: "Run count", data: a.histogram.map((h) => h.count), backgroundColor: "#34d399" }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function refresh() {
  const paceA = parseFloat(document.getElementById("paceA").value || "0");
  const paceB = parseFloat(document.getElementById("paceB").value || "0");
  const predictDistance = parseFloat(document.getElementById("predictDistance").value || "0");
  const analytics = buildAnalytics(state.runs, paceA, paceB, predictDistance);
  renderMetrics(analytics);
  renderWeeklyBreakdown(analytics);
  renderMonthlyComparison(analytics);
  renderPaceAnalysis(analytics);
  renderCharts(analytics);
}

document.getElementById("loadStravaBtn").addEventListener("click", async () => {
  const rawToken = document.getElementById("stravaToken").value;
  const loadBtn = document.getElementById("loadStravaBtn");
  const parsed = parseStravaCredentialInput(rawToken);
  const token = parsed.token;

  if (parsed.error) {
    setStravaStatus(parsed.error, "status-error");
    return;
  }

  if (!token) {
    setStravaStatus("Add a Strava access token first.", "status-error");
    return;
  }

  if (parsed.warning) {
    setStravaStatus(parsed.warning);
  } else if (rawToken.trim().toLowerCase().startsWith("bearer ")) {
    setStravaStatus("Removed optional 'Bearer' prefix from pasted token.");
  }

  loadBtn.disabled = true;
  setStravaStatus("Loading runs from Strava...");

  try {
    const runs = await fetchStravaRuns(token);
    state.runs = runs.sort((a, b) => parseDate(a.date) - parseDate(b.date));
    refresh();
    setStravaStatus(`Loaded ${runs.length} runs from Strava.`, "status-success");
  } catch (err) {
    setStravaStatus(err.message, "status-error");
  } finally {
    loadBtn.disabled = false;
  }
});

document.getElementById("csvInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    state.runs = parseCsvRuns(text);
    refresh();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("loadSheetBtn").addEventListener("click", async () => {
  const rawUrl = document.getElementById("sheetUrl").value.trim();
  if (!rawUrl) {
    setSheetStatus("Paste a Google Sheet URL first.", "status-error");
    return;
  }

  setSheetStatus("Loading CSV from Google Sheet...");

  try {
    const csvUrl = googleSheetUrlToCsvUrl(rawUrl);
    const res = await fetch(csvUrl);
    if (!res.ok) {
      throw new Error(`Google Sheet request failed (${res.status}). Ensure the sheet is shared for viewing.`);
    }
    const text = await res.text();
    state.runs = parseCsvRuns(text);
    refresh();
    setSheetStatus(`Loaded ${state.runs.length} runs from Google Sheet.`, "status-success");
  } catch (err) {
    setSheetStatus(err.message, "status-error");
  }
});

["paceA", "paceB", "predictDistance"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => state.runs.length && refresh());
});

const sampleCsv = `date,distance_mi,moving_time_sec\n2026-01-02,5.2,2610\n2026-01-04,3.1,1560\n2026-01-06,7.0,3540\n2026-01-11,10.0,5280\n2026-01-17,6.4,3210\n2026-01-24,12.3,6510\n2026-02-01,8.0,4080\n2026-02-09,4.0,1980\n`;
state.runs = parseCsvRuns(sampleCsv);
refresh();
