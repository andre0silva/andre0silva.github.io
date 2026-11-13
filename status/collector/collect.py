#!/usr/bin/env python3
"""Coletor do painel /status/.

Lê status/sources.json, baixa cada feed RSS/Atom público, normaliza os itens,
atualiza o histórico e grava um único status.json consumido pela página.

Uso: python3 collect.py --sources ../sources.json --previous status.json --out status.json
Somente biblioteca padrão (roda no runner do GitHub Actions sem instalar nada).
"""
import argparse
import hashlib
import html
import os
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

HISTORY_DAYS = 90
HISTORY_MAX = 300
DESC_MAX = 20000
UA = "andre0silva-status-collector/1.0 (+https://andre0silva.github.io/status/)"

SEV_ORDER = {"crit": 0, "warn": 1, "info": 2, "ok": 3}

STATUS_LABELS = {
    "serviceoperational": "Operacional",
    "servicedegradation": "Degradação",
    "serviceinterruption": "Interrupção",
    "investigating": "Investigando",
    "restoringservice": "Restaurando",
    "verifyingservice": "Verificando",
    "servicerestored": "Restaurado",
    "extendedrecovery": "Recuperação estendida",
    "postincidentreviewpublished": "PIR publicado",
    "falsepositive": "Falso positivo",
    "resolved": "Resolvido",
    "mitigated": "Mitigado",
}


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(re.sub(r"\s+Z$", " +0000", s))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        pass
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_iso(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
    except ValueError:
        return None


def clean_text(s):
    if not s:
        return ""
    t = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</div>", "\n", s)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    t = "\n".join(line.strip() for line in t.split("\n")).strip()
    return t[:DESC_MAX] + ("…" if len(t) > DESC_MAX else "")


def severity(status, text=""):
    s = (status or "").lower().replace(" ", "")
    blob = s + " " + (text or "").lower()
    if re.search(r"interruption|outage|interrup|major", s):
        return "crit"
    if re.search(r"degradation|investigating|restoring|extendedrecovery|verifying|confirmed|reported|degrad", s):
        return "warn"
    if re.search(r"operational|restored|resolved|mitigated|falsepositive|postincident", s):
        return "ok"
    # Sem campo de status: tenta pelo texto
    if re.search(r"outage|interrup|unavailable|indispon", blob):
        return "crit"
    if re.search(r"degrad|investigat|issue|incident|problem|impact", blob):
        return "warn"
    return "info"


def status_label(status):
    if not status:
        return ""
    return STATUS_LABELS.get(status.lower().replace(" ", ""), status)


def local(tag):
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def child_text(el, name):
    for c in el:
        if local(c.tag) == name:
            if name == "link" and c.get("href"):
                return c.get("href")
            return (c.text or "").strip() or "".join(c.itertext()).strip()
    return None


def fetch(url, attempts=3):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache",
                                                       "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - registra qualquer falha de rede
            last = e
            time.sleep(2 * (i + 1))
    raise last


def parse_feed(raw):
    root = ET.fromstring(raw)
    feed_updated = None
    items = []
    for el in root.iter():
        n = local(el.tag)
        if n in ("lastbuilddate", "updated") and feed_updated is None and local(root.tag) in ("rss", "feed", "rdf"):
            feed_updated = parse_date((el.text or "").strip())
        if n in ("item", "entry"):
            desc = child_text(el, "description") or child_text(el, "summary") or child_text(el, "content") or ""
            items.append({
                "guid": child_text(el, "guid") or child_text(el, "id") or "",
                "title": (child_text(el, "title") or "").strip(),
                "link": child_text(el, "link") or "",
                "status": child_text(el, "status") or "",
                "published": parse_date(child_text(el, "pubdate") or child_text(el, "published") or child_text(el, "updated")),
                "description": clean_text(desc),
            })
    return feed_updated, items


# ---------- Resumo executivo (formato dos comunicados do Microsoft 365) ----------
LABELS = {
    "title": r"title", "impact": r"user impact", "info": r"more info", "status": r"current status",
    "scope": r"scope of impact", "cause": r"(?:preliminary )?root cause", "start": r"start time",
    "end": r"end time", "next": r"next update(?: by)?",
}
LABEL_RE = re.compile(r"(?im)^\s*(" + "|".join(LABELS.values()) + r")\s*:\s*")
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july",
                                      "august", "september", "october", "november", "december"], 1)}


def parse_human_date(s):
    """'Friday, November 13, 2026, at 2:00 PM UTC' -> datetime UTC."""
    if not s:
        return None
    m = re.search(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4}),?\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(UTC|GMT)?", s, re.I)
    if not m or m.group(1).lower() not in MONTHS:
        return None
    h = int(m.group(4)) % 12 if m.group(6) else int(m.group(4))
    if m.group(6) and m.group(6).upper() == "PM":
        h += 12
    try:
        return datetime(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)), h, int(m.group(5)), tzinfo=timezone.utc)
    except ValueError:
        return None


