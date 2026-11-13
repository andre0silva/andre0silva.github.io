#!/usr/bin/env python3
"""Coletor do painel /status/.

Lê status/sources.json, baixa cada feed RSS/Atom público, normaliza os itens,
atualiza o histórico e grava um único status.json consumido pela página.

Uso: python3 collect.py --sources ../sources.json --previous status.json --out status.json
Somente biblioteca padrão (roda no runner do GitHub Actions sem instalar nada).
"""
import argparse
import html
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
DESC_MAX = 6000
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
        "sources": sources,
        "history": history,
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
