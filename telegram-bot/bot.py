#!/usr/bin/env python3
"""
Telegram bot backed by Claude (claude-opus-4-8).
Handles text messages and voice notes (Whisper transcription).
Per-contact conversation history kept in memory for the process lifetime.
"""

import asyncio
import logging
import os
import tempfile
from collections import defaultdict
from pathlib import Path

# Load .env from the bot's directory (ignored if file absent)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

import anthropic
import whisper
from telegram import Update
from telegram.ext import ApplicationBuilder, MessageHandler, ContextTypes, filters

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s – %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
# Optional: restrict to specific Telegram user IDs (comma-separated)
ALLOWED_IDS_RAW = os.environ.get("TELEGRAM_ALLOWED_IDS", "")
ALLOWED_IDS: set[int] = (
    {int(x.strip()) for x in ALLOWED_IDS_RAW.split(",") if x.strip()}
    if ALLOWED_IDS_RAW
    else set()
)

SYSTEM_PROMPT = os.environ.get(
    "CLAUDE_SYSTEM_PROMPT",
    "You are a helpful assistant. Be concise.",
)
MAX_HISTORY = int(os.environ.get("MAX_HISTORY_TURNS", "20"))

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
# Load Whisper once at startup (base model is fast; use "small" for better accuracy)
whisper_model = whisper.load_model(os.environ.get("WHISPER_MODEL", "base"))

# Per-user conversation history: {user_id: [{"role": ..., "content": ...}, ...]}
history: dict[int, list[dict]] = defaultdict(list)


def _trim(msgs: list[dict]) -> list[dict]:
    """Keep only the last MAX_HISTORY pairs (user + assistant)."""
    if len(msgs) > MAX_HISTORY * 2:
        return msgs[-(MAX_HISTORY * 2):]
    return msgs


def _is_allowed(user_id: int) -> bool:
    return not ALLOWED_IDS or user_id in ALLOWED_IDS


async def _reply_claude(update: Update, text: str) -> None:
    uid = update.effective_user.id
    history[uid].append({"role": "user", "content": text})
    history[uid] = _trim(history[uid])

    response = claude.messages.create(
        model="claude-opus-4-8",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=history[uid],
        thinking={"type": "adaptive"},
    )

    reply = next(
        (b.text for b in response.content if b.type == "text"),
        "(no text response)",
    )
    history[uid].append({"role": "assistant", "content": reply})
    await update.message.reply_text(reply)


async def handle_text(update: Update, _ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_allowed(update.effective_user.id):
        return
    await _reply_claude(update, update.message.text)


async def handle_voice(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_allowed(update.effective_user.id):
        return

    await update.message.reply_text("🎙 Transcribing…")

    voice = update.message.voice or update.message.audio
    tg_file = await ctx.bot.get_file(voice.file_id)

    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
        await tg_file.download_to_drive(tmp.name)
        tmp_path = tmp.name

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: whisper_model.transcribe(tmp_path)
        )
        transcript = result["text"].strip()
    finally:
        os.unlink(tmp_path)

    if not transcript:
        await update.message.reply_text("(Could not transcribe audio.)")
        return

    await update.message.reply_text(f'📝 "{transcript}"')
    await _reply_claude(update, transcript)


def main() -> None:
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, handle_voice))
    log.info("Bot starting…")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
