"""Exercise the merge driver against isolated Git repositories, without a network."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

DRIVER = Path(__file__).resolve().parents[1] / "merge_official_upstream.py"


def git(repo: Path, *args: str) -> str:
    """Run fixture Git operations with an identity scoped to this invocation."""
    result = subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=Merge fixture",
            "-c",
            "user.email=fixture@example.invalid",
            *args,
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


@pytest.fixture
def repository(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a diverged fork with a custom viewer and an official update."""
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for role in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{role}_NAME", "Merge fixture")
        monkeypatch.setenv(f"GIT_{role}_EMAIL", "fixture@example.invalid")
    repo = tmp_path / "repo with spaces"
    repo.mkdir()
    git(repo, "init", "--initial-branch=main")
    (repo / "shared.txt").write_text("base\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "base")
    git(repo, "checkout", "-b", "official")
    (repo / "shared.txt").write_text("official fix\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "official fix")
    git(repo, "checkout", "main")
    (repo / "viewer.txt").write_text("fork viewer\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "custom viewer")
    return repo


def run_driver(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Invoke the real CLI rather than mock the commands it must guard."""
    return subprocess.run(
        [
            sys.executable,
            "-B",
            str(DRIVER),
            "--repo",
            str(repo),
            "--upstream-ref",
            "official",
            *args,
        ],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def test_default_plan_leaves_head_and_worktree_unchanged(repository: Path) -> None:
    before = git(repository, "rev-parse", "HEAD")
    result = run_driver(repository)
    assert result.returncode == 0, result.stdout + result.stderr
    plan = json.loads(result.stdout)
    assert plan["upstream"] == git(repository, "rev-parse", "official")
    assert plan["fork_exclusive_paths"] == ["viewer.txt"]
    assert plan["ahead"] == plan["behind"] == 1
    assert git(repository, "rev-parse", "HEAD") == before
    assert git(repository, "status", "--porcelain") == ""


def test_apply_pins_target_preserves_fork_and_does_not_commit(repository: Path) -> None:
    before = git(repository, "rev-parse", "HEAD")
    result = run_driver(repository, "--apply")
    assert result.returncode == 0, result.stdout + result.stderr
    plan = json.loads(result.stdout)
    assert plan["apply"]["args"][-1] == plan["upstream"]
    assert git(repository, "rev-parse", "MERGE_HEAD") == plan["upstream"]
    assert git(repository, "rev-parse", "HEAD") == before
    assert (repository / "shared.txt").read_text() == "official fix\n"
    assert (repository / "viewer.txt").read_text() == "fork viewer\n"
    verified = run_driver(repository, "--verify")
    assert verified.returncode == 0, verified.stdout + verified.stderr
    assert json.loads(verified.stdout)["verification"]["ok"] is True


def test_apply_refuses_uncommitted_work(repository: Path) -> None:
    (repository / "shared.txt").write_text("user work\n", encoding="utf-8")
    result = run_driver(repository, "--apply")
    assert result.returncode == 2
    assert "dirty worktree" in result.stderr
    assert (repository / "shared.txt").read_text() == "user work\n"


def test_verify_rejects_missing_fork_feature(repository: Path) -> None:
    assert run_driver(repository, "--apply").returncode == 0
    (repository / "viewer.txt").unlink()
    result = run_driver(repository, "--verify")
    assert result.returncode == 1
    assert json.loads(result.stdout)["verification"]["missing_fork_paths"] == [
        "viewer.txt"
    ]


def test_verify_rejects_unresolved_conflicts(repository: Path) -> None:
    (repository / "shared.txt").write_text("custom API integration\n", encoding="utf-8")
    git(repository, "add", ".")
    git(repository, "commit", "-m", "custom shared API")
    result = run_driver(repository, "--apply")
    assert result.returncode == 1
    result = run_driver(repository, "--verify")
    assert result.returncode == 1
    assert json.loads(result.stdout)["verification"]["unmerged_paths"] == ["shared.txt"]


def test_verify_rejects_a_different_pending_target(repository: Path) -> None:
    assert run_driver(repository, "--apply").returncode == 0
    git(repository, "branch", "-f", "official", "HEAD")
    result = run_driver(repository, "--verify")
    assert result.returncode == 1
    assert json.loads(result.stdout)["verification"]["target_integrated"] is False


def test_verify_rejects_trailing_spaces_but_accepts_crlf(repository: Path) -> None:
    assert run_driver(repository, "--apply").returncode == 0
    (repository / "viewer.txt").write_bytes(b"fork viewer\r\n")
    assert run_driver(repository, "--verify").returncode == 0
    (repository / "viewer.txt").write_bytes(b"fork viewer \r\n")
    result = run_driver(repository, "--verify")
    assert result.returncode == 1
    assert (
        "trailing whitespace"
        in json.loads(result.stdout)["verification"]["diff_check"]["stdout"]
    )


def test_advance_preserves_resolutions_binary_data_and_head(repository: Path) -> None:
    previous = git(repository, "rev-parse", "official")
    git(repository, "checkout", "official")
    (repository / "shared.txt").write_text("new official fix\n", encoding="utf-8")
    binary = bytes(range(256))
    (repository / "grammar.bin").write_bytes(binary)
    git(repository, "add", ".")
    git(repository, "commit", "-m", "next official fix")
    target = git(repository, "rev-parse", "HEAD")
    git(repository, "checkout", "main")
    head = git(repository, "rev-parse", "HEAD")
    assert run_driver(repository, "--upstream-ref", previous, "--apply").returncode == 0
    (repository / "viewer.txt").write_text("adapted viewer\n", encoding="utf-8")
    git(repository, "add", "viewer.txt")

    result = run_driver(repository, "--advance")
    assert result.returncode == 0, result.stdout + result.stderr
    assert git(repository, "rev-parse", "HEAD") == head
    assert git(repository, "rev-parse", "MERGE_HEAD") == target
    assert (repository / "shared.txt").read_text() == "new official fix\n"
    assert (repository / "viewer.txt").read_text() == "adapted viewer\n"
    assert (repository / "grammar.bin").read_bytes() == binary
    assert run_driver(repository, "--verify").returncode == 0


def test_advance_refuses_unreviewed_edits(repository: Path) -> None:
    assert run_driver(repository, "--apply").returncode == 0
    (repository / "viewer.txt").write_text("unreviewed edit\n", encoding="utf-8")
    result = run_driver(repository, "--advance")
    assert result.returncode == 2
    assert "Stage the reviewed worktree" in result.stderr


def test_advance_keeps_previous_parent_when_a_new_conflict_occurs(
    repository: Path,
) -> None:
    previous = git(repository, "rev-parse", "official")
    git(repository, "checkout", "official")
    (repository / "shared.txt").write_text("next API\n", encoding="utf-8")
    git(repository, "add", ".")
    git(repository, "commit", "-m", "change shared API")
    git(repository, "checkout", "main")
    assert run_driver(repository, "--upstream-ref", previous, "--apply").returncode == 0
    (repository / "shared.txt").write_text("adapted custom API\n", encoding="utf-8")
    git(repository, "add", "shared.txt")

    result = run_driver(repository, "--advance")
    assert result.returncode == 1
    assert git(repository, "rev-parse", "MERGE_HEAD") == previous
    assert git(repository, "diff", "--name-only", "--diff-filter=U") == "shared.txt"
    assert (repository / "viewer.txt").read_text() == "fork viewer\n"


def test_advance_preserves_another_operations_lock(repository: Path) -> None:
    previous = git(repository, "rev-parse", "official")
    git(repository, "checkout", "official")
    (repository / "shared.txt").write_text("next API\n", encoding="utf-8")
    git(repository, "add", ".")
    git(repository, "commit", "-m", "change shared API")
    git(repository, "checkout", "main")
    assert run_driver(repository, "--upstream-ref", previous, "--apply").returncode == 0
    lock = repository / ".git" / "MERGE_HEAD.lock"
    lock.write_text("another operation\n", encoding="utf-8")

    result = run_driver(repository, "--advance")
    assert result.returncode == 2
    assert lock.read_text() == "another operation\n"
    assert git(repository, "rev-parse", "MERGE_HEAD") == previous
    assert (repository / "shared.txt").read_text() == "official fix\n"
