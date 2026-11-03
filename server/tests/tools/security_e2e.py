"""Disposable local security E2E; never accepts a production URL or database.

Run with a venv containing httpx, Pillow, FastAPI, PyJWT, python-multipart,
python-dotenv and uvicorn. Requires Docker's pgvector/pgvector:pg16 image,
cached Maven dependencies and JDK 21 (JAVA_HOME may override the local default).
Only the OCR engine is stubbed; parsing, routes, credentials and storage are real.
"""
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import urllib.parse
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[3]


def stub_server(port):
    sys.path.insert(0, str(ROOT / "server/ocr"))
    engine = types.ModuleType("src.ocr.paddle_ocr_engine")

    class Engine:
        def extract(self, image_path):
            return {"image_file": Path(image_path).name, "text_blocks": [
                {"text": "E2E FIXTURE", "confidence": 0.99, "block_index": 0,
                 "bbox": [[0, 0], [100, 0], [100, 20], [0, 20]]}]}

    engine.PaddleOCREngine = Engine
    sys.modules[engine.__name__] = engine
    from app import app
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run():
    import httpx
    from PIL import Image

    checks = []
    attempts = []
    processes = []
    logs = []
    container = "mora-security-e2e-" + secrets.token_hex(5)
    container_started = False
    work = Path(tempfile.mkdtemp(prefix="mora-security-e2e-"))
    print("Artifacts:", work, flush=True)

    class ProxyTrap(http.server.BaseHTTPRequestHandler):
        def do_CONNECT(self):
            attempts.append(self.path)
            self.send_error(502, "External provider disabled in E2E")

        def log_message(self, *_):
            pass

    proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), ProxyTrap)
    threading.Thread(target=proxy.serve_forever, daemon=True).start()

    def command(args, **kwargs):
        return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()

    def sql(statement):
        return command(["docker", "exec", container, "psql", "-U", "postgres", "-d", "mora_e2e",
                        "-v", "ON_ERROR_STOP=1", "-Atc", statement])

    def check(label, condition, details=None):
        checks.append({"check": label, "passed": bool(condition), "details": details})
        print(("PASS " if condition else "FAIL ") + label, flush=True)
        if not condition:
            raise AssertionError(label + (": " + str(details) if details else ""))

    def launch(args, env, name):
        log = open(work / (name + ".log"), "w")
        logs.append(log)
        process = subprocess.Popen(args, env=env, cwd=work, stdout=log, stderr=subprocess.STDOUT)
        processes.append(process)
        return process

    def ready(url, process, timeout=90):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("Server stopped; see logs in " + str(work))
            try:
                if httpx.get(url, timeout=2, trust_env=False).status_code < 500:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.3)
        raise RuntimeError("Server readiness timeout: " + url)

    try:
        java_home = Path(os.environ.get("JAVA_HOME", "/opt/homebrew/opt/openjdk@21"))
        command([str(java_home / "bin/java"), "-version"])
        build_env = dict(os.environ, JAVA_HOME=str(java_home))
        namespace = "http://maven.apache.org/POM/4.0.0"
        ET.register_namespace("", namespace)
        tree = ET.parse(ROOT / "server/spring/pom.xml")
        build = tree.getroot().find("{" + namespace + "}build")
        for key, value in {"directory": work / "target", "sourceDirectory": ROOT / "server/spring/src/main/java",
                           "testSourceDirectory": ROOT / "server/spring/src/test/java"}.items():
            ET.SubElement(build, "{" + namespace + "}" + key).text = str(value)
        resources = ET.SubElement(build, "{" + namespace + "}resources")
        resource = ET.SubElement(resources, "{" + namespace + "}resource")
        ET.SubElement(resource, "{" + namespace + "}directory").text = str(ROOT / "server/spring/src/main/resources")
        pom = work / "pom.xml"
        tree.write(pom, encoding="utf-8", xml_declaration=True)
        print("Building Spring in isolated output directory", flush=True)
        with open(work / "maven.log", "w") as log:
            subprocess.run(["mvn", "-o", "-f", str(pom),
                            "-DargLine=-javaagent:" + str(Path.home() / ".m2/repository/org/mockito/mockito-core/5.17.0/mockito-core-5.17.0.jar"),
                            "package"], env=build_env, cwd=work, stdout=log, stderr=subprocess.STDOUT, check=True)
        check("Spring main and all test sources compile; Maven tests pass", True)
        # Existing DB-gated regression tests use this password in their disposable fixture.
        password = "test"
        command(["docker", "run", "--rm", "-d", "--name", container,
                 "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=mora_e2e",
                 "-p", "127.0.0.1::5432", "pgvector/pgvector:pg16"])
        container_started = True
        for _ in range(100):
            result = subprocess.run(["docker", "exec", container, "pg_isready", "-U", "postgres"], capture_output=True)
            if result.returncode == 0:
                break
            time.sleep(0.2)
        pg_port = command(["docker", "port", container, "5432/tcp"]).rsplit(":", 1)[1]
        test_database = "jdbc:postgresql://127.0.0.1:" + pg_port + "/mora_e2e"
        test_env = dict(build_env, OAUTH_TEST_DATABASE_URL=test_database, OAUTH_TEST_DATABASE_PASSWORD=password,
                        STORED_IMAGE_TEST_DATABASE_URL=test_database)
        with open(work / "database-tests.log", "w") as log:
            subprocess.run(["mvn", "-o", "-f", str(pom),
                            "-DargLine=-javaagent:" + str(Path.home() / ".m2/repository/org/mockito/mockito-core/5.17.0/mockito-core-5.17.0.jar"),
                            "test"], env=test_env, cwd=work, stdout=log, stderr=subprocess.STDOUT, check=True)
        check("Full Maven suite including DB-gated regressions passes", True)
        spring_port, ocr_port = free_port(), free_port()
        spring, ocr = "http://127.0.0.1:" + str(spring_port), "http://127.0.0.1:" + str(ocr_port)
        jwt_secret, ocr_secret = secrets.token_hex(32), secrets.token_hex(32)
        upload_dir = work / "uploads"
        ocr_env = dict(os.environ, OCR_SHARED_SECRET=ocr_secret, GCS_BUCKET_NAME="", MORA_UPLOAD_DIR=str(upload_dir),
                       PYTHON_DOTENV_DISABLED="1", OCR_DOC_CLASSIFIER_DIR=str(work / "no-models"))
        for key in list(ocr_env):
            if key in {"JWT_SECRET", "DATABASE_URL", "DATABASE_PASSWORD", "OPENAI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"}:
                del ocr_env[key]
        ocr_process = launch([sys.executable, str(Path(__file__).resolve()), "--stub-server", str(ocr_port)], ocr_env, "ocr")
        ready(ocr + "/", ocr_process)
        env = dict(build_env, JWT_SECRET=jwt_secret, OCR_SHARED_SECRET=ocr_secret, OPENAI_API_KEY="",
                   DATABASE_URL="jdbc:postgresql://127.0.0.1:" + pg_port + "/mora_e2e?stringtype=unspecified",
                   DATABASE_USERNAME="postgres", DATABASE_PASSWORD=password, OCR_SERVICE_URL=ocr,
                   FRONTEND_URL="mora://auth", DB_MAX_POOL_SIZE="8")
        for provider in ("GOOGLE", "KAKAO", "NAVER"):
            env.update({provider + "_OAUTH_CLIENT_ID": "e2e-client", provider + "_OAUTH_CLIENT_SECRET": "e2e-client-secret",
                        provider + "_OAUTH_REDIRECT_URI": spring + "/auth/" + provider.lower() + "/callback"})
        jar = next((work / "target").glob("*.jar"))
        spring_process = launch([str(java_home / "bin/java"), "-Dhttps.proxyHost=127.0.0.1",
                                 "-Dhttps.proxyPort=" + str(proxy.server_port), "-jar", str(jar),
                                 "--server.address=127.0.0.1", "--server.port=" + str(spring_port),
                                 "--spring.jpa.hibernate.ddl-auto=validate"], env, "spring")
        ready(spring + "/auth/me", spring_process)
        versions = sql("SELECT string_agg(version, ',' ORDER BY installed_rank) FROM flyway_schema_history WHERE success")
        check("Flyway V1-V9 applied to fresh pgvector DB", versions == "1,2,3,4,5,6,7,8,9", versions)

        with httpx.Client(base_url=spring, timeout=30, follow_redirects=False, trust_env=False) as client:
            def request(method, path, token=None, **kwargs):
                headers = kwargs.pop("headers", {})
                if token:
                    headers["Authorization"] = "Bearer " + token
                return client.request(method, path, headers=headers, **kwargs)

            def signup(label):
                response = request("POST", "/auth/signup", json={"email": "e2e-" + secrets.token_hex(5) + "@example.invalid",
                                   "password": "Synthetic-only-password-42!", "name": "E2E" + label})
                check("Signup synthetic user " + label, response.status_code == 200)
                return response.json()["data"]

            a, b = signup("A"), signup("B")
            image = io.BytesIO()
            Image.new("RGB", (128, 48), "white").save(image, "PNG")
            png = image.getvalue()

            def upload(token, kind, scan=False):
                path = "/api/scan" if scan else "/api/commit"
                response = request("POST", path, token, files={"file": ("fixture.png", png, "image/png")},
                                   data={"document_type": kind, "raw_blocks": "[]", "corrected_fields": "{}"})
                check(("Scan " if scan else "Commit ") + kind + " gateway HTTP 200", response.status_code == 200,
                      response.status_code)
                body = response.json()
                check("Gateway success envelope " + path, body.get("success") is True)
                data = body["data"]
                if scan:
                    check("Scan preserves nested app envelope", data.get("success") is True and "raw_blocks" in data["data"])
                    data = data["data"]
                else:
                    check("Commit preserves flattened app envelope", "image_url" in data and "count" in data)
                return data["image_url"]

            for method, path in [("POST", "/api/scan"), ("POST", "/api/commit")]:
                response = request(method, path, files={"file": ("fixture.png", png, "image/png")})
                check("Anonymous gateway upload denied " + path, response.status_code == 401)
            kinds = ["BUSINESS_CARD", "POSTER", "TICKET", "RECEIPT"]
            endpoints = {"BUSINESS_CARD": ("/api/save", "/api/cards"), "POSTER": ("/api/posters/save", "/api/posters"),
                         "TICKET": ("/api/tickets/save", "/api/tickets"), "RECEIPT": ("/api/receipts/save", "/api/receipts")}

            def payload(kind, url):
                if kind == "BUSINESS_CARD":
                    return {"name": "E2E Fixture", "imageUrl": url}
                return {"docType": kind, "title": "E2E Fixture", "merchantName": "E2E Fixture", "items": [],
                        "parsedJson": json.dumps({"image_url": url}), "rawJson": json.dumps({"imageUrl": url})}

            for kind in kinds:
                upload(a["token"], kind, scan=True)
                url = upload(a["token"], kind)
                check("Owner image read 200 " + kind, request("GET", url, a["token"]).status_code == 200)
                check("Other-user image read 404 " + kind, request("GET", url, b["token"]).status_code == 404)
                check("Anonymous image read 401 " + kind, request("GET", url).status_code == 401)
                endpoint, collection = endpoints[kind]
                before = sql("SELECT count(*) FROM " + ("business_cards" if kind == "BUSINESS_CARD" else collection.rsplit("/", 1)[1]))
                forged = request("POST", endpoint, b["token"], json=payload(kind, url))
                check("Forged attachment denied with 404 " + kind, forged.status_code == 404, forged.status_code)
                after = sql("SELECT count(*) FROM " + ("business_cards" if kind == "BUSINESS_CARD" else collection.rsplit("/", 1)[1]))
                check("Forged attachment creates no document " + kind, before == after)
                saved = request("POST", endpoint, a["token"], json=payload(kind, url))
                check("Owner document save " + kind, saved.status_code == 200, saved.status_code)
                doc_id = str(saved.json()["data"]["id"])
                check("Saved document readable " + kind, request("GET", collection + "/" + doc_id, a["token"]).status_code == 200)
                deleted = request("DELETE", collection + "/" + doc_id, a["token"])
                check("Document delete " + kind, deleted.status_code == 200, deleted.status_code)
                check("Deleted document image read 404 " + kind, request("GET", url, a["token"]).status_code == 404)
                check("Deleted document physical image removed " + kind, not (upload_dir / url.rsplit("/", 1)[1]).exists())

            survivor = upload(b["token"], "RECEIPT")
            for kind in kinds:
                url = upload(a["token"], kind)
                saved = request("POST", endpoints[kind][0], a["token"], json=payload(kind, url))
                check("Account-delete fixture save " + kind, saved.status_code == 200)
            pending = upload(a["token"], "POSTER")
            a_names = sql("SELECT image_name FROM stored_images WHERE user_id='" + a["userId"] + "'").splitlines()
            check("Account has attached and pending images", len(a_names) >= 9)
            deleted = request("DELETE", "/auth/me", a["token"])
            check("Account delete including pending uploads HTTP 200", deleted.status_code == 200, deleted.status_code)
            check("Account and registry rows removed", sql("SELECT count(*) FROM users WHERE id='" + a["userId"] + "'") == "0"
                  and sql("SELECT count(*) FROM stored_images WHERE user_id='" + a["userId"] + "'") == "0")
            check("Account physical images all removed", all(not (upload_dir / name).exists() for name in a_names))
            check("Deleted user's token cannot read images", request("GET", pending, a["token"]).status_code == 401)
            check("Other user's image survives account deletion", request("GET", survivor, b["token"]).status_code == 200)

            with httpx.Client(base_url=ocr, trust_env=False) as direct:
                for method, path in [("POST", "/api/scan"), ("POST", "/api/commit"), ("GET", survivor), ("DELETE", survivor)]:
                    response = direct.request(method, path)
                    check("Direct OCR anonymous denied " + method + " " + path.split("/")[1], response.status_code == 401)
                    response = direct.request(method, path, headers={"Authorization": "Bearer " + b["token"]})
                    check("Direct OCR user JWT denied " + method + " " + path.split("/")[1], response.status_code == 401)

            for provider in ("google", "kakao", "naver"):
                login = request("GET", "/auth/" + provider + "/login")
                check("OAuth login redirects " + provider, login.status_code == 302)
                cookie = login.headers["set-cookie"]
                check("OAuth cookie flags " + provider, all(flag in cookie for flag in ("Secure", "HttpOnly", "SameSite=Lax", "Path=/"))
                      and "Domain=" not in cookie)
                state = urllib.parse.parse_qs(urllib.parse.urlsplit(login.headers["location"]).query)["state"][0]
                state_hash = hashlib.sha256(state.encode()).hexdigest()
                check("OAuth DB stores hash, not raw state " + provider,
                      sql("SELECT count(*) FROM oauth_login_states WHERE state_hash='" + state_hash + "'") == "1")
                browser_header = {"Cookie": cookie.split(";", 1)[0]}
                count = len(attempts)
                rejected = request("GET", "/auth/" + provider + "/callback", headers=browser_header, params={"code": "e2e-code"})
                check("OAuth missing state rejects without provider exchange " + provider,
                      rejected.status_code == 302 and "oauth_error=" + provider in rejected.headers["location"] and len(attempts) == count)
                check("OAuth missing state does not consume unrelated nonce " + provider,
                      sql("SELECT count(*) FROM oauth_login_states WHERE state_hash='" + state_hash + "'") == "1")
                # Positive control: the exact state+cookie must reach the blocked provider exchange once.
                request("GET", "/auth/" + provider + "/callback", headers=browser_header, params={"code": "e2e-code", "state": state})
                check("OAuth exchange detector positive control " + provider, len(attempts) > count)
                count = len(attempts)
                request("GET", "/auth/" + provider + "/callback", headers=browser_header, params={"code": "e2e-code", "state": state})
                check("OAuth replay denied without new exchange " + provider, len(attempts) == count)
            request("DELETE", "/auth/me", b["token"])
            check("All synthetic users deleted", sql("SELECT count(*) FROM users") == "0")
        print("All security E2E checks passed", flush=True)
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        proxy.shutdown()
        proxy.server_close()
        for log in logs:
            log.close()
        if container_started:
            subprocess.run(["docker", "stop", container], check=True, capture_output=True)
        (work / "report.json").write_text(json.dumps({"checks": checks, "passed": sum(c["passed"] for c in checks),
                                                     "provider_attempt_hosts": attempts}, indent=2) + "\n")
        print("Report:", work / "report.json", flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--stub-server":
        stub_server(int(sys.argv[2]))
    else:
        run()
