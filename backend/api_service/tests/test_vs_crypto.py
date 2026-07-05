"""Credential encryption round-trip (secrets never stored/returned in plaintext)."""
import os
import importlib

import pytest


def _crypto():
    import utils.crypto as c
    return importlib.reload(c)


def test_encrypt_decrypt_roundtrip(monkeypatch):
    monkeypatch.setenv("VS_CRED_KEY", "a-test-passphrase-for-vs-creds")
    crypto = _crypto()
    secret = "s3cr3t-password!"
    ct = crypto.encrypt_secret(secret)
    assert isinstance(ct, (bytes, bytearray))
    assert secret.encode() not in ct                 # ciphertext does not contain the plaintext
    assert crypto.decrypt_secret(ct) == secret        # round-trips


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("VS_CRED_KEY", raising=False)
    crypto = _crypto()
    with pytest.raises(RuntimeError):
        crypto.encrypt_secret("x")


def test_accepts_real_fernet_key(monkeypatch):
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("VS_CRED_KEY", key)
    crypto = _crypto()
    assert crypto.decrypt_secret(crypto.encrypt_secret("hello")) == "hello"
