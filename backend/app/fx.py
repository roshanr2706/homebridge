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
}
SUPPORTED = {"MYR", "CAD", "USD"}


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
            raise ValueError("Supported currencies are MYR, CAD and USD")
        if amount <= 0:
            raise ValueError("Amount must be positive")
        qs = [self.quote(src, dst, amount, p) for p in PROVIDERS if include_wallet or not p.own_wallet_only]
        qs.sort(key=lambda q: -q["you_receive"])
        return qs

    def cached_quotes(self, src: str, dst: str, amount: float) -> List[Dict]:
        """Fallback used after a timeout: same maths, flagged as cached."""
        qs = [self.quote(src, dst, amount, p) for p in PROVIDERS]
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

    @staticmethod
    def provider(key: str) -> Optional[Provider]:
        return next((p for p in PROVIDERS if p.key == key), None)
