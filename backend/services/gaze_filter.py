import logging
import cv2
from config import GAZE_SAMPLE_INTERVAL, GAZE_MIN_EYE_RATIO, GAZE_MIN_FACE_RATIO

logger = logging.getLogger(__name__)

_face_cascade = None
_eye_cascade = None


def _get_cascades():
    global _face_cascade, _eye_cascade
    if _face_cascade is None:
        _face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        _eye_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_eye.xml"
        )
    return _face_cascade, _eye_cascade


def _check_frame(frame) -> tuple[bool, bool]:
    """Returns (face_found, eyes_found)."""
    face_cascade, eye_cascade = _get_cascades()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
    )
    if len(faces) == 0:
        return False, False

    x, y, w, h = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[0]
    # Only check upper 60% of face for eyes (avoids false positives from mouth/chin)
    roi = gray[y : y + int(h * 0.6), x : x + w]
    eyes = eye_cascade.detectMultiScale(
        roi, scaleFactor=1.1, minNeighbors=4, minSize=(20, 20)
    )
    return True, len(eyes) >= 1


def filter_by_gaze(
    video_path: str, segments: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    """
    Drop speech segments where the person isn't looking at the camera.
    Uses frontal face + eye detection: if eyes are visible, the face is
    roughly camera-facing. If a face is present but eyes aren't detectable,
    the person is likely looking down at notes or a script.
    """
    if not segments:
        return segments

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    kept = []

    for start, end in segments:
        duration = end - start
        if duration < 0.5:
            kept.append((start, end))
            continue

        face_count = 0
        eye_count = 0
        total = 0

        t = start
        while t < end:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
            ret, frame = cap.read()
            if ret:
                face, eyes = _check_frame(frame)
                if face:
                    face_count += 1
                if eyes:
                    eye_count += 1
                total += 1
            t += GAZE_SAMPLE_INTERVAL

        if total == 0:
            kept.append((start, end))
            continue

        face_ratio = face_count / total

        # No face detected → person not on camera, skip
        if face_ratio < GAZE_MIN_FACE_RATIO:
            logger.info(f"Gaze filter: dropped [{start:.1f}s-{end:.1f}s] — no face detected ({face_ratio:.0%})")
            continue

        # Face present but eyes not visible → likely reading/looking away
        eye_ratio = eye_count / face_count if face_count > 0 else 0
        if eye_ratio < GAZE_MIN_EYE_RATIO:
            logger.info(f"Gaze filter: dropped [{start:.1f}s-{end:.1f}s] — eyes not visible ({eye_ratio:.0%} of face frames)")
            continue

        kept.append((start, end))

    cap.release()
    logger.info(f"Gaze filter: kept {len(kept)}/{len(segments)} segments")
    return kept
