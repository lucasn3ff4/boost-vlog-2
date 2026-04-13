import random


def _build_clip_layout(timeline_items) -> list[dict]:
    """Build clip layout with timeline start/end for each clip."""
    clips = []
    cursor = 0.0
    for item in timeline_items:
        if item.sub_clip_id and item.sub_clip:
            sub = item.sub_clip
            duration = sub.end_time - sub.start_time
        elif item.clip_id and item.clip:
            duration = item.clip.duration or 0
        else:
            continue

        if duration < 0.034:
            continue

        clips.append({"start": cursor, "end": cursor + duration, "duration": duration})
        cursor += duration

    return clips


def generate_effect_items(
    timeline_items,
    excluded_ranges: list[tuple[float, float]],
    fraction: float = 0.35,
) -> list[dict]:
    """Generate random adjustment items for a single effect type.

    Picks ~fraction of eligible clips (>= 2s), excluding any that overlap
    with excluded_ranges (i.e. clips already claimed by the other effect).
    Returns list of {start_time, end_time} dicts.
    """
    clips = _build_clip_layout(timeline_items)

    # Filter to clips >= 2 seconds and not overlapping excluded ranges
    eligible = []
    for c in clips:
        if c["duration"] < 2.0:
            continue
        overlaps = any(
            c["end"] > ex_start and c["start"] < ex_end
            for ex_start, ex_end in excluded_ranges
        )
        if not overlaps:
            eligible.append(c)

    if not eligible:
        return []

    random.shuffle(eligible)

    count = max(1, round(len(eligible) * fraction))
    selected = eligible[:count]

    return [{"start_time": c["start"], "end_time": c["end"]} for c in selected]
