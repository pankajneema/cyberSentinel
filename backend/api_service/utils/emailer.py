import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from decouple import config
from typing import Optional, Iterable, List

# SMTP CONFIG
SMTP_SERVER = config("SMTP_SERVER", default="smtp.gmail.com")
SMTP_PORT = int(config("SMTP_PORT", default=587))
SMTP_EMAIL = config("SMTP_EMAIL", default="")
SMTP_PASSWORD = config("SMTP_PASSWORD", default="")
CONTACT_EMAIL = config("CONTACT_EMAIL", default="pankaj200321@gmail.com")

COMPANY_NAME = "CuriousDevs"
PRODUCT_NAME = "CyberSentinel"
SUPPORT_EMAIL = "thecuriousdevs@gmail.com"
PRODUCT_URL = "https://cybersentinel.curiousdevs.com"
WEBSITE_URL = "https://curiousdevs.com"


def _normalize_recipients(value: Optional[Iterable[str]]) -> List[str]:
    if not value:
        return []
    return [v.strip() for v in value if v and v.strip()]


def _email_footer() -> str:
    return f"""
    <hr style=\"margin-top:32px;border:none;border-top:1px solid #e5e7eb;\" />

    <p style=\"font-size:13px;color:#374151;\">
        <strong>{PRODUCT_NAME}</strong> is a unified, AI-powered cybersecurity platform built by
        <strong>{COMPANY_NAME}</strong>, providing continuous visibility, proactive defense,
        real-world security readiness, and streamlined security workflows.
    </p>

    <p style=\"font-size:13px;color:#374151;\">
        🌐 <a href=\"{PRODUCT_URL}\">{PRODUCT_URL}</a><br/>
        📧 Need help? Contact us at
        <a href=\"mailto:{SUPPORT_EMAIL}\">{SUPPORT_EMAIL}</a>
    </p>

    <p style=\"font-size:12px;color:#6b7280;margin-top:12px;\">
        If you were not expecting this email, you can safely ignore it.
        No action is required.
    </p>

    <p style=\"font-size:12px;color:#9ca3af;margin-top:18px;\">
        © {COMPANY_NAME} — Securing teams, assets, and infrastructure.
    </p>
    """


def _wrap_html(content: str) -> str:
    return f"""
    <html>
    <body style=\"
        font-family: Inter, Arial, Helvetica, sans-serif;
        line-height: 1.6;
        color: #111827;
        background-color:#ffffff;
        padding:24px;
    \">
        <div style=\"max-width:640px;margin:auto;\">
            {content}
            {_email_footer()}
        </div>
    </body>
    </html>
    """


def send_email(
    to_email: str,
    subject: str,
    body: str,
    is_html: bool = False,
    cc_list: Optional[Iterable[str]] = None,
    attachment: Optional[bytes] = None,
    attachment_filename: Optional[str] = None,
    attachment_mimetype: str = "application/octet-stream",
):
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        print(f"[EMAIL] Would send to {to_email}: {subject}")
        return False

    try:
        msg = MIMEMultipart()
        msg["From"] = f"{PRODUCT_NAME} <{SMTP_EMAIL}>"
        msg["To"] = to_email
        msg["Subject"] = subject
        msg["Reply-To"] = SUPPORT_EMAIL
        msg["X-Mailer"] = f"{PRODUCT_NAME} Mailer"

        cc_recipients = _normalize_recipients(cc_list)
        if cc_recipients:
            msg["Cc"] = ", ".join(cc_recipients)

        msg.attach(MIMEText(body, "html" if is_html else "plain"))

        # Optional file attachment (e.g. a generated PDF/CSV report). Additive:
        # existing callers pass no attachment and behaviour is unchanged.
        if attachment is not None and attachment_filename:
            _subtype = attachment_mimetype.split("/", 1)[-1] or "octet-stream"
            part = MIMEApplication(attachment, _subtype=_subtype)
            part.add_header(
                "Content-Disposition", "attachment", filename=attachment_filename
            )
            msg.attach(part)

        recipients = [to_email] + cc_recipients

        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=20) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.sendmail(SMTP_EMAIL, recipients, msg.as_string())

        return True

    except Exception as e:
        print(f"[EMAIL ERROR] {str(e)}")
        return False


