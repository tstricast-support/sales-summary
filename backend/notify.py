import os, json
from pywebpush import webpush, WebPushException
import models

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_CONTACT = os.getenv("VAPID_CONTACT_EMAIL", "mailto:admin@example.com")


def notify_admins(db, title: str, body: str, url: str = "/"):
    if not VAPID_PRIVATE_KEY:
        return  # push not configured on the server yet — silently skip
    subs = db.query(models.PushSubscription).all()
    payload = json.dumps({"title": title, "body": body, "url": url})
    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint,
                                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_CONTACT},
            )
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                db.delete(sub)  # the browser revoked/expired this subscription
    db.commit()