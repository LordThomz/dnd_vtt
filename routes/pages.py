"""routes/pages.py"""
from flask import (Blueprint, render_template, request,
                   session as flask_session, redirect)
from game_state import get_session, get_user

pages_bp = Blueprint("pages", __name__)

def _require_login_redirect():
    u = flask_session.get("username")
    if not u or not get_user(u):
        return redirect("/login")
    return None

@pages_bp.route("/")
def index():
    u = flask_session.get("username")
    if not u or not get_user(u):
        return render_template("login.html")
    # Eingeloggt → Startbildschirm (Hauptmenü und Spielen sind zusammengelegt)
    return render_template("index.html", current_user=get_user(u))

@pages_bp.route("/menu")
def menu():
    u = flask_session.get("username")
    if not u or not get_user(u):
        return redirect("/login")
    # Das frühere Hauptmenü ist im Startbildschirm aufgegangen
    return render_template("index.html", current_user=get_user(u))

@pages_bp.route("/play")
def play():
    # Die Kampagnen-Auswahl (früher die Startseite).
    u = flask_session.get("username")
    if not u or not get_user(u):
        return redirect("/login")
    return render_template("index.html", current_user=get_user(u))

@pages_bp.route("/dice")
def dice_workshop():
    """Würfel-Werkstatt: eigene Würfel gestalten."""
    u = flask_session.get("username")
    if not u or not get_user(u):
        return redirect("/login")
    return render_template("dice.html")

@pages_bp.route("/login")
def login():
    return render_template("login.html")

@pages_bp.route("/table/<session_id>")
def table(session_id):
    guard = _require_login_redirect()
    if guard: return guard
    s = get_session(session_id)
    user = flask_session.get("username")
    role = "gm" if s.get("owner") == user else "player"
    char_id = request.args.get("char_id", "")
    return render_template("table.html",
        session_id=session_id, role=role, username=user, char_id=char_id)

@pages_bp.route("/builder")
def builder():
    guard = _require_login_redirect()
    if guard: return guard
    return render_template("builder.html")

@pages_bp.route("/library")
def library():
    guard = _require_login_redirect()
    if guard: return guard
    return render_template("library.html")


@pages_bp.route("/favicon.ico")
def favicon():
    """Browser fragen automatisch nach /favicon.ico – Verweis auf das SVG-Icon."""
    from flask import redirect
    return redirect("/static/favicon.svg", code=301)
