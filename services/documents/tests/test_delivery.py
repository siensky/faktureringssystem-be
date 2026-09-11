"""Rangordningen kommer från packages/contracts/schemas/delivery-status-
rank.json — SAMMA fil TS-sidan (services/billing/src/deliveries/
repository.ts) läser — så det här testet bevisar samtidigt att
läsvägen/parsningen fungerar, inte bara att en lokal konstant råkar vara
sorterad rätt."""

import itertools

import pytest

from documents.delivery import (
    delivery_rank,
    delivery_status_order,
    is_progress,
    map_webhook_status,
)


def test_rankningen_ar_strikt_stigande_i_den_delade_ordningen():
    for lower, higher in itertools.pairwise(delivery_status_order()):
        assert delivery_rank(higher) > delivery_rank(lower)


def test_delivered_ar_inte_ett_framsteg_fran_bounced():
    # domain.md #29 — en försenad 'delivered' får aldrig återuppliva en
    # död adress.
    assert is_progress("bounced", "delivered") is False
    assert is_progress("delivered", "bounced") is True


def test_failed_ar_inte_ett_framsteg_fran_delivered_eller_bounced():
    # Ett bekräftat mottaget mejl (delivered) eller en bekräftad studs
    # (bounced) är TERMINALA — ett ur ordning levererat 'failed'-event får
    # inte nedgradera någotdera (PR-granskning fas 4, punkt 9).
    assert is_progress("delivered", "failed") is False
    assert is_progress("bounced", "failed") is False


def test_failed_kan_foljas_av_ett_senare_mer_auktoritativt_utfall():
    assert is_progress("failed", "delivered") is True
    assert is_progress("failed", "bounced") is True


def test_sent_kan_inte_nedgradera_delivered():
    assert is_progress("delivered", "sent") is False


def test_samma_status_ar_inte_ett_framsteg():
    for status in delivery_status_order():
        assert is_progress(status, status) is False


def test_okand_status_kastar():
    with pytest.raises(ValueError, match="okänd delivery_status"):
        delivery_rank("opened")


@pytest.mark.parametrize(
    ("provider_status", "expected"),
    [("delivered", "delivered"), ("bounced", "bounced"), ("failed", "failed")],
)
def test_webhook_status_mappas(provider_status: str, expected: str):
    assert map_webhook_status(provider_status) == expected


def test_okand_webhook_status_kastar():
    with pytest.raises(ValueError, match="okänd webhook-status"):
        map_webhook_status("clicked")
