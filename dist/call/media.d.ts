/** Local media helpers: microphone/camera, camera switching, screen capture. */
export interface MediaRequest {
    audio: boolean;
    video: boolean;
}
/** Microphone (with echo cancellation, noise suppression, gain control) and/or camera. */
export declare function getLocalMedia(md: MediaDevices | undefined, req: MediaRequest): Promise<MediaStream>;
/**
 * The next camera after `current`: the next `videoinput` device, or — on
 * phones that list one device — the other facing mode.
 */
export declare function nextCamera(md: MediaDevices | undefined, current: MediaStreamTrack | null): Promise<MediaStreamTrack>;
/** A screen/window/tab capture track. */
export declare function getScreenTrack(md: MediaDevices | undefined): Promise<MediaStreamTrack>;
