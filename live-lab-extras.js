/**
 * OmniGuard Live Lab — modals + /api/status polling (use with live-lab.html + app.js)
 */
(function () {
  const modalContent = {
    products: {
      title: "Product details — OmniGuard AI",
      html:
        "<p><strong>OmniGuard</strong> combines edge sensing with a browser-first control surface. The Live Lab uses Web Serial for direct device streaming; the sensor strip polls your <code>/api/status</code> JSON for fused telemetry.</p><ul><li><strong>Neon pipeline</strong> — Line-delimited numeric serial → Chart.js</li><li><strong>Integrity cues</strong> — Movement, RF, biometrics, gaze in one grid</li><li><strong>Extensible</strong> — POST <code>/api/update-sensors</code> from Pi or gateway</li></ul>",
    },
    architecture: {
      title: "Architecture",
      html:
        "<p><strong>Edge</strong> — Arduino / sensors → USB serial (Web Serial) or companion POST to Express.</p><p><strong>API</strong> — <code>GET /api/status</code> exposes movement, rfSignal, heartRate, gaze, objects, aiAlert. <code>POST /api/update-sensors</code> merges JSON into live state.</p><p><strong>UI</strong> — Chart.js for high-rate streams, tiles for fused fields. Served from the same origin as the API.</p>",
    },
    "sensor-ultrasonic": {
      title: "Ultrasonic — movement",
      html:
        "<p>High-frequency distance sensing to classify desk motion versus stable posture. Values surface as <code>movement</code> in <code>/api/status</code> (e.g. Stable / Motion).</p>",
    },
    "sensor-rf": {
      title: "RF detection",
      html:
        "<p>RF channel monitoring for unexpected transmitters in the exam band. Reported as <code>rfSignal</code> (e.g. Clear / Activity).</p>",
    },
    "sensor-heart": {
      title: "Heart rate (biometrics)",
      html:
        "<p>Pulse rate as BPM from your wearable or analog front-end. Mapped to <code>heartRate</code> in the API.</p>",
    },
    "sensor-gaze": {
      title: "Gaze tracking",
      html:
        "<p>Camera-assisted gaze classification: on-screen vs away. Exposed as <code>gaze</code> for multi-modal integrity scoring.</p>",
    },
  };

  const modalBackdrop = document.getElementById("modalRoot");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");
  if (!modalBackdrop || !modalBody) return;

  function openModal(key) {
    const data = modalContent[key];
    if (!data) return;
    modalBody.innerHTML = "<h2>" + data.title + "</h2>" + data.html;
    modalBackdrop.classList.add("is-open");
    modalBackdrop.setAttribute("aria-hidden", "false");
    if (modalClose) modalClose.focus();
  }

  function closeModal() {
    modalBackdrop.classList.remove("is-open");
    modalBackdrop.setAttribute("aria-hidden", "true");
  }

  document.querySelectorAll("[data-open-modal]").forEach(function (el) {
    el.addEventListener("click", function () {
      openModal(el.getAttribute("data-open-modal"));
    });
  });

  if (modalClose) modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", function (e) {
    if (e.target === modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  const apiPill = document.getElementById("apiPill");
  const liveDot = document.getElementById("liveDot");

  async function pollStatus() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error("bad");
      const d = await res.json();
      if (apiPill) apiPill.textContent = "API: live";
      if (liveDot) liveDot.style.background = "var(--cyan)";
      const set = function (id, v) {
        const el = document.getElementById(id);
        if (el) el.textContent = v ?? "—";
      };
      set("val-movement", d.movement);
      set("val-rf", d.rfSignal);
      const hrEl = document.getElementById("val-hr");
      if (hrEl) hrEl.textContent = d.heartRate != null ? d.heartRate + " BPM" : "—";
      set("val-gaze", d.gaze);
      set("val-objects", d.objects);
      set("val-alert", d.aiAlert);
    } catch {
      if (apiPill) apiPill.textContent = "API: offline";
      if (liveDot) liveDot.style.background = "#666";
    }
  }
  pollStatus();
  setInterval(pollStatus, 1000);
})();