def summarize(text):
    if not text:
        return None
    parts, pos, cur = {}, 0, None
    for m in LABEL_RE.finditer(text):
        if cur:
            parts[cur] = text[pos:m.start()].strip()
        label = m.group(1).lower()
        cur = next(k for k, v in LABELS.items() if re.fullmatch(v, label))
        pos = m.end()
    if cur:
        parts[cur] = text[pos:].strip()
    if not parts:
        return None
    affected = []
    for m in re.finditer(r"(?m)^\s*-\s*([^:\n]{2,80}):\s*(.+)$", parts.get("info", "") + "\n" + parts.get("impact", "")):
        affected.append({"service": m.group(1).strip(), "impact": m.group(2).strip()})
    intro = re.split(r"\n\s*-\s", parts.get("info", ""), maxsplit=1)[0].strip()
    status_first = re.split(r"\n\s*\n", parts.get("status", ""), maxsplit=1)[0].strip()
    nxt = parse_human_date(parts.get("next"))
    start = parse_human_date(parts.get("start"))
    return {
        "headline": parts.get("title") or "",
        "intro": intro,
        "impact": "" if affected and parts.get("impact", "").lstrip().startswith("-") else parts.get("impact", ""),
        "affected": affected,
        "currentStatus": status_first,
        "scope": parts.get("scope", ""),
        "rootCause": parts.get("cause", ""),
        "start": iso(start),
        "nextUpdate": iso(nxt),
        "nextUpdateRaw": parts.get("next", "")[:120],
    }


# ---------- Tradução opcional (Azure AI Translator, tier gratuito F0) ----------
class Translator:
    def __init__(self, cache):
        self.key = os.environ.get("TRANSLATOR_KEY", "").strip()
        self.region = os.environ.get("TRANSLATOR_REGION", "").strip()
        self.cache = dict(cache or {})
        self.used = {}
        self.error = None

    @staticmethod
    def h(t):
        return hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]

    def run(self, texts):
        texts = [t for t in dict.fromkeys(texts) if t and t.strip()]
        todo = [t for t in texts if self.h(t) not in self.cache]
        if todo and self.key:
            try:
                for i in range(0, len(todo), 50):
                    chunk = todo[i:i + 50]
                    body = json.dumps([{"Text": t} for t in chunk]).encode("utf-8")
                    headers = {"Ocp-Apim-Subscription-Key": self.key, "Content-Type": "application/json"}
                    if self.region:
                        headers["Ocp-Apim-Subscription-Region"] = self.region
                    req = urllib.request.Request(
                        "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=pt-br",
                        data=body, headers=headers, method="POST")
                    with urllib.request.urlopen(req, timeout=30) as r:
                        res = json.loads(r.read())
                    for t, out in zip(chunk, res):
                        self.cache[self.h(t)] = out["translations"][0]["text"]
            except Exception as e:  # noqa: BLE001
                self.error = f"{type(e).__name__}: {e}"[:200]
        for t in texts:
            if self.h(t) in self.cache:
                self.used[self.h(t)] = self.cache[self.h(t)]

    def get(self, t):
        return self.used.get(self.h(t)) if t else None


def translate_summaries(sources, tr):
    texts = []
    for s in sources:
        for a in s.get("active", []):
            sm = a.get("summary")
            if sm:
                texts += [sm["headline"], sm["intro"], sm["impact"], sm["currentStatus"], sm["scope"], sm["rootCause"]]
                texts += [x["impact"] for x in sm["affected"]]
    tr.run(texts)
    for s in sources:
        for a in s.get("active", []):
            sm = a.get("summary")
            if not sm:
                continue
            for k in ("headline", "intro", "impact", "currentStatus", "scope", "rootCause"):
                sm[k + "Pt"] = tr.get(sm[k])
            for x in sm["affected"]:
                x["impactPt"] = tr.get(x["impact"])


