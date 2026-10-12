import os, json
from pywebpush import webpush, WebPushException
import models

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_CONTACT = os.getenv("VAPID_CONTACT_EMAIL", "mailto:admin@example.com")


def notify_admins(db, title: str, body: str, url: str = "/", roles=("admin",), url_by_role=None):
    """roles: which kind of device receives it. Sales alerts go to ("admin",) only;
    cheque alerts go to ("admin", "hr"). url_by_role lets each role open its own page."""
    if not VAPID_PRIVATE_KEY:
        return  # push not configured on the server yet — silently skip
    subs = db.query(models.PushSubscription).filter(models.PushSubscription.role.in_(roles)).all()
    for sub in subs:
        payload = json.dumps({"title": title, "body": body, "url": (url_by_role or {}).get(sub.role, url)})
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
        except Exception as e:
            print("push failed for one device:", e)  # one bad device must not stop the others
    db.commit()


def safe_notify(db, title: str, body: str, url: str = "/", roles=("admin",), url_by_role=None):
    """Never let a notification problem break saving data."""
    try:
        notify_admins(db, title, body, url, roles, url_by_role)
    except Exception as e:
        print("push failed:", e)
        db.rollback()