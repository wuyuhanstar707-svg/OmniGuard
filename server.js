const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
// Serve current folder so index.html + app.js are reachable.
app.use(express.static(path.join(__dirname)));

let examStatus = {
  movement: "Stable",
  rfSignal: "Clear",
  heartRate: 72,
  gaze: "On Screen",
  objects: "None",
  aiAlert: "Low Risk",
};

app.post("/api/update-sensors", (req, res) => {
  examStatus = { ...examStatus, ...req.body };
  res.status(200).json({ message: "OmniGuard System Updated" });
});

app.get("/api/status", (_req, res) => {
  res.json(examStatus);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});