def collect_source(src, prev_src, checked):
    out = {
        "id": src["id"], "name": src["name"], "category": src.get("category", "Outros"),
        "link": src.get("link") or src["url"], "feed": src["url"], "mode": src.get("mode", "active"),
        "checkedAt": iso(checked),
    }
    try:
        feed_updated, items = parse_feed(fetch(src["url"]))
    except Exception as e:  # noqa: BLE001
        out.update({
            "ok": False, "error": f"{type(e).__name__}: {e}"[:300],
            "lastSuccess": (prev_src or {}).get("lastSuccess"),
            "feedUpdated": (prev_src or {}).get("feedUpdated"),
            "active": (prev_src or {}).get("active", []),
        })
        out["severity"] = worst([i["severity"] for i in out["active"]]) if out["active"] else "unknown"
        return out

    mode = out["mode"]
    hours = float(src.get("activeHours", 6))
    resolved_re = re.compile(src.get("resolvedRegex", r"(?i)\b(resolved|resolvido|restored|completed|mitigated)\b"))
    active = []
    for it in items:
        sev = severity(it["status"], it["title"] + " " + it["description"])
        if mode == "history":
            if not it["published"] or checked - it["published"] > timedelta(hours=hours):
                continue
            if resolved_re.search(it["title"] + " " + it["description"][:400]) or sev == "ok":
                continue
        key = it["guid"] or f'{it["title"]}|{iso(it["published"])}'
        active.append({
            "key": f'{src["id"]}:{key}', "guid": it["guid"], "title": it["title"] or src["name"],
            "link": it["link"] or out["link"], "status": it["status"], "statusLabel": status_label(it["status"]),
            "severity": sev, "published": iso(it["published"]), "description": it["description"],
            "summary": summarize(it["description"]),
        })
    active.sort(key=lambda a: (SEV_ORDER.get(a["severity"], 9), a["published"] or ""))
    out.update({
        "ok": True, "error": None, "lastSuccess": iso(checked), "feedUpdated": iso(feed_updated),
        "active": active, "severity": worst([a["severity"] for a in active]) if active else "ok",
    })
    return out


def worst(sevs):
    sevs = [s for s in sevs if s in SEV_ORDER]
    return min(sevs, key=lambda s: SEV_ORDER[s]) if sevs else "ok"


def update_history(prev_hist, sources, checked):
    hist = {h["key"]: h for h in prev_hist or [] if h.get("key")}
    seen = set()
    for s in sources:
        if not s["ok"]:
            # Fonte fora: não encerra os incidentes dela só porque não conseguimos ler
            seen.update(h["key"] for h in hist.values() if h.get("source") == s["id"] and not h.get("clearedAt"))
            continue
        for a in s["active"]:
            seen.add(a["key"])
            h = hist.get(a["key"])
            if h is None:
                h = hist[a["key"]] = {"key": a["key"], "source": s["id"], "sourceName": s["name"],
                                      "firstSeen": iso(checked), "worstSeverity": a["severity"]}
            h.update({"title": a["title"], "link": a["link"], "status": a["status"], "statusLabel": a["statusLabel"],
                      "severity": a["severity"], "published": a["published"], "lastSeen": iso(checked), "clearedAt": None})
            h["worstSeverity"] = worst([h.get("worstSeverity", "ok"), a["severity"]])
    for k, h in hist.items():
        if k not in seen and not h.get("clearedAt"):
            h["clearedAt"] = iso(checked)
    cutoff = checked - timedelta(days=HISTORY_DAYS)
    kept = [h for h in hist.values() if (parse_iso(h.get("lastSeen")) or checked) >= cutoff]
    kept.sort(key=lambda h: h.get("firstSeen") or "", reverse=True)
    return kept[:HISTORY_MAX]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", required=True)
    ap.add_argument("--previous")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    with open(args.sources, encoding="utf-8") as f:
        cfg = json.load(f)
    prev = {}
    if args.previous:
        try:
            with open(args.previous, encoding="utf-8") as f:
                prev = json.load(f)
        except (OSError, ValueError):
            prev = {}
    prev_by_id = {s["id"]: s for s in prev.get("sources", [])}

    checked = now_utc().replace(microsecond=0)
    sources = [collect_source(s, prev_by_id.get(s["id"]), checked) for s in cfg["sources"]]
    history = update_history(prev.get("history"), sources, checked)
    tr = Translator(prev.get("translations"))
    translate_summaries(sources, tr)
    if tr.error:
        print("tradução:", tr.error)

    overall = worst([s["severity"] for s in sources if s["severity"] in SEV_ORDER])
    data = {
        "schema": 1,
        "generatedAt": iso(checked),
        "overall": overall,
        "counts": {
            "sources": len(sources),
            "sourcesDown": sum(1 for s in sources if not s["ok"]),
            "active": sum(len(s["active"]) for s in sources),
        },
        "translation": {"enabled": bool(tr.key), "error": tr.error},
        "sources": sources,
        "history": history,
        "translations": tr.used,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    for s in sources:
        print(f'{s["id"]}: ok={s["ok"]} active={len(s["active"])} severity={s["severity"]} {s.get("error") or ""}')
    # Falha o job só se TODAS as fontes falharem (para aparecer no Actions)
    if sources and all(not s["ok"] for s in sources):
        sys.exit(2)


if __name__ == "__main__":
    main()
