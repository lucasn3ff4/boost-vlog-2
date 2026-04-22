import asyncio
import json
import logging
import subprocess
from pathlib import Path

from google import genai
from google.genai import types

from config import GEMINI_API_KEY, REMIX_DIR, REMIX_DURATION
from services.title_generator import get_client as get_anthropic_client

logger = logging.getLogger(__name__)

_genai_client: genai.Client | None = None


def get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY environment variable is not set")
        _genai_client = genai.Client(api_key=GEMINI_API_KEY)
    return _genai_client


def _extract_reference_frame(source_path: str, time_seconds: float, output_path: str) -> str:
    """Extract a single frame from a video at the given time."""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(time_seconds),
        "-i", source_path,
        "-frames:v", "1",
        "-q:v", "2",
        output_path,
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return output_path


def _probe_duration(video_path: str) -> float:
    """Get duration of a video file using ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    info = json.loads(result.stdout)
    return float(info["format"]["duration"])


def find_boundaries(timeline_entries: list[dict]) -> list[dict]:
    """Find all b-roll/talking boundaries in the timeline.

    Each entry in timeline_entries should have:
        position, clip_type, clip_id, source_path, start_time, end_time,
        timeline_start, timeline_end, transcript (full parent clip transcript)
    """
    boundaries = []
    for i in range(len(timeline_entries) - 1):
        curr = timeline_entries[i]
        nxt = timeline_entries[i + 1]

        curr_type = curr["clip_type"]
        nxt_type = nxt["clip_type"]

        # B-roll → Talking boundary
        if curr_type == "broll" and nxt_type == "talking":
            boundaries.append({
                "index": len(boundaries),
                "insert_after_position": curr["position"],
                "broll_source_path": curr["source_path"],
                "broll_sub_clip_id": curr.get("sub_clip_id"),
                "broll_start": curr["start_time"],
                "broll_end": curr["end_time"],
                "timeline_position": curr["timeline_end"],
                "talking_transcript": nxt["transcript"] or "",
                "broll_description": "",
            })
        # Talking → B-roll boundary
        elif curr_type == "talking" and nxt_type == "broll":
            boundaries.append({
                "index": len(boundaries),
                "insert_after_position": curr["position"],
                "broll_source_path": nxt["source_path"],
                "broll_sub_clip_id": nxt.get("sub_clip_id"),
                "broll_start": nxt["start_time"],
                "broll_end": nxt["end_time"],
                "timeline_position": curr["timeline_end"],
                "talking_transcript": curr["transcript"] or "",
                "broll_description": "",
            })

    return boundaries


def select_boundaries_and_generate_prompts(
    boundaries: list[dict],
    total_duration: float,
) -> list[dict]:
    """Use Claude to decide how many remixes and generate video generation prompts."""
    if not boundaries:
        return []

    client = get_anthropic_client()

    boundary_descriptions = []
    for b in boundaries:
        transcript_preview = b["talking_transcript"][:500]
        broll_desc = b.get("broll_description", "")
        desc = f"Boundary {b['index']}: at {b['timeline_position']:.1f}s in timeline."
        if broll_desc:
            desc += f" B-roll visual: \"{broll_desc}\""
        desc += f" Transcript context: \"{transcript_preview}\""
        boundary_descriptions.append(desc)

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=(
            "You are a creative video editor. You are selecting transition points in a vlog "
            "timeline where AI-generated remix clips will be inserted. These remix clips are "
            "short (8 second) AI-generated video transitions between b-roll footage and talking "
            "segments.\n\n"
            "For each selected boundary, generate a creative video generation prompt that:\n"
            "- Describes a visually interesting variation/remix of the b-roll footage\n"
            "- Is thematically connected to the adjacent talking segment's transcript\n"
            "- Is concise (1-2 sentences) and focuses on visual description\n"
            "- Creates a smooth visual transition feel\n"
            "- MUST include 'no music' in every prompt\n\n"
            "Respond with ONLY valid JSON, no other text."
        ),
        messages=[{
            "role": "user",
            "content": (
                f"Timeline total duration: {total_duration:.1f} seconds\n\n"
                f"Available boundaries:\n" +
                "\n".join(boundary_descriptions) +
                f"\n\nSelect the best boundary(ies) for remix clips. "
                f"Pick 1 if the video is under ~60 seconds, pick 2 (evenly spaced) "
                f"if it's longer. Never pick more than 2.\n\n"
                f"Respond as a JSON array:\n"
                f'[{{"boundary_index": <int>, "video_prompt": "<prompt>"}}]'
            ),
        }],
    )

    text = response.content[0].text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    selections = json.loads(text)

    result = []
    for sel in selections:
        idx = sel["boundary_index"]
        if 0 <= idx < len(boundaries):
            result.append({
                **boundaries[idx],
                "video_prompt": sel["video_prompt"],
            })

    return result


async def generate_remix_video(
    broll_source_path: str,
    broll_start: float,
    broll_end: float,
    video_prompt: str,
    output_path: str,
) -> str:
    """Generate a remix video using Google Veo image-to-video."""
    client = get_genai_client()

    # Extract a reference frame from the middle of the b-roll clip
    mid_time = (broll_start + broll_end) / 2
    frame_path = output_path.replace(".mp4", "_ref.jpg")
    _extract_reference_frame(broll_source_path, mid_time, frame_path)

    # Read the reference image
    frame_bytes = Path(frame_path).read_bytes()
    frame_image = types.Image(
        image_bytes=frame_bytes,
        mime_type="image/jpeg",
    )

    # Create video generation request
    logger.info("Starting Veo video generation: %s", video_prompt)
    operation = client.models.generate_videos(
        model="veo-3.1-generate-preview",
        prompt=video_prompt,
        image=frame_image,
        config=types.GenerateVideosConfig(
            aspect_ratio="16:9",
            number_of_videos=1,
            duration_seconds=int(REMIX_DURATION),
            negative_prompt="music",
        ),
    )

    # Poll for completion
    max_wait = 300  # 5 minutes
    poll_interval = 10
    elapsed = 0
    while not operation.done:
        if elapsed >= max_wait:
            raise RuntimeError(f"Veo task timed out after {max_wait}s")
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        operation = client.operations.get(operation)
        logger.info("Veo operation status: done=%s (elapsed %ds)", operation.done, elapsed)

    logger.info("Veo operation response: %s", operation.response)
    logger.info("Veo operation result: %s", operation.result)
    if not operation.response or not operation.response.generated_videos:
        raise RuntimeError("Veo generation returned no videos")

    # Download the generated video via URI
    import urllib.request
    clip = operation.response.generated_videos[0]
    video_uri = clip.video.uri
    dl_sep = "&" if "?" in video_uri else "?"
    video_dl_url = f"{video_uri}{dl_sep}key={GEMINI_API_KEY}"

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(video_dl_url, output_path)

    # Clean up reference frame
    Path(frame_path).unlink(missing_ok=True)

    duration = _probe_duration(output_path)
    logger.info("Generated remix video: %s (%.1fs)", output_path, duration)
    return output_path
