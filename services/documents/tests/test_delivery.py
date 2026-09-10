import itertools

import pytest

from documents.delivery import (
    DELIVERY_RANK,
    delivery_rank,
    is_progress,
    map_webhook_status,
)

_ORDER = ["none", "queued", "sent", "delivered", "failed", "bounced"]


def test_rankningen_ar_strikt_stigande_i_livscykelordning():
    for lower, higher in itertools.pairwise(_ORDER):
        assert delivery_rank(higher) > delivery_rank(lower)


def test_delivered_ar_inte_ett_framsteg_fran_bounced():
    # domain.md #29 — en försenad 'delivered' får aldrig återuppliva en
    # död adress.
    assert is_progress("bounced", "delivered") is False
    assert is_progress("delivered", "bounced") is True


def test_sent_kan_inte_nedgradera_delivered():
    assert is_progress("delivered", "sent") is False


def test_samma_status_ar_inte_ett_framsteg():
    for status in DELIVERY_RANK:
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
