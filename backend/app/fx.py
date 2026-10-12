"""Simulated FX market.

Mid-market rates come from a fixed snapshot so the demo works offline and
from mainland China. Each provider is modelled by its spread against mid and
its fee, so we can show the *true* cost of a transfer, which is the number
students rarely see.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional

# Units of quote currency per 1 unit of base currency (snapshot, illustrative).
MID: Dict[str, float] = {
    "MYR/CAD": 0.3236,
    "CAD/MYR": 1 / 0.3236,
    "MYR/USD": 0.2370,
    "USD/MYR": 1 / 0.2370,
    "CAD/USD": 0.7324,
    "USD/CAD": 1 / 0.7324,
    # Chinese yuan, for a family sending from mainland China (read-only comparisons: there is no CNY wallet).
    # Cross rates are derived from CNY/MYR so the snapshot stays consistent.
    "CNY/MYR": 0.5940,
    "MYR/CNY": 1 / 0.5940,
    "CNY/CAD": 0.5940 * 0.3236,
    "CAD/CNY": 1 / (0.5940 * 0.3236),
    "CNY/USD": 0.5940 * 0.2370,
    "USD/CNY": 1 / (0.5940 * 0.2370),
}
SUPPORTED = {"MYR", "CAD", "USD", "CNY"}
# Currencies with a wallet in the sandbox; the others can be quoted and compared, not held or converted.
WALLET_CURRENCIES = {"MYR", "CAD"}


class FxUnavailable(Exception):
    pass


@dataclass
class Provider:
    key: str
    name: str
    spread_pct: float      # margin hidden inside the exchange rate
    fee_pct: float         # visible percentage fee, charged in source currency
    fee_fixed: float       # visible fixed fee, in source currency
    speed: str
    own_wallet_only: bool = False


PROVIDERS: List[Provider] = [
    Provider("inapp", "HomeBridge wallet conversion", 0.60, 0.0, 0.0, "instant", own_wallet_only=True),
    Provider("lowcost", "Low-cost transfer service", 0.45, 0.55, 4.0, "1 business day"),
    Provider("bank", "Bank telegraphic transfer", 2.80, 0.0, 80.0, "2 to 4 business days"),
    Provider("kiosk", "Airport money changer", 6.50, 0.0, 0.0, "in person"),
]


# Ways to send money out of mainland China (yuan), modelled the same way: spread inside the rate plus a fee in
# CNY. Generic names, like the MYR set. The same engine compares them, so the currency is data, not code.
CNY_PROVIDERS: List[Provider] = [
    Provider("cn_app", "Licensed cross-border payment service", 0.50, 0.0, 30.0, "1 to 2 business days"),
    Provider("cn_bank", "Bank telegraphic transfer (SWIFT)", 1.20, 0.0, 150.0, "2 to 4 business days"),
    Provider("cn_counter", "Cash exchange counter", 4.00, 0.0, 0.0, "in person"),
]
CNY_NOTE = ("Sending from mainland China: each person can buy up to the equivalent of USD 50,000 in foreign currency "
            "a year under the SAFE annual quota; tuition can also be paid through a bank with the admission letter "
            "and fee invoice. Check the current rules with the bank.")


def providers_for(src: str) -> List[Provider]:
    """The comparison set for money leaving `src`."""
    return CNY_PROVIDERS if src.upper() == "CNY" else PROVIDERS


# Services a parent can use to send money from a Malaysian bank account (remit.py). The in-app conversion
# moves only the student's own money, and an airport changer is cash in person, so neither is offered.
# The express service is remittance-only, so it is kept out of PROVIDERS and the student's FX comparisons.
EXPRESS = Provider("express", "Express remittance service", 1.50, 0.0, 12.0, "same day")
DOMESTIC: List[Provider] = [
    Provider("duitnow", "Instant domestic transfer", 0.0, 0.0, 0.0, "instant"),
    Provider("ibg", "Interbank GIRO transfer", 0.0, 0.0, 0.10, "same day"),
]


def remit_providers(dst: str) -> List[Provider]:
    """The services that can deliver money from the sponsor's MYR account in `dst`."""
    if dst.upper() == "MYR":
        return list(DOMESTIC)
    by_key = {p.key: p for p in PROVIDERS}
    return [by_key["lowcost"], EXPRESS, by_key["bank"]]


