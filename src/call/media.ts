/** Local media helpers: microphone/camera, camera switching, screen capture. */

export interface MediaRequest {
  audio: boolean;
  video: boolean;
}

function need(md: MediaDevices | undefined): MediaDevices {
  if (!md || typeof md.getUserMedia !== "function") {
    throw new Error("This browser cannot capture media (navigator.mediaDevices is missing; pages must be served over https)");
  }
  return md;
}

/** Microphone (with echo cancellation, noise suppression, gain control) and/or camera. */
export async function getLocalMedia(md: MediaDevices | undefined, req: MediaRequest): Promise<MediaStream> {
  return need(md).getUserMedia({
    audio: req.audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
    video: req.video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false,
  });
}

/**
 * The next camera after `current`: the next `videoinput` device, or — on
 * phones that list one device — the other facing mode.
 */
export async function nextCamera(md: MediaDevices | undefined, current: MediaStreamTrack | null): Promise<MediaStreamTrack> {
  const devices = need(md);
  const settings = (current?.getSettings?.() ?? {}) as MediaTrackSettings;
  let constraints: MediaTrackConstraints;
  const cams = (await devices.enumerateDevices()).filter((d) => d.kind === "videoinput" && d.deviceId);
  if (cams.length >= 2) {
    const i = cams.findIndex((d) => d.deviceId === settings.deviceId);
    constraints = { deviceId: { exact: cams[(i + 1) % cams.length].deviceId } };
  } else {
    constraints = { facingMode: settings.facingMode === "environment" ? "user" : "environment" };
  }
  const s = await devices.getUserMedia({ video: { ...constraints, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  const track = s.getVideoTracks()[0];
  if (!track) throw new Error("No camera track");
  return track;
}

/** A screen/window/tab capture track. */
export async function getScreenTrack(md: MediaDevices | undefined): Promise<MediaStreamTrack> {
  const devices = need(md);
  if (typeof devices.getDisplayMedia !== "function") {
    throw new Error("This browser cannot share the screen");
  }
  const s = await devices.getDisplayMedia({ video: true, audio: false });
  const track = s.getVideoTracks()[0];
  if (!track) throw new Error("No screen track");
  try {
    (track as any).contentHint = "detail";
  } catch {
    // optional
  }
  return track;
}
