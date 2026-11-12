"""Client RBooks testé contre un faux serveur local (même routes/formats que Bigcapital/RBooks)."""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rbcapture import rbooks  # noqa: E402
from rbcapture.engine import Engine  # noqa: E402

JOURNAL = []


class Faux(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _rep(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _corps(self):
        n = int(self.headers.get("content-length") or 0)
        return self.rfile.read(n)

    def do_GET(self):
        JOURNAL.append(("GET", self.path, self.headers.get("organization-id")))
        if self.path.startswith("/api/vendors") or self.path.startswith("/api/items"):
            return self._rep(200, {"data": []})
        if self.path.startswith("/api/accounts"):
            return self._rep(200, {"accounts": [{"id": 7, "code": "5200", "name": "Repas", "root_type": "expense"}]})
        self._rep(404, {})

    def do_POST(self):
        corps = self._corps()
        JOURNAL.append(("POST", self.path, self.headers.get("authorization")))
        if self.path == "/api/auth/signin":
            return self._rep(200, {"accessToken": "jeton-bidon", "organizationId": "org1", "tenantId": 1})
        if self.path in ("/api/vendors", "/api/items"):
            return self._rep(201, {"id": 11})
        if self.path == "/api/attachments":
            assert b"filename=" in corps
            return self._rep(200, {"status": 200, "data": {"key": "abc123"}})
        if self.path == "/api/bills":
            JOURNAL.append(("BILL", json.loads(corps)))
            return self._rep(201, {"id": 42})
        self._rep(404, {})


def test_facture_fournisseur_avec_piece_jointe(tmp_path, monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), Faux)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("RBOOKS_URL", f"http://127.0.0.1:{srv.server_port}")
    monkeypatch.setenv("RBOOKS_EMAIL", "demo@example.test")
    monkeypatch.setenv("RBOOKS_PASSWORD", "x")
    eng = Engine(tmp_path)
    eng.charger_demo()
    doc = [d for d in eng.etat["docs"] if d["data"].get("total") == 30.41][0]
    r = eng.evaluer_tous()[doc["id"]]
    c = rbooks.Client()
    c.connexion()
    bill = c.facture_fournisseur(r, doc["id"], [tmp_path / p["fichier"] for p in doc["parts"]])
    srv.shutdown()
    assert bill == 42
    corps = [j[1] for j in JOURNAL if j[0] == "BILL"][0]
    assert corps["attachments"] == [{"key": "abc123"}] and corps["vendorId"] == 11 and corps["open"] is True
    assert round(sum(e["rate"] * e["quantity"] for e in corps["entries"]), 2) == 30.41  # = total payé
    assert corps["billDate"] == "2026-06-27"
    assert ("POST", "/api/bills", "Bearer jeton-bidon") in JOURNAL
