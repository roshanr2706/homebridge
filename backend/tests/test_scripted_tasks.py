import pytest

from app.harness import run_task
from app.scenarios import TASKS


@pytest.mark.parametrize("task", TASKS, ids=[t.id for t in TASKS])
def test_scripted_task(task):
    r = run_task(task)
    assert r["passed"], f"{task.id}: {r['problems']}\nreply: {r['reply']}"
