import logging
from difflib import SequenceMatcher
from config import TAKE_SIMILARITY_THRESHOLD, TAKE_WINDOW_SECONDS, TAKE_MIN_WORDS

logger = logging.getLogger(__name__)


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def select_takes(segments: list[dict]) -> list[dict]:
    """
    Given a list of transcript segments, detect repeated takes and keep only
    the last occurrence of each repeated phrase.

    A segment is a rejected take if a later segment (within TAKE_WINDOW_SECONDS)
    has sufficiently similar text. This handles chains: if take 1 → take 2 → take 3,
    takes 1 and 2 are dropped and take 3 is kept.

    Each segment is a dict with keys: start (float), end (float), text (str).
    """
    n = len(segments)
    if n < 2:
        return segments

    superseded = set()

    for i in range(n):
        seg_i = segments[i]
        words_i = seg_i["text"].split()
        if len(words_i) < TAKE_MIN_WORDS:
            continue

        for j in range(i + 1, n):
            seg_j = segments[j]
            if seg_j["start"] - seg_i["end"] > TAKE_WINDOW_SECONDS:
                break

            words_j = seg_j["text"].split()
            if len(words_j) < TAKE_MIN_WORDS:
                continue

            if _similarity(seg_i["text"], seg_j["text"]) >= TAKE_SIMILARITY_THRESHOLD:
                superseded.add(i)
                break

    if superseded:
        dropped = [segments[i]["text"][:60] for i in sorted(superseded)]
        logger.info(f"Take selection: dropped {len(superseded)} repeated take(s): {dropped}")

    return [seg for i, seg in enumerate(segments) if i not in superseded]
