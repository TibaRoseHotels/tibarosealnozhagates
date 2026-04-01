let scanner = null;
let lastCode = null;
let lastTime = 0;
let locked = false;
let currentCameraId = null;

function send(message) {
  window.parent.postMessage(message, "*");
}

function normalizeLabel(label) {
  return (label || "").toLowerCase().trim();
}

function scoreCameraLabel(label) {
  const l = normalizeLabel(label);
  let score = 0;

  // مفضلات
  if (l.includes("back")) score += 30;
  if (l.includes("rear")) score += 30;
  if (l.includes("environment")) score += 30;
  if (l.includes("main")) score += 40;
  if (l.includes("1x")) score += 35;
  if (l.includes("standard")) score += 20;

  // مستبعدات
  if (l.includes("ultrawide")) score -= 80;
  if (l.includes("ultra-wide")) score -= 80;
  if (l.includes("ultra wide")) score -= 80;
  if (l.includes("wide")) score -= 35;
  if (l.includes("macro")) score -= 90;
  if (l.includes("depth")) score -= 70;
  if (l.includes("bokeh")) score -= 60;
  if (l.includes("telephoto")) score -= 25;
  if (l.includes("0.5x")) score -= 90;
  if (l.includes("0.6x")) score -= 90;

  return score;
}

async function getBestCameraId() {
  const cameras = await Html5Qrcode.getCameras();
  if (!cameras || cameras.length === 0) return null;

  console.log("Available cameras:", cameras);

  let sorted = [...cameras].sort((a, b) => {
    return scoreCameraLabel(normalizeLabel(b.label)) - scoreCameraLabel(normalizeLabel(a.label));
  });

  console.log("Sorted cameras:", sorted.map(c => ({
    id: c.id,
    label: c.label,
    score: scoreCameraLabel(c.label),
  })));

  return sorted[0].id;
}

async function applyAdvancedConstraints() {
  try {
    const video = document.querySelector("#reader video");
    if (!video || !video.srcObject) return;

    const track = video.srcObject.getVideoTracks()[0];
    if (!track) return;

    // أول حاجة: اطلب دقة كويسة من غير zoom
    try {
      await track.applyConstraints({
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 }
      });
    } catch (_) {}

    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const advanced = {};

    // focus continuous لو مدعوم
    if (caps.focusMode) {
      advanced.focusMode = "continuous";
    }

    // متفرضش zoom عالي
    // لو عايز، جرب 1.2 بس كحد أقصى خفيف
    if (caps.zoom) {
      const min = caps.zoom.min || 1;
      const max = caps.zoom.max || 1;
      const target = Math.min(Math.max(1.15, min), max);
      advanced.zoom = target;
    }

    if (Object.keys(advanced).length > 0) {
      await track.applyConstraints({
        advanced: [advanced],
      });
    }

    if (track.getSettings) {
      console.log("Camera settings:", track.getSettings());
    }
    if (track.getCapabilities) {
      console.log("Camera capabilities:", track.getCapabilities());
    }
  } catch (e) {
    console.warn("constraints skipped", e);
  }
}

async function stopScanner() {
  try {
    if (scanner) {
      await scanner.stop();
    }
  } catch (_) {}
}

async function startScanner() {
  try {
    await stopScanner();

    scanner = new Html5Qrcode("reader");
    currentCameraId = await getBestCameraId();

    const config = {
      fps: 12,
      qrbox: (w, h) => {
        const size = Math.round(Math.min(w, h) * 0.32);
        return { width: size, height: size };
      },
      aspectRatio: 1.0,
      disableFlip: false,
      useBarCodeDetectorIfSupported: true,
      showTorchButtonIfSupported: true,
      showZoomSliderIfSupported: true,
      defaultZoomValueIfSupported: 1.0,
    };

    const cameraConfig = currentCameraId
      ? { deviceId: { exact: currentCameraId } }
      : { facingMode: { ideal: "environment" } };

    await scanner.start(
      cameraConfig,
      config,
      async (decodedText) => {
        const code = (decodedText || "").trim();
        if (!code) return;

        const now = Date.now();

        if (code === lastCode && now - lastTime < 1200) return;
        if (locked) return;

        locked = true;
        lastCode = code;
        lastTime = now;

        send({
          type: "qr-detected",
          code: code,
        });

        setTimeout(() => {
          locked = false;
        }, 800);
      },
      () => {
        send({ type: "qr-no-code" });
      }
    );

    setTimeout(applyAdvancedConstraints, 500);

    send({
      type: "qr-ready",
      cameraId: currentCameraId,
    });
  } catch (e) {
    console.error("scanner start failed", e);
    send({
      type: "qr-camera-error",
      error: e.toString(),
    });
  }
}

window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "qr-stop") {
    await stopScanner();
  }

  if (data.type === "qr-reset-lock") {
    locked = false;
  }

  if (data.type === "qr-start") {
    await startScanner();
  }
});

startScanner();