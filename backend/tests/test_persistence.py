"""Pending actions and the draft rate limit survive a server restart when HB_DB is a file.

A "restart" here builds a second AppState over the same SQLite file, which is what
`uvicorn` does on boot (build_state(settings) with settings.db_path from HB_DB).
"""
import pytest

from app.config import Settings
from app.harness import TODAY
from app.main import build_state
from app.policy import PolicyError
from app.seed import SPONSOR, STUDENT


@pytest.fixture()
def boot(tmp_path):
    states = []

    def _boot(drafts_per_hour=None):
        if states:
            states[-1].bank.db.close()  # the previous "process" is gone
        settings = Settings(db_path=str(tmp_path / "hb.db"), audit_path=str(tmp_path / "audit.jsonl"))
        if drafts_per_hour is not None:
            settings.limits.drafts_per_hour = drafts_per_hour
        st = build_state(settings, today=TODAY, audit_path="default")
        states.append(st)
        return st

    yield _boot
    if states:
        states[-1].bank.db.close()


def _cad_balance(st):
    return st.bank.account("acc_cad")["balance"]


def test_sponsor_queue_survives_restart_and_executes_once(boot):
    st = boot()
    start = _cad_balance(st)
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 2000)
    assert a.tier == "T3"
    st.policy.confirm(a.id, STUDENT, a._token)
    assert a.status == "awaiting_sponsor"
    expires, token_hash = a.expires_at, a.token_hash

    st2 = boot()
    assert [q.id for q in st2.policy.sponsor_queue(SPONSOR)] == [a.id]
    b = st2.policy.actions[a.id]
    assert b.user_confirmed and b.expires_at == expires and b.token_hash == token_hash
    assert _cad_balance(st2) == start  # nothing moved before approval
    assert st2.policy.sponsor_decide(a.id, SPONSOR, True, "ok").status == "executed"
    assert _cad_balance(st2) == start - 200000
    with pytest.raises(PolicyError):
        st2.policy.sponsor_decide(a.id, SPONSOR, True)

    st3 = boot()
    c = st3.policy.actions[a.id]
    assert c.status == "executed" and c.sponsor_decision == "approved" and c.sponsor_note == "ok"
    assert not st3.policy.sponsor_queue(SPONSOR)
    with pytest.raises(PolicyError):
        st3.policy.sponsor_decide(a.id, SPONSOR, True)
    assert _cad_balance(st3) == start - 200000


def test_confirmed_t2_cannot_be_confirmed_again_after_restart(boot):
    st = boot()
    start = _cad_balance(st)
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 45)
    token = a._token
    assert st.policy.confirm(a.id, STUDENT, token).status == "executed"

    st2 = boot()
    assert st2.policy.actions[a.id].status == "executed"
    with pytest.raises(PolicyError, match="executed"):
        st2.policy.confirm(a.id, STUDENT, token)
    assert _cad_balance(st2) == start - 4500


def test_draft_awaiting_user_needs_the_original_token_after_restart(boot):
    st = boot()
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 45)
    token = a._token

    st2 = boot()
    b = st2.policy.actions[a.id]
    assert b._token is None and b.status == "awaiting_user"
    shown = st2.policy.present(b, include_token=True)  # must not crash without a plaintext token
    assert "confirm_token" not in shown
    assert "confirm_token" not in b.for_app(include_token=True)
    with pytest.raises(PolicyError, match="token"):
        st2.policy.confirm(a.id, STUDENT, "guess")
    with pytest.raises(PolicyError, match="token"):
        st2.policy.confirm(a.id, STUDENT, "")
    # The app that still holds the token it was given can confirm, once.
    assert st2.policy.confirm(a.id, STUDENT, token).status == "executed"
    with pytest.raises(PolicyError):
        st2.policy.confirm(a.id, STUDENT, token)


def test_expiry_and_cancellation_survive_restart(boot):
    st = boot()
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 45)
    b = st.policy.draft_transfer(STUDENT, "s", "py_phone", 30)
    st.policy.cancel(b.id, STUDENT)
    st.policy.actions[a.id].expires_at = 0
    st.policy.get(a.id)  # marks it expired and writes it through

    st2 = boot()
    assert st2.policy.actions[a.id].status == "expired"
    assert st2.policy.actions[b.id].status == "cancelled"
    assert not st2.policy.list_for(STUDENT, ["awaiting_user", "awaiting_sponsor"])


def test_draft_rate_limit_survives_restart(boot):
    st = boot(drafts_per_hour=3)
    for _ in range(3):
        st.policy.draft_transfer(STUDENT, "s", "py_hydro", 10)

    st2 = boot(drafts_per_hour=3)
    with pytest.raises(PolicyError, match="Too many"):
        st2.policy.draft_transfer(STUDENT, "other-session", "py_hydro", 10)


def test_plaintext_token_never_written_to_database(boot, tmp_path):
    st = boot()
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 45)      # awaiting the student
    b = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 2000)    # confirmed, awaiting the sponsor
    tokens = [a._token, b._token]
    st.policy.confirm(b.id, STUDENT, b._token)
    st.bank.db.close()
    raw = b"".join(p.read_bytes() for p in tmp_path.glob("hb.db*"))
    assert a.token_hash.encode() in raw and b.token_hash.encode() in raw  # the hashes are stored ...
    for t in tokens:
        assert t and t.encode() not in raw                                # ... the tokens are not


def test_interrupted_execution_is_not_retried_after_restart(boot):
    st = boot()
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 2000)
    st.policy.confirm(a.id, STUDENT, a._token)
    st.policy._save(a, executing=True)  # simulate a crash in the middle of _execute

    st2 = boot()
    assert st2.policy.actions[a.id].status == "failed"
    assert not st2.policy.sponsor_queue(SPONSOR)
    with pytest.raises(PolicyError):
        st2.policy.sponsor_decide(a.id, SPONSOR, True)


def test_demo_reset_clears_persisted_drafts(boot):
    st = boot(drafts_per_hour=2)
    st.policy.draft_transfer(STUDENT, "s", "py_hydro", 10)
    st.policy.draft_transfer(STUDENT, "s", "py_hydro", 10)
    st.reset()

    st2 = boot(drafts_per_hour=2)
    assert not st2.policy.actions
    st2.policy.draft_transfer(STUDENT, "s", "py_hydro", 10)  # rate-limit window was cleared too