class FxMarket:
    def __init__(self) -> None:
        self.fail_next = 0  # test hook: number of upcoming quote calls that time out

    def mid(self, src: str, dst: str) -> float:
        src, dst = src.upper(), dst.upper()
        if src == dst:
            return 1.0
        key = f"{src}/{dst}"
        if key not in MID:
            raise ValueError(f"Unsupported currency pair {key}")
        return MID[key]

    def quote(self, src: str, dst: str, amount: float, provider: Provider) -> Dict:
        mid = self.mid(src, dst)
        fee = round(amount * provider.fee_pct / 100 + provider.fee_fixed, 2)
        rate = mid * (1 - provider.spread_pct / 100)
        receive = max(0.0, (amount - fee) * rate)
        ideal = amount * mid
        cost_dst = ideal - receive
        return {
            "provider": provider.name,
            "provider_key": provider.key,
            "rate": round(rate, 5),
            "mid_rate": round(mid, 5),
            "fee": fee,
            "fee_currency": src.upper(),
            "you_receive": round(receive, 2),
            "receive_currency": dst.upper(),
            "true_cost": round(cost_dst, 2),
            "true_cost_pct": round(100 * cost_dst / ideal, 2) if ideal else 0.0,
            "speed": provider.speed,
            "own_wallet_only": provider.own_wallet_only,
        }

    def quotes(self, src: str, dst: str, amount: float, include_wallet: bool = True) -> List[Dict]:
        if self.fail_next > 0:
            self.fail_next -= 1
            raise FxUnavailable("Quote service timed out")
        if src.upper() not in SUPPORTED or dst.upper() not in SUPPORTED:
            raise ValueError("Supported currencies are MYR, CAD, USD and CNY")
        if amount <= 0:
            raise ValueError("Amount must be positive")
        # The in-app conversion only moves money between the user's own wallets (MYR and CAD)
        wallet = include_wallet and {src.upper(), dst.upper()} <= WALLET_CURRENCIES
        qs = [self.quote(src, dst, amount, p) for p in providers_for(src) if wallet or not p.own_wallet_only]
        qs.sort(key=lambda q: -q["you_receive"])
        return qs

    def cached_quotes(self, src: str, dst: str, amount: float) -> List[Dict]:
        """Fallback used after a timeout: same maths, flagged as cached."""
        qs = [self.quote(src, dst, amount, p) for p in providers_for(src)]
        for q in qs:
            q["cached"] = True
        qs.sort(key=lambda q: -q["you_receive"])
        return qs

    def history(self, src: str, dst: str, days: int = 30) -> Dict:
        """Deterministic synthetic 30-day history around the snapshot mid rate."""
        mid = self.mid(src, dst)
        series = [round(mid * (1 + 0.012 * math.sin(i / 4.0) + 0.004 * math.cos(i / 1.7)), 5)
                  for i in range(days)]
        return {
            "pair": f"{src.upper()}/{dst.upper()}",
            "today": series[-1],
            "low": min(series),
            "high": max(series),
            "average": round(sum(series) / len(series), 5),
            "days": days,
            "series": series,
        }

    def quote_to_receive(self, dst: str, receive: float, provider: Provider) -> Dict:
        """What the sponsor sends from MYR so that at least `receive` arrives in `dst` through `provider`:
        the true-cost maths of quote() run backwards. Cross-border amounts are rounded up to a whole ringgit,
        so the student gets slightly more than asked, never less; a domestic transfer is exact to the sen."""
        dst = dst.upper()
        if dst == "MYR":
            send = round((receive + provider.fee_fixed) / (1 - provider.fee_pct / 100), 2)
        else:
            rate = self.mid("MYR", dst) * (1 - provider.spread_pct / 100)
            send = float(math.ceil((receive / rate + provider.fee_fixed) / (1 - provider.fee_pct / 100)))
        q = self.quote("MYR", dst, send, provider)
        q["send_amount"] = send
        q["spread_pct"] = provider.spread_pct
        return q

    @staticmethod
    def provider(key: str) -> Optional[Provider]:
        return next((p for p in PROVIDERS + [EXPRESS] + DOMESTIC + CNY_PROVIDERS if p.key == key), None)
