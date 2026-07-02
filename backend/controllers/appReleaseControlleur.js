// backend/controllers/appReleaseController.js
import asyncHandler from "../middleware/asyncHandler.js";
import AppRelease from "../models/AppReleaseModel.js";

// Incrémente la version : "1.0.1" -> "1.0.2". Aucune -> "1.0.1".
const nextVersion = (prev) => {
  if (!prev) return "1.0.1";
  const parts = String(prev).trim().split(".");
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    parts[2] = String(Number(parts[2]) + 1);
    return parts.join(".");
  }
  const m = String(prev).match(/^(.*?)(\d+)\s*$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  return "1.0.1";
};

const isImageDataUrl = (s) =>
  typeof s === "string" && /^data:image\/[a-z.+-]+;base64,/i.test(s.trim());

// @desc    Release courante (PUBLIC — sert la page d'installation)
// @route   GET /api/app-release/current
// @access  Public
const getCurrentRelease = asyncHandler(async (req, res) => {
  const rel = await AppRelease.findOne().sort({ createdAt: -1 });
  if (!rel) {
    return res.json({ version: null, qr: null, note: "", empty: true });
  }
  res.json({
    _id: rel._id,
    version: rel.version,
    qr: rel.qr,
    note: rel.note,
    createdAt: rel.createdAt,
  });
});

// @desc    Historique des releases (sans le QR, léger) — admin
// @route   GET /api/app-release
// @access  Private/Admin
const getReleases = asyncHandler(async (req, res) => {
  const releases = await AppRelease.find({})
    .select("-qr")
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("createdBy", "nom prenom");
  res.json(releases);
});

// @desc    Nouvelle release (upload QR) — version auto-incrémentée
// @route   POST /api/app-release
// @access  Private/Admin
const createRelease = asyncHandler(async (req, res) => {
  const { qr, version, note } = req.body;

  if (!isImageDataUrl(qr)) {
    res.status(400);
    throw new Error("QR code invalide : image (PNG/JPG) requise.");
  }

  const last = await AppRelease.findOne().sort({ createdAt: -1 });
  const proposed = nextVersion(last ? last.version : null);
  const finalVersion =
    version && /^\d+(\.\d+)*$/.test(String(version).trim())
      ? String(version).trim()
      : proposed;

  const release = await AppRelease.create({
    version: finalVersion,
    qr,
    note: String(note || "").trim(),
    createdBy: req.user._id,
  });

  res.status(201).json({
    _id: release._id,
    version: release.version,
    qr: release.qr,
    note: release.note,
    createdAt: release.createdAt,
  });
});

export { getCurrentRelease, getReleases, createRelease };