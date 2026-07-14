// ============================================================
// Per-Business-Unit RAG threshold configuration for the Monthly KPI Scorecard
// ============================================================
// This file is loaded after the main scorecard-kpi.html inline script and
// overrides color/benchmark behavior so each Business Unit can maintain its own
// Green / Amber / Red rules. If a BU has no custom configuration, the system
// defaults below are used. Thresholds are stored in localStorage per browser.

(function () {
  "use strict";

  var THRESHOLD_STORAGE_KEY = "monthlyKpiThresholdOverrides";

  // Keys intentionally match the KPI objects used by scorecard-kpi.html.
  var DEFAULT_THRESHOLDS = {
    pmCompliance: {
      key: "pmCompliance",
      name: "PM Compliance",
      unit: "%",
      green: { min: 98 },
      amber: { min: 90, max: 98 },
      red: { max: 90 },
    },
    budgetSpend: {
      key: "budgetSpend",
      name: "Budget Spend",
      unit: "%",
      twoSided: true,
      green: { min: 95, max: 105 },
      amber: { min: 90, max: 110 },
      red: { max: 90, min: 110 },
    },
    pmcmWORatio: {
      key: "pmcmWORatio",
      name: "PM:CM Ratio (WO)",
      unit: "%",
      green: { min: 86 },
      amber: { min: 75, max: 86 },
      red: { max: 75 },
    },
    pmcmCostRatio: {
      key: "pmcmCostRatio",
      name: "PM:CM Ratio (Cost)",
      unit: "%",
      green: { min: 80 },
      amber: { min: 50, max: 80 },
      red: { max: 50 },
    },
    facilityUptime: {
      key: "facilityUptime",
      name: "Facility Uptime",
      unit: "%",
      green: { min: 100 },
      amber: { min: 99, max: 100 },
      red: { max: 99 },
    },
    mttr: {
      key: "mttr",
      name: "MTTR",
      unit: "days",
      dataExistsGreen: true,
      green: {},
      amber: {},
      red: {},
    },
  };

  var THRESHOLD_ORDER = [
    "pmCompliance",
    "budgetSpend",
    "pmcmWORatio",
    "pmcmCostRatio",
    "facilityUptime",
    "mttr",
  ];

  var _originalGetKPIStatus = window.getKPIStatus;
  var _originalFormatBenchmark = window.formatBenchmark;
  var _originalBenchmarkOptionsFor = window.benchmarkOptionsFor;

  function cloneBand(band) {
    return { min: band && band.min != null ? band.min : null, max: band && band.max != null ? band.max : null };
  }

  function cloneRule(rule) {
    return {
      key: rule.key,
      name: rule.name,
      unit: rule.unit,
      green: cloneBand(rule.green),
      amber: cloneBand(rule.amber),
      red: cloneBand(rule.red),
      twoSided: rule.twoSided,
      dataExistsGreen: rule.dataExistsGreen,
    };
  }

  function cloneDefaults() {
    var result = {};
    for (var i = 0; i < THRESHOLD_ORDER.length; i++) {
      var key = THRESHOLD_ORDER[i];
      result[key] = cloneRule(DEFAULT_THRESHOLDS[key]);
    }
    return result;
  }

  function loadOverrides() {
    try {
      var raw = localStorage.getItem(THRESHOLD_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
      return {};
    } catch (err) {
      return {};
    }
  }

  function saveOverrides(overrides) {
    try {
      localStorage.setItem(THRESHOLD_STORAGE_KEY, JSON.stringify(overrides));
    } catch (err) {
      // Ignore storage errors (e.g. private mode)
    }
  }

  function mergeWithDefaults(custom) {
    var result = cloneDefaults();
    if (!custom || typeof custom !== "object") return result;
    for (var i = 0; i < THRESHOLD_ORDER.length; i++) {
      var key = THRESHOLD_ORDER[i];
      if (custom[key] && typeof custom[key] === "object") {
        var c = custom[key];
        if (c.green) result[key].green = cloneBand(c.green);
        if (c.amber) result[key].amber = cloneBand(c.amber);
        if (c.red) result[key].red = cloneBand(c.red);
        if (typeof c.twoSided === "boolean") result[key].twoSided = c.twoSided;
        if (typeof c.dataExistsGreen === "boolean") result[key].dataExistsGreen = c.dataExistsGreen;
      }
    }
    return result;
  }

  function getThresholdConfigForBU(buId) {
    var overrides = loadOverrides();
    var custom = overrides[buId];
    return mergeWithDefaults(custom);
  }

  function setThresholdConfigForBU(buId, config) {
    var overrides = loadOverrides();
    overrides[buId] = config;
    saveOverrides(overrides);
  }

  function removeThresholdConfigForBU(buId) {
    var overrides = loadOverrides();
    delete overrides[buId];
    saveOverrides(overrides);
  }

  function getSelectedBuIdForThresholds() {
    var sel = document.getElementById("thresholdBuSel");
    if (sel && sel.value) return sel.value;
    if (typeof getSelectedBU === "function") {
      var bu = getSelectedBU();
      if (bu && bu.id) return bu.id;
    }
    if (typeof selectedBusinessUnitId !== "undefined" && selectedBusinessUnitId) return selectedBusinessUnitId;
    return "ez";
  }

  function parseThresholdNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    var parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  function evaluateThresholdStatus(key, value, config) {
    var rule = config[key];
    if (!rule) return { status: "missing", label: "Missing" };

    var v = parseThresholdNumber(value);

    if (rule.dataExistsGreen) {
      return v !== null && v > 0 ? { status: "green", label: "Available" } : { status: "missing", label: "Missing" };
    }

    if (v === null) return { status: "missing", label: "Missing" };

    var green = rule.green;
    var amber = rule.amber;
    var twoSided = rule.twoSided;

    if (twoSided) {
      if (green.min != null && green.max != null && v >= green.min && v <= green.max) {
        return { status: "green", label: "On Target" };
      }
      if (amber.min != null && green.min != null && v >= amber.min && v < green.min) {
        return { status: "amber", label: "Warning" };
      }
      if (green.max != null && amber.max != null && v > green.max && v <= amber.max) {
        return { status: "amber", label: "Warning" };
      }
      return { status: "red", label: "Off Target" };
    }

    if (green.min != null && v >= green.min) return { status: "green", label: "Passed" };
    if (amber.min != null && v >= amber.min) return { status: "amber", label: "Near Target" };
    return { status: "red", label: "Below Target" };
  }

  function formatThresholdBenchmark(rule) {
    if (!rule) return "";
    if (rule.dataExistsGreen) return "Data exists";
    if (rule.twoSided) {
      var min = rule.green && rule.green.min != null ? rule.green.min : rule.amber && rule.amber.min;
      var max = rule.green && rule.green.max != null ? rule.green.max : rule.amber && rule.amber.max;
      if (min != null && max != null) return min + "%–" + max + "%";
    }
    if (rule.green && rule.green.min != null) {
      if (rule.key === "facilityUptime") {
        return "=" + rule.green.min + (rule.unit === "%" ? "%" : "");
      }
      return "≥" + rule.green.min + (rule.unit === "%" ? "%" : "");
    }
    return "";
  }

  function validateThresholdConfig(config) {
    var errors = [];
    for (var i = 0; i < THRESHOLD_ORDER.length; i++) {
      var key = THRESHOLD_ORDER[i];
      var rule = config[key];
      if (!rule) {
        errors.push(key + ": missing threshold rule");
        continue;
      }
      if (rule.dataExistsGreen) continue;

      var green = rule.green || {};
      var amber = rule.amber || {};
      var red = rule.red || {};
      var twoSided = rule.twoSided;

      if (green.min == null) {
        errors.push(rule.name + ": green threshold is required");
        continue;
      }

      if (twoSided) {
        if (green.max == null) {
          errors.push(rule.name + ": green upper bound is required for a two-sided KPI");
          continue;
        }
        if (green.min >= green.max) {
          errors.push(rule.name + ": green lower bound must be less than upper bound");
        }
        if (amber.min == null || amber.max == null) {
          errors.push(rule.name + ": amber lower and upper bounds are required for a two-sided KPI");
        } else {
          if (amber.min >= green.min) {
            errors.push(rule.name + ": amber lower bound must be below green lower bound");
          }
          if (amber.max <= green.max) {
            errors.push(rule.name + ": amber upper bound must be above green upper bound");
          }
        }
      } else {
        if (amber.min == null) {
          errors.push(rule.name + ": amber lower bound is required");
        } else if (amber.min >= green.min) {
          errors.push(rule.name + ": amber lower bound must be below green lower bound");
        }
      }

      if (red.max != null && amber.min != null && red.max > amber.min) {
        errors.push(rule.name + ": red upper bound must be below amber lower bound");
      }
      if (red.min != null && amber.max != null && red.min < amber.max) {
        errors.push(rule.name + ": red lower bound must be above amber upper bound");
      }
    }
    return errors;
  }

  function getKpiThresholdKey(kpiKey) {
    // The scorecard-kpi.html KPI objects already use these exact keys.
    return DEFAULT_THRESHOLDS[kpiKey] ? kpiKey : null;
  }

  // Override global KPI status function.
  window.getKPIStatus = function (kpiKey, val) {
    if (val === null || val === undefined || val === "" || isNaN(val)) {
      return { cls: "kpi-missing", barCls: "", label: "Missing" };
    }
    var kpi = KPIs.find(function (k) {
      return k.key === kpiKey;
    });
    if (!kpi) return _originalGetKPIStatus ? _originalGetKPIStatus(kpiKey, val) : { cls: "", barCls: "", label: "" };

    var buId = getSelectedBuIdForThresholds();
    var config = getThresholdConfigForBU(buId);
    var result = evaluateThresholdStatus(kpiKey, parseFloat(val), config);
    var status = result.status;
    var cls = status === "amber" ? "kpi-yellow" : "kpi-" + status;
    var barCls = status === "amber" ? "gauge-fill yellow" : "gauge-fill " + status;
    return { cls: cls, barCls: barCls, label: result.label };
  };

  // Override benchmark label formatting.
  window.formatBenchmark = function (kpi) {
    if (!kpi) return "";
    var buId = getSelectedBuIdForThresholds();
    var config = getThresholdConfigForBU(buId);
    var rule = config[kpi.key];
    if (!rule) return _originalFormatBenchmark ? _originalFormatBenchmark(kpi) : "";
    return formatThresholdBenchmark(rule);
  };

  // Override chart benchmark annotations.
  window.benchmarkOptionsFor = function (kpiKey) {
    var buId = getSelectedBuIdForThresholds();
    var config = getThresholdConfigForBU(buId);
    var rule = config[kpiKey];
    if (!rule) return _originalBenchmarkOptionsFor ? _originalBenchmarkOptionsFor(kpiKey) : {};

    if (rule.twoSided && rule.green.min != null && rule.green.max != null) {
      return {
        range: {
          min: rule.green.min,
          max: rule.green.max,
          minLabel: "Benchmark " + rule.green.min + "%",
          maxLabel: "Benchmark " + rule.green.max + "%",
          color: "#0B1D44",
        },
      };
    }
    if (rule.green.min != null) {
      return {
        lines: [
          {
            value: rule.green.min,
            label: "Benchmark " + formatThresholdBenchmark(rule),
            color: "#0B1D44",
          },
        ],
      };
    }
    return {};
  };

  // ===== UI =====

  function initThresholdEditor() {
    addThresholdStyles();
    addThresholdControlsButton();
    addThresholdModal();
  }

  function addThresholdStyles() {
    if (document.getElementById("kpiThresholdStyles")) return;
    var style = document.createElement("style");
    style.id = "kpiThresholdStyles";
    style.textContent = [
      "#thresholdTable input[type='number']{width:72px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;font-family:inherit;}",
      "#thresholdTable .bound-group{display:flex;align-items:center;gap:6px;}",
      "#thresholdTable .bound-label{font-size:12px;color:var(--muted);white-space:nowrap;}",
      "#thresholdTable td{vertical-align:middle;padding:10px 8px;}",
      "#thresholdTable th{font-size:12px;padding:10px 8px;background:var(--navy);color:#fff;}",
      "#thresholdValidation{min-height:24px;}",
      "#thresholdValidation:empty{display:none;}",
      "#thresholdModal .modal{max-width:900px;}",
    ].join("");
    document.head.appendChild(style);
  }

  function addThresholdControlsButton() {
    var controls = document.querySelector(".controls");
    if (!controls || document.getElementById("thresholdBtn")) return;
    var btn = document.createElement("button");
    btn.id = "thresholdBtn";
    btn.className = "ctrl-btn ctrl-gray";
    btn.textContent = "Thresholds";
    btn.onclick = openThresholdEditor;
    controls.appendChild(btn);
  }

  function addThresholdModal() {
    if (document.getElementById("thresholdModal")) return;
    var modal = document.createElement("div");
    modal.id = "thresholdModal";
    modal.className = "modal-overlay";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "thresholdModalTitle");
    modal.innerHTML = [
      '<div class="modal" style="max-width:900px">',
      '  <div class="modal-header">',
      '    <div class="modal-title" id="thresholdModalTitle">RAG Threshold Configuration</div>',
      '    <button class="modal-close" onclick="closeThresholdModal()" aria-label="Close threshold editor">&times;</button>',
      '  </div>',
      '  <div class="manual-controls">',
      '    <div class="manual-field">',
      '      <label for="thresholdBuSel">Business Unit</label>',
      '      <select id="thresholdBuSel" onchange="handleThresholdBuChange()" aria-label="Threshold Business Unit"></select>',
      '    </div>',
      '  </div>',
      '  <div id="thresholdValidation" class="manual-validation" role="alert"></div>',
      '  <div style="overflow-x:auto">',
      '    <table class="matrix-table" id="thresholdTable">',
      '      <thead><tr><th>KPI</th><th>Green</th><th>Amber</th><th>Red</th></tr></thead>',
      '      <tbody id="thresholdTableBody"></tbody>',
      '    </table>',
      '  </div>',
      '  <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">',
      '    <button class="ctrl-btn ctrl-gray" onclick="closeThresholdModal()">Cancel</button>',
      '    <button class="ctrl-btn ctrl-red" onclick="resetThresholdConfig()">Reset to Default</button>',
      '    <button class="ctrl-btn ctrl-green" onclick="saveThresholdConfig()">Save</button>',
      '  </div>',
      '</div>',
    ].join("");
    document.body.appendChild(modal);

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeThresholdModal();
    });
  }

  function populateThresholdBuSelector() {
    var sel = document.getElementById("thresholdBuSel");
    if (!sel || typeof BUs === "undefined") return;
    var currentBu = getSelectedBuIdForThresholds();
    sel.innerHTML = BUs.map(function (bu) {
      return '<option value="' + bu.id + '">' + bu.label + "</option>";
    }).join("");
    sel.value = currentBu;
  }

  function renderRedLabel(rule) {
    if (rule.dataExistsGreen) return "TBD";
    if (rule.twoSided) {
      var aMin = rule.amber && rule.amber.min != null ? rule.amber.min : "";
      var aMax = rule.amber && rule.amber.max != null ? rule.amber.max : "";
      return "<" + aMin + "% or >" + aMax + "%";
    }
    var aMin = rule.amber && rule.amber.min != null ? rule.amber.min : "";
    return "<" + aMin + "%";
  }

  function renderThresholdTable() {
    var buId = getSelectedBuIdForThresholds();
    var config = getThresholdConfigForBU(buId);
    var tbody = document.getElementById("thresholdTableBody");
    if (!tbody) return;
    var html = "";
    for (var i = 0; i < THRESHOLD_ORDER.length; i++) {
      var key = THRESHOLD_ORDER[i];
      var rule = config[key];
      if (!rule) continue;
      html += '<tr class="threshold-row" data-key="' + key + '">";';
      html += "<td><strong>" + escapeHtml(rule.name) + "</strong>" + (rule.unit ? " (" + rule.unit + ")" : "") + "</td>";

      if (rule.dataExistsGreen) {
        html += "<td>Data exists</td><td>TBD</td><td>TBD</td>";
      } else if (rule.twoSided) {
        html +=
          '<td><div class="bound-group"><input type="number" step="0.01" class="thr-green-min" value="' +
          (rule.green.min != null ? rule.green.min : "") +
          '"><span class="bound-label">–</span><input type="number" step="0.01" class="thr-green-max" value="' +
          (rule.green.max != null ? rule.green.max : "") +
          '"></div></td>';
        html +=
          '<td><div class="bound-group"><input type="number" step="0.01" class="thr-amber-min" value="' +
          (rule.amber.min != null ? rule.amber.min : "") +
          '"><span class="bound-label">–</span><input type="number" step="0.01" class="thr-amber-max" value="' +
          (rule.amber.max != null ? rule.amber.max : "") +
          '"></div></td>';
        html += '<td class="thr-red-label">' + renderRedLabel(rule) + "</td>";
      } else {
        var greenOperator = rule.key === "facilityUptime" ? "=" : "≥";
        html +=
          '<td><div class="bound-group"><span class="bound-label">' + greenOperator + '</span><input type="number" step="0.01" class="thr-green-min" value="' +
          (rule.green.min != null ? rule.green.min : "") +
          '"></div></td>';
        html +=
          '<td><div class="bound-group"><input type="number" step="0.01" class="thr-amber-min" value="' +
          (rule.amber.min != null ? rule.amber.min : "") +
          '"><span class="bound-label thr-amber-max-label">to &lt;' +
          (rule.green.min != null ? rule.green.min : "") +
          '%</span></div></td>';
        html += '<td class="thr-red-label">' + renderRedLabel(rule) + "</td>";
      }
      html += "</tr>";
    }
    tbody.innerHTML = html;
    attachThresholdInputListeners();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function attachThresholdInputListeners() {
    var rows = document.querySelectorAll("#thresholdTableBody .threshold-row");
    rows.forEach(function (row) {
      var key = row.getAttribute("data-key");
      var rule = DEFAULT_THRESHOLDS[key];
      if (!rule || rule.dataExistsGreen) return;
      var greenMinInput = row.querySelector(".thr-green-min");
      var amberMinInput = row.querySelector(".thr-amber-min");
      var amberMaxInput = row.querySelector(".thr-amber-max");
      if (greenMinInput && !rule.twoSided) {
        greenMinInput.addEventListener("input", function () {
          var label = row.querySelector(".thr-amber-max-label");
          if (label) label.textContent = "to <" + greenMinInput.value + "%";
        });
      }
      if (amberMinInput) {
        amberMinInput.addEventListener("input", function () {
          var redLabel = row.querySelector(".thr-red-label");
          if (!redLabel) return;
          if (rule.twoSided && amberMaxInput) {
            redLabel.textContent = "<" + amberMinInput.value + "% or >" + amberMaxInput.value + "%";
          } else {
            redLabel.textContent = "<" + amberMinInput.value + "%";
          }
        });
      }
      if (amberMaxInput) {
        amberMaxInput.addEventListener("input", function () {
          var redLabel = row.querySelector(".thr-red-label");
          if (redLabel && amberMinInput) {
            redLabel.textContent = "<" + amberMinInput.value + "% or >" + amberMaxInput.value + "%";
          }
        });
      }
    });
  }

  function readThresholdConfigFromEditor() {
    var config = {};
    var rows = document.querySelectorAll("#thresholdTableBody .threshold-row");
    rows.forEach(function (row) {
      var key = row.getAttribute("data-key");
      var base = DEFAULT_THRESHOLDS[key];
      if (!base) return;
      var rule = cloneRule(base);

      if (base.dataExistsGreen) {
        config[key] = rule;
        return;
      }

      var greenMin = parseThresholdNumber(row.querySelector(".thr-green-min")?.value);
      var greenMax = base.twoSided ? parseThresholdNumber(row.querySelector(".thr-green-max")?.value) : null;
      var amberMin = parseThresholdNumber(row.querySelector(".thr-amber-min")?.value);
      var amberMax = base.twoSided ? parseThresholdNumber(row.querySelector(".thr-amber-max")?.value) : greenMin;

      rule.green = { min: greenMin, max: greenMax };
      rule.amber = { min: amberMin, max: amberMax };
      if (base.twoSided) {
        rule.red = { max: amberMin, min: amberMax };
      } else {
        rule.red = { max: amberMin };
      }
      config[key] = rule;
    });
    return config;
  }

  function showThresholdValidation(message) {
    var el = document.getElementById("thresholdValidation");
    if (!el) return;
    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
  }

  window.openThresholdEditor = function () {
    populateThresholdBuSelector();
    renderThresholdTable();
    var modal = document.getElementById("thresholdModal");
    if (modal) modal.classList.add("active");
    showThresholdValidation("");
  };

  window.closeThresholdModal = function () {
    var modal = document.getElementById("thresholdModal");
    if (modal) modal.classList.remove("active");
  };

  window.handleThresholdBuChange = function () {
    renderThresholdTable();
    showThresholdValidation("");
  };

  window.saveThresholdConfig = function () {
    var buId = getSelectedBuIdForThresholds();
    var config = readThresholdConfigFromEditor();
    var errors = validateThresholdConfig(config);
    if (errors.length) {
      showThresholdValidation("Please fix the following before saving: " + errors.join("; "));
      return;
    }
    setThresholdConfigForBU(buId, config);
    closeThresholdModal();
    if (typeof showToast === "function") showToast("success", "RAG thresholds saved for " + (getBUById(buId)?.label || buId) + ".");
    if (typeof loadData === "function") loadData();
  };

  window.resetThresholdConfig = function () {
    var buId = getSelectedBuIdForThresholds();
    removeThresholdConfigForBU(buId);
    closeThresholdModal();
    if (typeof showToast === "function") showToast("success", "RAG thresholds reset to default for " + (getBUById(buId)?.label || buId) + ".");
    if (typeof loadData === "function") loadData();
  };

  // Initialize when the script loads (body end, after inline script globals).
  initThresholdEditor();
})();
