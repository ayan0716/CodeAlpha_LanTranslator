"""Supported languages.

Each entry carries the codes the app needs:
  code    ISO 639-1 code used by the UI and the translation API
  speech  BCP-47 tag used by the browser's text-to-speech
  api     optional override when the API wants a different code
"""

LANGUAGES = [
    {"code": "en", "name": "English", "speech": "en-US"},
    {"code": "ur", "name": "Urdu", "speech": "ur-PK"},
    {"code": "ar", "name": "Arabic", "speech": "ar-SA"},
    {"code": "hi", "name": "Hindi", "speech": "hi-IN"},
    {"code": "pa", "name": "Punjabi", "speech": "pa-IN"},
    {"code": "bn", "name": "Bengali", "speech": "bn-BD"},
    {"code": "fa", "name": "Persian", "speech": "fa-IR"},
    {"code": "tr", "name": "Turkish", "speech": "tr-TR"},
    {"code": "es", "name": "Spanish", "speech": "es-ES"},
    {"code": "fr", "name": "French", "speech": "fr-FR"},
    {"code": "de", "name": "German", "speech": "de-DE"},
    {"code": "it", "name": "Italian", "speech": "it-IT"},
    {"code": "pt", "name": "Portuguese", "speech": "pt-PT"},
    {"code": "nl", "name": "Dutch", "speech": "nl-NL"},
    {"code": "sv", "name": "Swedish", "speech": "sv-SE"},
    {"code": "pl", "name": "Polish", "speech": "pl-PL"},
    {"code": "el", "name": "Greek", "speech": "el-GR"},
    {"code": "ru", "name": "Russian", "speech": "ru-RU"},
    {"code": "zh", "name": "Chinese (Simplified)", "speech": "zh-CN", "api": "zh-CN"},
    {"code": "ja", "name": "Japanese", "speech": "ja-JP"},
    {"code": "ko", "name": "Korean", "speech": "ko-KR"},
    {"code": "id", "name": "Indonesian", "speech": "id-ID"},
    {"code": "th", "name": "Thai", "speech": "th-TH"},
    {"code": "vi", "name": "Vietnamese", "speech": "vi-VN"},
]

BY_CODE = {lang["code"]: lang for lang in LANGUAGES}


def api_code(code: str) -> str:
    """Code to send to the translation API for a UI language code."""
    return BY_CODE[code].get("api", code)
