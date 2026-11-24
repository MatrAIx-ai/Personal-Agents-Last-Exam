"""Read-only market collection. Run outside Core; never access account state."""
import argparse
import concurrent.futures
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from pathlib import Path


def iso(value):
    return value.astimezone(timezone.utc).isoformat()


def hash_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def price(value):
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number <= 0:
            raise ValueError("Invalid provider price")
        cents = int((number * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if not 1 <= cents <= 9_000_000_000_000:
            raise ValueError("Provider price is outside the supported cent range")
        return str(number), cents
    except (InvalidOperation, TypeError) as error:
        raise ValueError("Invalid provider price") from error


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc)


def yahoo_records(payload, symbol, interval, collected_at, source_url, raw_sha256, ttl=300, max_age=345600):
    result = (payload.get("chart", {}).get("result") or [])
    if len(result) != 1:
        raise ValueError("Provider returned no chart data")
    result = result[0]
    meta = result["meta"]
    if meta.get("symbol", "").upper() != symbol or meta.get("currency") != "USD":
        raise ValueError("Provider returned a different symbol or currency")
    values = result["indicators"]["quote"][0]
    bars = {}
    provenance = {"provider": "yahoo_chart", "source_url": source_url, "collected_at": iso(collected_at),
                  "raw_sha256": raw_sha256, "delay_seconds": None}
    for index, timestamp in enumerate(result.get("timestamp", [])):
        start = stamp(timestamp)
        if start > collected_at:
            continue
        local = start.astimezone(ZoneInfo("America/New_York"))
        if interval == "15m":
            start = stamp(int(timestamp) // 900 * 900)
            if local.weekday() >= 5 or not 570 <= local.hour * 60 + local.minute < 960:
                continue
            end = start + timedelta(minutes=15)
        else:
            end = datetime.combine(local.date(), datetime.min.time(), ZoneInfo("America/New_York")).replace(hour=16).astimezone(timezone.utc)
        try:
            raw = {key: price(values[key][index])[0] for key in ("open", "high", "low", "close")}
            raw_price, cents = price(raw["close"])
        except (ValueError, IndexError, KeyError):
            continue
        as_of = min(end, collected_at)
        row = {"instrument_id": symbol, "price_cents": cents, "raw_price": raw_price,
               "as_of": iso(as_of), "available_at": iso(collected_at), "bar_start_at": iso(start),
               "interval": interval, "price_kind": "daily_reference" if interval == "1d" else "intraday_reference",
               "bar_complete": end <= collected_at, **provenance,
               **{key + "_price": value for key, value in raw.items()}}
        volume = values.get("volume", [])[index] if index < len(values.get("volume", [])) else None
        row["volume"] = volume if type(volume) is int and volume >= 0 else None
        # The provider can return two updates for the same intraday bucket.
        prior = bars.get(iso(start))
        if prior and interval == "15m":
            row["open_price"] = prior["open_price"]
            row["high_price"] = str(max(Decimal(prior["high_price"]), Decimal(row["high_price"])))
            row["low_price"] = str(min(Decimal(prior["low_price"]), Decimal(row["low_price"])))
            row["volume"] = max(prior["volume"] or 0, row["volume"] or 0)
        identity = {k: v for k, v in row.items() if k not in ("available_at", "collected_at", "raw_sha256", "source_url")}
        row["id"] = "bar-" + hash_json(identity)[:48]
        bars[iso(start)] = row
    quote_row = None
    if meta.get("regularMarketPrice") is not None and meta.get("regularMarketTime") is not None:
        as_of = stamp(meta["regularMarketTime"])
        if as_of <= collected_at:
            raw_price, cents = price(meta["regularMarketPrice"])
            quote_row = {"instrument_id": symbol, "price_cents": cents, "raw_price": raw_price,
                         "as_of": iso(as_of), "available_at": iso(collected_at),
                         "valid_until": iso(min(collected_at + timedelta(seconds=ttl), as_of + timedelta(seconds=max_age))),
                         "price_kind": "last_trade", "interval": "quote", **provenance}
            quote_row["id"] = "quote-" + hash_json(quote_row)[:48]
    return {"instrument": {"id": symbol, "ticker": symbol, "name": meta.get("longName") or meta.get("shortName") or symbol},
            "quotes": [quote_row] if quote_row else [], "history": sorted(bars.values(), key=lambda r: r["bar_start_at"])[-120:]}


def alphavantage_records(payload, symbol, collected_at, source_url, raw_sha256, ttl=300, max_age=345600):
    metadata = payload.get("Meta Data", {})
    series = payload.get("Time Series (Daily)", {})
    if metadata.get("2. Symbol") != symbol or not series:
        raise ValueError("Provider returned no daily observations for the requested symbol")
    rows = []
    for day, values in sorted(series.items()):
        end = datetime.fromisoformat(day + "T16:00:00").replace(tzinfo=ZoneInfo("America/New_York"))
        if end > collected_at:
            continue
        raw_price, cents = price(values["4. close"])
        row = {"instrument_id": symbol, "price_cents": cents, "raw_price": raw_price, "as_of": iso(end),
               "available_at": iso(collected_at), "collected_at": iso(collected_at), "bar_start_at": iso(end),
               "provider": "alphavantage_demo", "source_url": source_url, "raw_sha256": raw_sha256,
               "interval": "1d", "price_kind": "daily_reference", "delay_seconds": None, "bar_complete": True,
               "open_price": price(values["1. open"])[0], "high_price": price(values["2. high"])[0],
               "low_price": price(values["3. low"])[0], "close_price": raw_price, "volume": int(values["5. volume"])}
        row["id"] = "bar-" + hash_json({k: v for k, v in row.items() if k not in ("available_at", "collected_at", "raw_sha256", "source_url")})[:48]
        rows.append(row)
    if not rows:
        raise ValueError("No completed daily observations are available")
    last = rows[-1]
    observed = {k: last[k] for k in ("instrument_id", "price_cents", "raw_price", "as_of", "available_at", "collected_at", "provider", "source_url", "raw_sha256", "delay_seconds", "price_kind", "interval")}
    observed["valid_until"] = iso(min(collected_at + timedelta(seconds=ttl), datetime.fromisoformat(last["as_of"]) + timedelta(seconds=max_age)))
    observed["id"] = "quote-" + hash_json(observed)[:48]
    return {"instrument": {"id": symbol, "ticker": symbol, "name": symbol}, "quotes": [observed], "history": rows[-120:]}


def fetch(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 PALE-Finance/0.1", "Accept": "application/json"})
    with urlopen(request, timeout=12) as response:
        body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise ValueError("Provider response exceeds the capture limit")
        return body


def collect(symbols, provider="yahoo_chart", request=fetch, clock=lambda: datetime.now(timezone.utc)):
    if not 1 <= len(symbols) <= 64 or len(set(symbols)) != len(symbols) or not all(re.fullmatch(r"[A-Z][A-Z0-9.^=-]{0,14}", s) for s in symbols):
        raise ValueError("Choose one to sixty-four distinct supported ticker symbols")
    if provider not in ("yahoo_chart", "alphavantage_demo"):
        raise ValueError("Unsupported provider")
    if provider == "alphavantage_demo" and symbols != ["IBM"]:
        raise ValueError("The public Alpha Vantage demo is configured for IBM only")

    def get(symbol, interval):
        url = ("https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol, safe="") + "?" +
               urlencode({"range": "6mo" if interval == "1d" else "5d", "interval": interval, "includePrePost": "false"})) if provider == "yahoo_chart" else \
              "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=IBM&apikey=demo"
        try:
            body = request(url)
            collected_at = clock()
            digest = hashlib.sha256(body).hexdigest()
            payload = json.loads(body)
            records = yahoo_records(payload, symbol, interval, collected_at, url, digest) if provider == "yahoo_chart" else alphavantage_records(payload, symbol, collected_at, url, digest)
            return {"records": records, "response": {"symbol": symbol, "interval": interval, "provider": provider, "url": url,
                    "collected_at": iso(collected_at), "sha256": digest, "body": body.decode("utf-8")}}
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError, TypeError, OSError) as error:
            message = "Provider returned HTTP " + str(error.code) if isinstance(error, HTTPError) else "Market observations unavailable (" + type(error).__name__ + ")"
            if isinstance(error, HTTPError):
                error.close()
            return {"error": {"instrument_id": symbol, "interval": interval, "message": message}}

    jobs = [(symbol, interval) for symbol in symbols for interval in (["1d", "15m"] if provider == "yahoo_chart" else ["1d"])]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    checked_at = clock()
    histories, observations, responses, errors, names = {}, {}, [], [], {}
    for result in results:
        if "error" in result:
            errors.append(result["error"])
            continue
        records = result["records"]
        names[records["instrument"]["id"]] = records["instrument"]
        for row in records["history"]:
            histories[row["id"]] = row
        for row in records["quotes"]:
            prior = observations.get(row["instrument_id"])
            if not prior or (row["as_of"], row["collected_at"]) > (prior["as_of"], prior["collected_at"]):
                observations[row["instrument_id"]] = row
        responses.append(result["response"])
    snapshot = {"provider": provider, "checked_at": iso(checked_at), "status": "degraded" if errors and observations else "ready" if observations else "unavailable",
                "instruments": [names.get(s, {"id": s, "ticker": s, "name": s}) for s in symbols], "quotes": sorted(observations.values(), key=lambda r: r["instrument_id"]),
                "history": sorted(histories.values(), key=lambda r: (r["instrument_id"], r["interval"], r["bar_start_at"])), "errors": errors}
    # Split transport batches, not the time coverage of each instrument.
    # Every stored bar remains an actual provider observation.
    history = snapshot["history"]
    frames = []
    for index, offset in enumerate(range(0, max(1, len(history)), 1440)):
        part = {**snapshot, "checked_at": iso(checked_at + timedelta(milliseconds=index)),
                "quotes": snapshot["quotes"] if index == 0 else [], "history": history[offset:offset + 1440]}
        part["id"] = "snapshot-" + hash_json(part)[:48]
        used = {row["raw_sha256"] for row in part["quotes"] + part["history"]}
        frames.append({"snapshot": part, "responses": [r for r in responses if r["sha256"] in used]})
    first = frames[0]
    if len(frames) > 1:
        first["continuations"] = frames[1:]
    return first


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", default=",".join(json.loads((Path(__file__).resolve().parents[1] / "market-watchlist.json").read_text())["symbols"]))
    parser.add_argument("--provider", choices=["yahoo_chart", "alphavantage_demo"], default="yahoo_chart")
    args = parser.parse_args()
    try:
        result = collect([s.strip().upper() for s in args.symbols.split(",")], args.provider)
        json.dump(result, sys.stdout, allow_nan=False, ensure_ascii=False)
        sys.stdout.write("\n")
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
