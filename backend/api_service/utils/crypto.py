"""
Symmetric envelope encryption for secrets at rest (VS authenticated-scan
credentials). Fernet (AES-128-CBC + HMAC) with a key from the environment /
secrets manager — NEVER hardcoded, NEVER logged.

The key comes from VS_CRED_KEY: either a proper urlsafe-base64 32-byte Fernet
key, or any passphrase (derived to a key via SHA-256). Rotate by changing the
env value; re-encrypt existing rows out-of-band.
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet


def _key() -> bytes:
    raw = os.getenv("VS_CRED_KEY")
    if not raw:
        raise RuntimeError("VS_CRED_KEY is not configured — cannot encrypt/decrypt credentials")
    try:
        Fernet(raw.encode())          # already a valid Fernet key
        return raw.encode()
    except Exception:
        # Derive a stable 32-byte urlsafe key from an arbitrary passphrase.
        return base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())


def encrypt_secret(plaintext: str) -> bytes:
    """Return ciphertext for storage. Plaintext never persisted or logged."""
    return Fernet(_key()).encrypt((plaintext or "").encode())


def decrypt_secret(ciphertext: bytes) -> str:
    """Decrypt just-in-time (e.g. to hand a credential to a scan). Caller must
    not persist or log the result."""
    return Fernet(_key()).decrypt(bytes(ciphertext)).decode()
