"""AI Language Translator - FastAPI backend.

Translates text with the free MyMemory translation API (no API key needed).

Run:  python -m uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

import html
import io
import os
import re
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from languages import BY_CODE, LANGUAGES, api_code

load_dotenv()

MYMEMORY_EMAIL = os.getenv("MYMEMORY_EMAIL", "").strip()
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

MYMEMORY_URL = "https://api.mymemory.translated.net/get"
MYMEMORY_LIMIT = 450  # MyMemory accepts at most 500 *bytes* per request
MAX_CHARS = 5000

app = FastAPI(title="AI Language Translator", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
class TranslateRequest(BaseModel):
    text: str = Field(..., max_length=MAX_CHARS)
    source: str = "auto"
    target: str


class TranslateResponse(BaseModel):
    translatedText: str
    source: str
    target: str
    detectedSource: Optional[str] = None


class SpeakRequest(BaseModel):
    text: str = Field(..., max_length=MAX_CHARS)
    lang: str


class EngineError(Exception):
    """The translation service failed in a way we can explain to the user."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
SENTENCE_SPLIT = r"(?<=[。！？])|(?<=[.!?۔؟])\s+"


def _byte_len(s: str) -> int:
    return len(s.encode("utf-8"))


def _norm_lang(code: Optional[str]) -> Optional[str]:
    """'en-GB' -> 'en'; returns None if we don't support that language."""
    if not code:
        return None
    base = re.split(r"[-_]", code.lower())[0]
    return base if base in BY_CODE else None


def _split_long(sentence: str, limit: int) -> list[str]:
    """Break a sentence that is too long for one request into smaller pieces."""
    if _byte_len(sentence) <= limit:
        return [sentence]
    pieces, current = [], ""
    for word in sentence.split(" "):
        while _byte_len(word) > limit:  # one giant "word", e.g. unspaced CJK text
            if current:
                pieces.append(current)
                current = ""
            step = limit // 4  # a character is at most 4 bytes
            pieces.append(word[:step])
            word = word[step:]
        candidate = f"{current} {word}".strip() if current else word
        if _byte_len(candidate) <= limit:
            current = candidate
        else:
            pieces.append(current)
            current = word
    if current:
        pieces.append(current)
    return pieces


def chunk_line(line: str, limit: int = MYMEMORY_LIMIT) -> list[str]:
    """Pack sentences into chunks that stay under the byte limit."""
    sentences = [s for s in re.split(SENTENCE_SPLIT, line) if s and s.strip()]
    chunks, current = [], ""
    for sentence in sentences:
        for piece in _split_long(sentence, limit):
            candidate = f"{current} {piece}".strip() if current else piece
            if _byte_len(candidate) <= limit:
                current = candidate
            else:
                chunks.append(current)
                current = piece
    if current:
        chunks.append(current)
    return chunks


# --------------------------------------------------------------------------
# MyMemory translation API (free, no key)
# --------------------------------------------------------------------------
async def translate_mymemory(
    client: httpx.AsyncClient, text: str, source: str, target: str
) -> tuple[str, Optional[str]]:
    src = "Autodetect" if source == "auto" else api_code(source)
    tgt = api_code(target)
    joiner = "" if target in {"zh", "ja"} else " "
    detected: Optional[str] = None
    out_lines = []

    for line in text.split("\n"):  # translate line by line to keep paragraphs
        if not line.strip():
            out_lines.append("")
            continue
        parts = []
        for chunk in chunk_line(line):
            params = {"q": chunk, "langpair": f"{src}|{tgt}"}
            if MYMEMORY_EMAIL:
                params["de"] = MYMEMORY_EMAIL
            resp = await client.get(MYMEMORY_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

            status = int(data.get("responseStatus", 200))
            translated = (data.get("responseData") or {}).get("translatedText", "")
            if status != 200:
                raise EngineError(
                    str(data.get("responseDetails") or "MyMemory returned an error."),
                    429 if status == 429 else 502,
                )
            if "MYMEMORY WARNING" in translated.upper():
                raise EngineError(
                    "MyMemory's free daily limit is used up. Try again tomorrow, "
                    "or set MYMEMORY_EMAIL in backend/.env for a higher limit.",
                    429,
                )
            if detected is None:
                detected = _norm_lang((data.get("responseData") or {}).get("detectedLanguage"))
            parts.append(html.unescape(translated))
        out_lines.append(joiner.join(parts))

    return "\n".join(out_lines), detected


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/languages")
def languages():
    return {"languages": LANGUAGES, "maxChars": MAX_CHARS}


@app.post("/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Please enter some text to translate.")
    if req.target not in BY_CODE:
        raise HTTPException(400, f"Unsupported target language: {req.target}")
    if req.source != "auto" and req.source not in BY_CODE:
        raise HTTPException(400, f"Unsupported source language: {req.source}")
    if req.source == req.target:
        raise HTTPException(400, "Source and target languages are the same.")

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            translated, detected = await translate_mymemory(
                client, text, req.source, req.target
            )
    except EngineError as exc:
        raise HTTPException(exc.status, exc.message)
    except httpx.TimeoutException:
        raise HTTPException(504, "The translation service took too long to respond. Please try again.")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Could not reach the translation service ({type(exc).__name__}).")

    if detected and detected == req.target and req.source == "auto":
        raise HTTPException(400, "Detected language is the same as the target language.")

    return TranslateResponse(
        translatedText=translated,
        source=req.source,
        target=req.target,
        detectedSource=detected,
    )


@app.post("/speak")
async def speak(req: SpeakRequest):
    """Text-to-speech: returns an MP3 of the text, made with the gTTS package."""
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "There is no text to speak.")
    if req.lang not in BY_CODE:
        raise HTTPException(400, f"Unsupported language: {req.lang}")

    try:
        from gtts import gTTS  # type: ignore
    except ImportError:
        raise HTTPException(
            503, "Server speech needs the gTTS package. Run: python -m pip install gTTS"
        )

    def synthesize() -> bytes:
        buffer = io.BytesIO()
        gTTS(text=text, lang=api_code(req.lang)).write_to_fp(buffer)
        return buffer.getvalue()

    try:
        audio = await run_in_threadpool(synthesize)
    except ValueError:  # gTTS does not support this language
        raise HTTPException(
            400, f"Server speech is not available for {BY_CODE[req.lang]['name']}."
        )
    except Exception:
        raise HTTPException(
            502, "Could not generate speech. Check your internet connection and try again."
        )

    return Response(content=audio, media_type="audio/mpeg")