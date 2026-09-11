"""assert_public_host och _is_public är ren logik (DNS-upplösning +
IP-klassificering) — ingen faktisk nätverkshämtning testas här. Schema-
filtreringen (https-only) och redirect-per-hop-kontrollen kommer från
weasyprint.urls.URLFetcher/_SsrfGuardHandler och kräver WeasyPrint
(pango/cairo), så de täcks av e2e-sviten i Docker i stället — se
render_pdf i rendering.py."""

import socket

import pytest

from documents.safe_fetch import UnsafeImageUrlError, _is_public, assert_public_host


def test_publik_adress_godkanns():
    # 8.8.8.8 (Google DNS) är en stabil, känd publik adress. Ingen
    # nätverkshämtning görs här — bara DNS-upplösningen.
    assert_public_host("dns.google")


def test_okant_vardnamn_avvisas(monkeypatch: pytest.MonkeyPatch):
    def fail(*_args, **_kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(socket, "getaddrinfo", fail)
    with pytest.raises(UnsafeImageUrlError, match="kunde inte slå upp"):
        assert_public_host("does-not-resolve.invalid")


@pytest.mark.parametrize(
    ("hostname", "ip"),
    [
        ("metadata.internal", "169.254.169.254"),  # molnmetadata
        ("localhost.internal", "127.0.0.1"),
        ("private.internal", "10.0.0.1"),
        ("private.internal", "192.168.1.1"),
        ("link-local.internal", "fe80::1"),
        ("loopback6.internal", "::1"),
        ("cgnat.internal", "100.64.0.1"),  # varken privat eller globalt
    ],
)
def test_icke_publika_adresser_avvisas(monkeypatch: pytest.MonkeyPatch, hostname: str, ip: str):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(None, None, None, "", (ip, 0))],
    )
    with pytest.raises(UnsafeImageUrlError, match="icke-publik"):
        assert_public_host(hostname)


def test_en_av_flera_upplosta_adresser_ar_privat_racker_for_avslag(
    monkeypatch: pytest.MonkeyPatch,
):
    # DNS-rebinding-liknande fall: en host som slår upp till BÅDE en
    # publik och en privat adress. Alla måste vara publika.
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [
            (None, None, None, "", ("8.8.8.8", 0)),
            (None, None, None, "", ("127.0.0.1", 0)),
        ],
    )
    with pytest.raises(UnsafeImageUrlError, match="icke-publik"):
        assert_public_host("mixed.internal")


def test_is_public_pa_kanda_adresser():
    import ipaddress

    assert _is_public(ipaddress.ip_address("8.8.8.8")) is True
    assert _is_public(ipaddress.ip_address("169.254.169.254")) is False
    assert _is_public(ipaddress.ip_address("100.64.0.1")) is False
