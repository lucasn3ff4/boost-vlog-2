import asyncio
import base64
import logging
import tempfile
from pathlib import Path

import anthropic
from config import ANTHROPIC_API_KEY

logger = logging.getLogger(__name__)

_async_client: anthropic.AsyncAnthropic | None = None


def _get_async_client() -> anthropic.AsyncAnthropic:
    global _async_client
    if _async_client is None:
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY environment variable is not set")
        _async_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _async_client


async def _extract_frame(source_path: str, time_seconds: float) -> str:
    """Extract a single JPEG frame from a video at the given time (non-blocking)."""
    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp.close()
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-ss", str(time_seconds),
        "-i", source_path,
        "-frames:v", "1",
        "-q:v", "2",
        tmp.name,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg frame extract failed: {stderr.decode()[-500:]}")
    return tmp.name


async def analyze_broll_frame(source_path: str, start_time: float, end_time: float) -> str:
    """Extract a midpoint frame from a b-roll clip and describe it with Claude vision."""
    mid = (start_time + end_time) / 2
    frame_path = await _extract_frame(source_path, mid)

    try:
        frame_bytes = Path(frame_path).read_bytes()
        frame_b64 = base64.standard_b64encode(frame_bytes).decode("utf-8")

        client = _get_async_client()
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": frame_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Describe this video frame in one concise sentence. Return only the sentence, nothing else.",
                        },
                    ],
                }
            ],
        )

        return response.content[0].text.strip()
    finally:
        Path(frame_path).unlink(missing_ok=True)
