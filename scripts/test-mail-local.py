#!/usr/bin/env python3
"""Exercise the running local mail stack; never send to the public internet."""
import json
import smtplib
import time
import uuid
from email.message import EmailMessage
from urllib.request import urlopen

subject = "Orbyn local mail test " + str(uuid.uuid4())
with smtplib.SMTP("127.0.0.1", 11587, timeout=10) as smtp:
    smtp.ehlo()
    smtp.mail("outsider@another.test")
    code, _ = smtp.rcpt("recipient@example.test")
    assert code >= 500, f"Non-local sender could relay mail: {code}"
    smtp.rset()
    message = EmailMessage()
    message["From"] = "Orbyn <reminders@orbyn.test>"
    message["To"] = "recipient@example.test"
    message["Subject"] = subject
    message.set_content("Local delivery through Maddy, DKIM, and a TLS relay works.")
    smtp.send_message(message)

deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    with urlopen("http://127.0.0.1:18025/api/v1/messages", timeout=5) as response:
        messages = json.load(response)["messages"]
    match = next((m for m in messages if m["Subject"] == subject), None)
    if match:
        with urlopen(
            f"http://127.0.0.1:18025/api/v1/message/{match['ID']}/raw", timeout=5
        ) as response:
            raw = response.read().decode()
        assert "DKIM-Signature:" in raw, "DKIM signature missing"
        assert "d=orbyn.test;" in raw, "Wrong DKIM signing domain"
        assert "s=default;" in raw, "Wrong DKIM selector"
        print("PASS: sender restriction, SMTP submission, DKIM signature, TLS relay delivery")
        print("Inbox: http://127.0.0.1:18025")
        break
    time.sleep(0.5)
else:
    raise SystemExit("FAIL: message did not reach the local inbox within 30 seconds")
