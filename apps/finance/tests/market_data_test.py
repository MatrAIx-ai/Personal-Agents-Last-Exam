"""Offline provider-contract and visibility checks. No network calls."""
import copy
import hashlib
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from market_data import collect, price, yahoo_records, alphavantage_records

NOW = datetime.fromisoformat("2026-12-01T21:00:00+00:00")


def payload(symbol="IBM"):
    return {"chart": {"result": [{"meta": {"symbol": symbol, "currency": "USD", "regularMarketPrice": 233.456,
                                         "regularMarketTime": int((NOW - timedelta(minutes=1)).timestamp()), "longName": "Example issuer"},
        "timestamp": [int(datetime.fromisoformat("2026-11-30T14:30:00+00:00").timestamp())],
        "indicators": {"quote": [{"open": [231.125], "high": [235.5], "low": [230.0], "close": [233.456], "volume": [1234]}]}}]}}


class MarketDataTests(unittest.TestCase):
    def test_large_watchlist_keeps_history_coverage_and_splits_transport_batches(self):
        symbols = ["S" + str(i) for i in range(32)]
        def request(url):
            symbol = unquote(urlparse(url).path.rsplit("/", 1)[-1])
            interval = parse_qs(urlparse(url).query)["interval"][0]
            data = payload(symbol)
            result = data["chart"]["result"][0]
            if interval == "1d":
                stamps = [NOW - timedelta(days=120-i, hours=6) for i in range(120)]
            else:
                stamps = [datetime.fromisoformat("2026-11-23T14:30:00+00:00") + timedelta(days=day, minutes=15*i) for day in range(5) for i in range(26)][-120:]
            result["timestamp"] = [int(t.timestamp()) for t in stamps]
            result["indicators"]["quote"][0] = {k: [v[0]] * len(stamps) for k, v in result["indicators"]["quote"][0].items()}
            return json.dumps(data).encode()
        result = collect(symbols, request=request, clock=lambda: NOW)
        frames = [result] + result["continuations"]
        history = [bar for frame in frames for bar in frame["snapshot"]["history"]]
        self.assertEqual(len(history), 32 * 120 * 2)
        self.assertEqual(len({bar["id"] for bar in history}), len(history))
        for symbol in symbols:
            for interval in ("1d", "15m"):
                self.assertEqual(sum(bar["instrument_id"] == symbol and bar["interval"] == interval for bar in history), 120)
        self.assertTrue(all(len(frame["snapshot"]["history"]) <= 1440 for frame in frames))
        times = [int(datetime.fromisoformat(frame["snapshot"]["checked_at"]).timestamp() * 1000) for frame in frames]
        self.assertEqual(times, sorted(set(times)))

    def test_prices_keep_source_precision_and_use_explicit_cent_rounding(self):
        self.assertEqual(price("233.455"), ("233.455", 23346))
        for value in ("NaN", "Infinity", "0", "-1", "0.0001", True):
            with self.assertRaises(ValueError):
                price(value)

    def test_yahoo_preserves_actual_time_source_hash_and_ohlcv(self):
        body = json.dumps(payload()).encode()
        result = yahoo_records(json.loads(body), "IBM", "1d", NOW, "https://example.test/data", hashlib.sha256(body).hexdigest())
        q, bar = result["quotes"][0], result["history"][0]
        self.assertEqual(q["price_cents"], 23346)
        self.assertEqual(q["raw_price"], "233.456")
        self.assertEqual(q["as_of"], "2026-12-01T20:59:00+00:00")
        self.assertEqual(q["collected_at"], NOW.isoformat())
        self.assertEqual(q["raw_sha256"], hashlib.sha256(body).hexdigest())
        self.assertIsNone(q["delay_seconds"])
        self.assertEqual(bar["volume"], 1234)
        self.assertEqual(bar["open_price"], "231.125")

    def test_wrong_currency_or_symbol_is_rejected_and_future_bars_are_hidden(self):
        data = payload()
        data["chart"]["result"][0]["meta"]["currency"] = "EUR"
        with self.assertRaises(ValueError):
            yahoo_records(data, "IBM", "1d", NOW, "url", "a" * 64)
        data = payload()
        data["chart"]["result"][0]["timestamp"] = [int((NOW + timedelta(days=1)).timestamp())]
        self.assertEqual(yahoo_records(data, "IBM", "1d", NOW, "url", "a" * 64)["history"], [])

    def test_collection_retains_partial_failures_without_synthetic_fallback(self):
        def request(url):
            symbol = unquote(urlparse(url).path.rsplit("/", 1)[-1])
            if symbol == "QQQ":
                raise HTTPError(url, 429, "quota", None, None)
            return json.dumps(payload(symbol)).encode()
        result = collect(["IBM", "QQQ"], request=request, clock=lambda: NOW)
        self.assertEqual(result["snapshot"]["status"], "degraded")
        self.assertEqual([q["instrument_id"] for q in result["snapshot"]["quotes"]], ["IBM"])
        self.assertEqual(len(result["snapshot"]["errors"]), 2)
        failed = collect(["QQQ"], request=request, clock=lambda: NOW)
        self.assertEqual(failed["snapshot"]["status"], "unavailable")
        self.assertEqual(failed["snapshot"]["quotes"], [])
        self.assertEqual(failed["snapshot"]["history"], [])

    def test_old_real_quote_is_readable_but_expired_not_relabelled_fresh(self):
        data = payload()
        data["chart"]["result"][0]["meta"]["regularMarketTime"] = int((NOW - timedelta(days=10)).timestamp())
        result = yahoo_records(data, "IBM", "1d", NOW, "url", "a" * 64)
        self.assertLess(datetime.fromisoformat(result["quotes"][0]["valid_until"]), NOW)
        self.assertEqual(result["quotes"][0]["as_of"], (NOW - timedelta(days=10)).isoformat())

    def test_intraday_records_use_real_buckets_and_keep_intervals_distinct(self):
        data = payload()
        data["chart"]["result"][0]["timestamp"] = [int(datetime.fromisoformat("2026-12-01T14:45:00+00:00").timestamp())]
        result = yahoo_records(data, "IBM", "15m", NOW, "url", "a" * 64)
        self.assertEqual(result["history"][0]["bar_start_at"], "2026-12-01T14:45:00+00:00")
        self.assertEqual(result["history"][0]["as_of"], "2026-12-01T15:00:00+00:00")
        self.assertEqual(result["history"][0]["interval"], "15m")

    def test_official_daily_demo_retains_daily_reference_identity(self):
        data = {"Meta Data": {"2. Symbol": "IBM"}, "Time Series (Daily)": {"2026-11-30": {
            "1. open": "230.0", "2. high": "235.0", "3. low": "229.0", "4. close": "233.4560", "5. volume": "10000"}}}
        result = alphavantage_records(data, "IBM", NOW, "https://www.alphavantage.co/query", "b" * 64)
        self.assertEqual(result["quotes"][0]["price_kind"], "daily_reference")
        self.assertEqual(result["quotes"][0]["raw_price"], "233.4560")
        self.assertEqual(result["quotes"][0]["provider"], "alphavantage_demo")


if __name__ == "__main__":
    unittest.main()