def send_group_invite_notification(mail_data: dict, to_email: str, cc_list: Optional[Iterable[str]] = None):
    inviter = mail_data.get("sender") or "A team member"
    team_name = mail_data.get("team_name") or "his team"
    invitee_name = mail_data.get("invitee_name") or "there"
    role = mail_data.get("role") or "Member"
    invite_link = mail_data.get("invite_link") or "#"

    subject = f"{inviter} invited you to join their workspace on {PRODUCT_NAME}"

    content = f"""
    <h2 style=\"font-size:22px;\">
        You’ve been invited to join {inviter}'s workspace on {PRODUCT_NAME}
    </h2>

    <p>Hi <strong>{invitee_name}</strong>,</p>

    <p>
        <strong>{inviter}</strong> has invited you to join the team
        <strong>{team_name}</strong> on <strong>{PRODUCT_NAME}</strong>.
    </p>

    <p>
        You’ve been invited to access <strong>{PRODUCT_NAME}</strong>,
        a unified cybersecurity platform for security visibility and operations.
    </p>

    <p><strong>Your assigned role:</strong> {role}</p>

    <div style=\"margin:28px 0;\">
        <a href=\"{invite_link}\"
           style=\"
                background:#2563eb;
                color:#ffffff;
                padding:12px 22px;
                text-decoration:none;
                border-radius:6px;
                font-weight:600;
                display:inline-block;
           \">
           Accept Invitation
        </a>
    </div>

    <p style=\"font-size:13px;color:#374151;\">
        This invitation was sent to <strong>{to_email}</strong>.
        If this wasn’t intended for you, you can safely ignore it.
    </p>

    <p style=\"margin-top:28px;\">
        Thanks,<br/>
        <strong>{PRODUCT_NAME} Team</strong>
    </p>
    """

    body = _wrap_html(content)
    return send_email(to_email, subject, body, is_html=True, cc_list=cc_list)


def send_member_removed_notification(mail_data: dict, to_email: str, cc_list: Optional[Iterable[str]] = None):
    removed_name = mail_data.get("removed_name") or "Your account"
    remover = mail_data.get("removed_by") or "a team administrator"

    subject = f"Your access to {PRODUCT_NAME} has been removed"

    content = f"""
    <h2 style=\"font-size:22px;\">Access Removed</h2>

    <p>
        Hi <strong>{removed_name}</strong>,
    </p>

    <p>
        Your access to <strong>{PRODUCT_NAME}</strong> has been removed by
        <strong>{remover}</strong>.
    </p>

    <p>
        If you believe this was a mistake, please contact your administrator
        or reach out to our support team.
    </p>

    <p style=\"margin-top:28px;\">
        Thanks,<br/>
        <strong>{PRODUCT_NAME} Team</strong>
    </p>
    """

    body = _wrap_html(content)
    return send_email(to_email, subject, body, is_html=True, cc_list=cc_list)


def send_contact_notification(payload: dict):
    subject = f"New Contact Request - {payload.get('subject', 'General')}"
    content = f"""
    <h2 style=\"font-size:22px;\">New Contact Request</h2>

    <p><strong>Name:</strong> {payload.get('first_name', '')} {payload.get('last_name', '')}</p>
    <p><strong>Email:</strong> {payload.get('email', '')}</p>
    <p><strong>Company:</strong> {payload.get('company', '')}</p>
    <p><strong>Subject:</strong> {payload.get('subject', '')}</p>
    <p><strong>Submitted At:</strong> {payload.get('submitted_at', '')}</p>

    <div style=\"margin-top:18px;\">
      <strong>Message:</strong>
      <div style=\"white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-top:8px;\">{payload.get('message', '')}</div>
    </div>

    <p style=\"margin-top:24px;\">— {PRODUCT_NAME} Web</p>
    """
    body = _wrap_html(content)
    return send_email(CONTACT_EMAIL, subject, body, is_html=True)


def send_early_access_notification(payload: dict):
    subject = f"Early Access Request - {payload.get('service', 'Service')}"
    content = f"""
    <h2 style=\"font-size:22px;\">Early Access Request</h2>

    <p><strong>Email:</strong> {payload.get('email', '')}</p>
    <p><strong>Service:</strong> {payload.get('service', '')}</p>
    <p><strong>Submitted At:</strong> {payload.get('submitted_at', '')}</p>

    <p style=\"margin-top:24px;\">— {PRODUCT_NAME} Web</p>
    """
    body = _wrap_html(content)
    return send_email(CONTACT_EMAIL, subject, body, is_html=True)
