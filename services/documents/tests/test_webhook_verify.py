"""Rena skydd på webhooken: signatur över rå body, tidsfönster, och vilka
statusar som får övergå till ett givet mål (monotonicitet)."""

import hashlib
import hmac
import time

from documents.webhooks import _lower_ranked_statuses, timestamp_fresh, verify_signature

_SECRET = "webhook-hemlighet"


def _sign(timestamp: str, body: bytes) -> str:
    return hmac.new(_SECRET.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def test_giltig_signatur_over_ra_body_godkanns():
    ts = str(int(time.time()))
    body = b'{"id":"evt_1","messageId":"<a@b>","status":"delivered"}'
    assert verify_signature(secret=_SECRET, timestamp=ts, raw_body=body, signature=_sign(ts, body))


def test_manipulerad_body_ger_ogiltig_signatur():
    ts = str(int(time.time()))
    body = b'{"id":"evt_1","status":"delivered"}'
    sig = _sign(ts, body)
    tampered = body.replace(b"delivered", b"bounced")
    assert not verify_signature(secret=_SECRET, timestamp=ts, raw_body=tampered, signature=sig)


def test_utbytt_tidsstampel_ger_ogiltig_signatur():
    body = b"{}"
    sig = _sign("1000", body)
    assert not verify_signature(secret=_SECRET, timestamp="2000", raw_body=body, signature=sig)


def test_saknad_signatur_ar_inte_giltig():
    assert not verify_signature(secret=_SECRET, timestamp="1", raw_body=b"{}", signature="")


def test_icke_ascii_signatur_ger_401_inte_500():
    # Starlette avkodar headers som latin-1 — X-Signature kan alltså bära
    # tecken utanför ASCII. hmac.compare_digest(str, str) KASTAR TypeError
    # på det i stället för att bara returnera False, vilket utan fix skulle
    # bli ett 500 på en publik endpoint (PR-granskning fas 4, punkt 22).
    assert not verify_signature(
        secret=_SECRET, timestamp="1", raw_body=b"{}", signature="\xff\xff\xff"
    )


def test_tidsstampel_inom_fonstret():
    now = 1_000_000.0
    assert timestamp_fresh(str(int(now)), now=now, tolerance=300)
    assert timestamp_fresh(str(int(now - 299)), now=now, tolerance=300)


def test_gammal_tidsstampel_avvisas():
    now = 1_000_000.0
    assert not timestamp_fresh(str(int(now - 3600)), now=now, tolerance=300)


def test_ickenumerisk_tidsstampel_avvisas():
    assert not timestamp_fresh("igår", now=time.time())


def test_lagre_rankade_statusar_for_delivered():
    # delivered får nås från queued/sent/failed — men INTE från bounced
    # (det andra terminala utfallet), och inte från sig självt.
    assert set(_lower_ranked_statuses("delivered")) == {"queued", "sent", "failed"}


def test_lagre_rankade_statusar_for_bounced():
    # bounced (det mest auktoritativa utfallet) får nås från allt lägre,
    # inklusive delivered (domain.md #29: en sen, korrigerande hård studs
    # vinner ändå) — men aldrig från sig självt.
    assert set(_lower_ranked_statuses("bounced")) == {"queued", "sent", "delivered", "failed"}
