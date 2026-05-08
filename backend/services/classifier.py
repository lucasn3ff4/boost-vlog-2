from models import ClipType


def classify(transcript: str, segments: list[dict] | None = None) -> ClipType:
    # If segment-level data is available, use it — any detected speech = TALKING
    if segments is not None:
        return ClipType.TALKING if segments else ClipType.BROLL
    # Fallback: any words in transcript = TALKING
    return ClipType.TALKING if transcript.strip() else ClipType.BROLL
