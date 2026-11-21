"""Adds what the speech plugin needs to the generated Android manifest.

Run from the repo root after `npx cap add android`:
  python3 scripts/patch-android-manifest.py
"""
import pathlib
import sys

path = pathlib.Path("android/app/src/main/AndroidManifest.xml")
text = path.read_text(encoding="utf-8")

if "android.permission.RECORD_AUDIO" not in text:
    text = text.replace(
        "</manifest>",
        '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n</manifest>',
    )

# Android 11+ only lets the app find the speech recogniser if it declares this query.
if "android.speech.RecognitionService" not in text:
    text = text.replace(
        "</manifest>",
        '    <queries>\n        <intent>\n            <action android:name="android.speech.RecognitionService" />\n        </intent>\n    </queries>\n</manifest>',
    )

if "RECORD_AUDIO" not in text or "RecognitionService" not in text:
    sys.exit("could not patch AndroidManifest.xml")
path.write_text(text, encoding="utf-8")
print("patched", path)
